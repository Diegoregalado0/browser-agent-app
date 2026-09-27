import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { appendFileSync, statSync, renameSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { WebSocketServer } from "ws";
import { loadConfig, saveConfig, HOME_DIR, PROFILE_DIR } from "./config.js";
import { connectChrome } from "./chrome.js";
import { Browser } from "./browser-tools.js";
import { CdpTransport } from "./transport-cdp.js";
import { Desktop, DESKTOP_TOOL_DEF, helper } from "./desktop-tools.js";
import { createController } from "./controller.js";
import { writeSidebarExtension, sidebarExtensionId, updateRunningSidebar } from "./sidebar.js";
import * as sessions from "./sessions.js";

const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "ui");
const ACTIVITY_LOG = join(HOME_DIR, "activity.log");
const USAGE_PATH = join(HOME_DIR, "usage.json");
const ACTIVITY_LOG_MAX_BYTES = 5 * 1024 * 1024;
const LOGGED_EVENTS = new Set(["task", "tool_call", "tool_result", "guard", "notice", "error", "permission_request", "permission_answer", "usage", "reply"]);

// Appends one JSON line per event to ~/.browser-agent/activity.log, without images, and
// rolls the file over to activity.log.1 past 5 MB.
function logActivity(event) {
  if (!LOGGED_EVENTS.has(event.type)) return;
  const entry = { time: new Date().toISOString(), ...event };
  if (Array.isArray(entry.content)) {
    entry.content = entry.content.map((b) => (b.type === "image" ? "[image]" : b.text.slice(0, 500)));
  }
  try {
    if (statSync(ACTIVITY_LOG, { throwIfNoEntry: false })?.size > ACTIVITY_LOG_MAX_BYTES) {
      renameSync(ACTIVITY_LOG, `${ACTIVITY_LOG}.1`);
    }
    appendFileSync(ACTIVITY_LOG, JSON.stringify(entry) + "\n", { mode: 0o600 });
  } catch {}
}

function fileSize(path) {
  return statSync(path, { throwIfNoEntry: false })?.size ?? 0;
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

export async function startServer({ port, token = randomBytes(24).toString("hex") }) {
  const origin = `http://127.0.0.1:${port}`;

  const controller = createController({
    edition: "local",
    env: process.env,
    // The controller chains on the promise loadConfig returns.
    loadConfig: async () => loadConfig(),
    saveConfig,
    sessions,
    log: logActivity,
    clearLog: async () => {
      rmSync(ACTIVITY_LOG, { force: true });
      rmSync(`${ACTIVITY_LOG}.1`, { force: true });
    },
    logBytes: async () => fileSize(ACTIVITY_LOG) + fileSize(`${ACTIVITY_LOG}.1`),
    dataLocation: HOME_DIR,
    loadUsage: async () => {
      try {
        return JSON.parse(readFileSync(USAGE_PATH, "utf8"));
      } catch {
        return null;
      }
    },
    saveUsage: async (usage) => writeFileSync(USAGE_PATH, JSON.stringify(usage), { mode: 0o600 }),
    ensureBrowser: async (agent) => {
      if (agent.browser?.transport.cdp.connected) return;
      const cdp = await connectChrome();
      agent.browser = new Browser(
        new CdpTransport(cdp, {
          hiddenUrlPrefixes: [origin, `chrome-extension://${sidebarExtensionId()}`],
          extensionId: sidebarExtensionId(),
        }),
      );
      agent.desktop = { tool: new Desktop(agent.browser), def: DESKTOP_TOOL_DEF };
    },
    desktop: { status: () => helper("status"), requestAccess: () => helper("request-access") },
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (!/^[\w.-]+$/.test(file)) {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = await readFile(join(UI_DIR, file));
      res.writeHead(200, {
        "Content-Type": MIME[extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:*",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, origin);
    if (url.pathname !== "/ws" || url.searchParams.get("t") !== token || req.headers.origin !== origin) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const client = { send: (event) => ws.send(JSON.stringify(event)) };
      const receive = controller.connect(client);
      ws.on("close", () => controller.disconnect(client));
      ws.on("message", (data) => {
        let msg;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }
        receive(msg);
      });
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  const url = `${origin}/?t=${token}`;
  writeSidebarExtension(url);
  if (!updateRunningSidebar(PROFILE_DIR)) console.error("Restart the agent browser to load the updated side panel extension.");
  controller.ensureBrowser().catch((err) => console.error(`Agent browser: ${err.message}`));
  return { url };
}
