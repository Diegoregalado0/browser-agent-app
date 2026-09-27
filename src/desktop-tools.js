import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { existsSync, statSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BIN_DIR, HOME_DIR } from "./config.js";

const run = promisify(execFile);
const HELPER_SOURCE = join(dirname(fileURLToPath(import.meta.url)), "..", "native", "oshelper.swift");
const HELPER_BIN = join(BIN_DIR, "oshelper");
const SCREENSHOT_MAX_WIDTH = 1280;

export const DESKTOP_TOOL_DEF = {
  name: "desktop",
  description:
    "Real OS-level mouse, keyboard and screenshot control of the whole main display, like a person at the computer. " +
    "Use it for things page tools cannot reach: browser toolbar and menus, extension popups and icons, DevTools panels, " +
    "permission prompts, native file dialogs, and other apps. Coordinates are pixels in the most recent desktop " +
    "screenshot. Prefer the page tools for web content; they are faster and more precise. Call focus_browser before " +
    "interacting with the agent browser's own UI.",
  input_schema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "screenshot", "left_click", "right_click", "double_click", "move", "drag",
          "scroll", "type", "key", "focus_browser",
        ],
      },
      coordinate: { type: "array", items: { type: "number" }, description: "[x, y] in desktop screenshot pixels" },
      start_coordinate: { type: "array", items: { type: "number" }, description: "Drag start [x, y]" },
      text: { type: "string", description: "For type: text. For key: one chord such as 'cmd+shift+t', 'Return', 'Escape'." },
      modifiers: { type: "string", description: "Modifier chord held during a click, e.g. 'cmd'" },
      scroll_direction: { type: "string", enum: ["up", "down", "left", "right"] },
      scroll_amount: { type: "number", description: "Scroll ticks (default 3)" },
    },
    required: ["action"],
  },
};

async function ensureHelper() {
  const stale = !existsSync(HELPER_BIN) || statSync(HELPER_BIN).mtimeMs < statSync(HELPER_SOURCE).mtimeMs;
  if (!stale) return;
  mkdirSync(BIN_DIR, { recursive: true });
  try {
    await run("swiftc", ["-O", HELPER_SOURCE, "-o", HELPER_BIN], { timeout: 180000 });
  } catch (err) {
    throw new Error(`Could not compile the desktop helper (needs Xcode command line tools): ${err.stderr || err.message}`);
  }
}

export async function helper(...args) {
  await ensureHelper();
  try {
    const { stdout } = await run(HELPER_BIN, args.map(String), { timeout: 30000 });
    return JSON.parse(stdout);
  } catch (err) {
    const out = err.stdout && JSON.parse(err.stdout);
    throw new Error(out?.error || err.message);
  }
}

export class Desktop {
  constructor(browser) {
    this.browser = browser;
    this.pointsPerPixel = null;
    // With showActions on, the pointer glides to each target and typing is shown.
    this.showActions = false;
  }

  // Eases the real pointer to (x, y) first when actions are shown.
  async #glide(x, y) {
    if (this.showActions) await helper("glide", x, y, 320);
  }

  async #screenshot() {
    const status = await helper("status");
    if (!status.screenRecording) {
      throw new Error(
        "Screen Recording permission is missing. Grant it to the app running browser-agent (e.g. Terminal) in " +
          "System Settings > Privacy & Security > Screen Recording, then restart it.",
      );
    }
    const path = join(HOME_DIR, `desktop-${process.pid}.jpg`);
    try {
      await run("screencapture", ["-x", "-t", "jpg", "-D", "1", path]);
      await run("sips", ["--resampleWidth", String(Math.min(SCREENSHOT_MAX_WIDTH, status.displayWidth)), path]);
      const buf = readFileSync(path);
      const { stdout } = await run("sips", ["-g", "pixelWidth", "-g", "pixelHeight", path]);
      const width = Number(stdout.match(/pixelWidth: (\d+)/)[1]);
      const height = Number(stdout.match(/pixelHeight: (\d+)/)[1]);
      this.pointsPerPixel = status.displayWidth / width;
      return { data: buf.toString("base64"), width, height };
    } finally {
      rmSync(path, { force: true });
    }
  }

  async #point(coord, name = "coordinate") {
    if (!Array.isArray(coord) || coord.length !== 2) throw new Error(`${name} [x, y] is required`);
    if (!this.pointsPerPixel) {
      const status = await helper("status");
      this.pointsPerPixel = status.displayWidth / Math.min(SCREENSHOT_MAX_WIDTH, status.displayWidth);
    }
    const point = [Math.round(coord[0] * this.pointsPerPixel), Math.round(coord[1] * this.pointsPerPixel)];
    // The agent's own side panel is off limits, whatever the model asks for.
    const panel = await this.browser.sidebarRect();
    if (panel && point[0] >= panel.left && point[0] <= panel.right && point[1] >= panel.top && point[1] <= panel.bottom) {
      throw new Error("That point is inside the agent's own side panel, which is off limits. Act on the web page or browser UI instead.");
    }
    return point;
  }

  async run(input) {
    switch (input.action) {
      case "screenshot": {
        const shot = await this.#screenshot();
        return [
          { type: "image", mediaType: "image/jpeg", data: shot.data },
          { type: "text", text: `Desktop screenshot ${shot.width}x${shot.height}` },
        ];
      }
      case "left_click":
      case "right_click":
      case "double_click": {
        const [x, y] = await this.#point(input.coordinate);
        const button = input.action === "right_click" ? "right" : "left";
        const count = input.action === "double_click" ? 2 : 1;
        await this.#glide(x, y);
        await helper("click", x, y, button, count, input.modifiers || "");
        await sleep(300);
        return `${input.action} at ${JSON.stringify(input.coordinate)}`;
      }
      case "move": {
        const [x, y] = await this.#point(input.coordinate);
        await this.#glide(x, y);
        await helper("move", x, y);
        return `Moved to ${JSON.stringify(input.coordinate)}`;
      }
      case "drag": {
        const [x1, y1] = await this.#point(input.start_coordinate, "start_coordinate");
        const [x2, y2] = await this.#point(input.coordinate);
        await this.#glide(x1, y1);
        await helper("drag", x1, y1, x2, y2);
        return "Dragged";
      }
      case "scroll": {
        const status = await helper("status");
        const [x, y] = input.coordinate
          ? await this.#point(input.coordinate)
          : [status.displayWidth / 2, status.displayHeight / 2];
        const delta = (input.scroll_amount ?? 3) * 100;
        const dir = input.scroll_direction || "down";
        const dx = dir === "left" ? -delta : dir === "right" ? delta : 0;
        const dy = dir === "up" ? -delta : dir === "down" ? delta : 0;
        await helper("scroll", x, y, dx, dy);
        return `Scrolled ${dir}`;
      }
      case "type": {
        if (typeof input.text !== "string") throw new Error("text is required for type");
        if (this.showActions) {
          const pause = Math.round(Math.min(45, Math.max(8, 3000 / input.text.length)) * 1000);
          await helper("type", input.text, 1, pause);
        } else await helper("type", input.text);
        return `Typed ${input.text.length} characters`;
      }
      case "key": {
        if (!input.text) throw new Error("text is required for key");
        for (const chord of input.text.trim().split(/\s+/)) await helper("key", chord);
        await sleep(200);
        return `Pressed ${input.text}`;
      }
      case "focus_browser": {
        const pid = await this.browser.browserPid();
        if (!pid) throw new Error("Could not find the agent browser process");
        await helper("activate", pid);
        await this.browser.bringToFront();
        await sleep(300);
        return "Agent browser is now the frontmost app";
      }
      default:
        throw new Error(`Unknown desktop action ${input.action}`);
    }
  }
}
