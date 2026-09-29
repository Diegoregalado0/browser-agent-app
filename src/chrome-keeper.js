// Launches the test browser and keeps it alive. Chrome is started with a debugging pipe
// (needed to install the built extension, since branded Chrome no longer accepts
// --load-extension, and to open its side panel) and a debugging port (for automation and
// inspection). Chrome exits when this pipe closes, so this small process holds it for the
// browser's whole life and exits when Chrome does.
//   SIGUSR1  reinstalls the extension from dist/extension (after a rebuild)
//   SIGUSR2  opens the extension's side panel
// argv[2]: the DevTools port, 0 for any free one.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { PROFILE_DIR } from "./config.js";
import { EXTENSION_DIR, EXTENSION_ID, LOADED_FILE } from "./chrome.js";

const CHROME_BINARY =
  process.env.BROWSER_AGENT_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Pins the extension's toolbar icon. Only valid while Chrome is not running (it rewrites
// Preferences on exit).
function pinIcon() {
  const prefsPath = join(PROFILE_DIR, "Default", "Preferences");
  if (!existsSync(prefsPath)) return;
  try {
    const prefs = JSON.parse(readFileSync(prefsPath, "utf8"));
    prefs.extensions ??= {};
    const pinned = prefs.extensions.pinned_extensions ?? [];
    if (pinned.includes(EXTENSION_ID)) return;
    prefs.extensions.pinned_extensions = [EXTENSION_ID, ...pinned];
    writeFileSync(prefsPath, JSON.stringify(prefs));
  } catch {}
}

const port = Number(process.argv[2]) || 0;
mkdirSync(PROFILE_DIR, { recursive: true });
pinIcon();
const chrome = spawn(
  CHROME_BINARY,
  [
    `--user-data-dir=${PROFILE_DIR}`,
    `--remote-debugging-port=${port}`,
    "--remote-debugging-pipe",
    "--enable-unsafe-extension-debugging",
    "--restore-last-session",
    "--no-first-run",
    "--no-default-browser-check",
  ],
  { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] },
);
const [, , , toChrome, fromChrome] = chrome.stdio;

// Whether this keeper's browser loaded the extension. A second launch on a profile that
// is already open hands off to the running browser and exits; it must not clean up.
let installed = false;
let nextId = 1;
const pending = new Map();

function send(method, params = {}) {
  const id = nextId++;
  toChrome.write(JSON.stringify({ id, method, params }) + "\0");
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

let buffer = "";
fromChrome.on("data", (chunk) => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf("\0")) >= 0) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    const call = pending.get(message.id);
    if (!call) continue;
    pending.delete(message.id);
    if (message.error) call.reject(new Error(message.error.message));
    else call.resolve(message.result);
  }
});
toChrome.on("error", () => {});
fromChrome.on("error", () => {});

// Opens the side panel the way a toolbar click does (the extension sets
// openPanelOnActionClick). Chrome needs a tab to open it next to; at launch the first
// window may take a moment to appear.
async function openPanel() {
  for (let i = 0; i < 50; i++) {
    const { targetInfos } = await send("Target.getTargets", { filter: [{ type: "tab" }] });
    const tab = targetInfos.find((t) => !t.url.startsWith("chrome-extension://"));
    if (tab) return send("Extensions.triggerAction", { id: EXTENSION_ID, targetId: tab.targetId });
    await sleep(100);
  }
  throw new Error("no tab to open the panel next to");
}

async function install() {
  try {
    const built = statSync(join(EXTENSION_DIR, "manifest.json")).mtimeMs;
    const { id } = await send("Extensions.loadUnpacked", { path: EXTENSION_DIR, enableInIncognito: true });
    writeFileSync(LOADED_FILE, String(built));
    installed = true;
    console.log(`Extension ${id} loaded from ${EXTENSION_DIR}`);
    await openPanel();
  } catch (err) {
    console.error(`Extension install failed: ${err.message}`);
  }
}

// Chrome writes DevToolsActivePort only when it picks the port; with a fixed one, write
// it the same way, so every command finds the port.
async function writeActivePort() {
  for (let i = 0; i < 100; i++) {
    try {
      const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      return writeFileSync(join(PROFILE_DIR, "DevToolsActivePort"), `${port}\n${new URL(webSocketDebuggerUrl).pathname}\n`);
    } catch {
      await sleep(100);
    }
  }
}

if (port) writeActivePort();
install();
chrome.on("exit", () => {
  if (installed) rmSync(LOADED_FILE, { force: true });
  process.exit(0);
});
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, () => {});
process.on("SIGUSR1", install);
process.on("SIGUSR2", () => openPanel().catch((err) => console.error(`Could not open the panel: ${err.message}`)));
