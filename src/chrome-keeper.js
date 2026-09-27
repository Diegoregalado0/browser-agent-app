// Launches the agent's Chrome and keeps it alive. Chrome is started with a debugging pipe
// (needed to install the sidebar extension, since branded Chrome no longer accepts
// --load-extension) and a debugging port (what the server uses). Chrome exits when this
// pipe closes, so this small process holds it for the browser's whole life, independent
// of server restarts, and exits when Chrome does. SIGUSR1 reinstalls the sidebar
// extension from disk, which is how a newer server updates it in a running browser.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PROFILE_DIR } from "./config.js";
import { SIDEBAR_DIR, LOADED_VERSION_FILE, pinSidebarIcon } from "./sidebar.js";

const CHROME_BINARY =
  process.env.BROWSER_AGENT_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

mkdirSync(PROFILE_DIR, { recursive: true });
pinSidebarIcon(PROFILE_DIR);
const chrome = spawn(
  CHROME_BINARY,
  [
    `--user-data-dir=${PROFILE_DIR}`,
    "--remote-debugging-port=0",
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
// Version of each pending install request, by message id.
const installs = new Map();
let nextId = 1;

function installSidebar() {
  let version = null;
  try {
    version = JSON.parse(readFileSync(join(SIDEBAR_DIR, "manifest.json"), "utf8")).version;
  } catch {}
  const id = nextId++;
  installs.set(id, version);
  toChrome.write(JSON.stringify({ id, method: "Extensions.loadUnpacked", params: { path: SIDEBAR_DIR, enableInIncognito: true } }) + "\0");
}

let buffer = "";
fromChrome.on("data", (chunk) => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf("\0")) >= 0) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    if (!installs.has(message.id)) continue;
    const version = installs.get(message.id);
    installs.delete(message.id);
    if (message.error) console.error(`Sidebar install failed: ${message.error.message}`);
    else {
      console.log(`Sidebar extension ${message.result.id} ${version} loaded`);
      if (version) writeFileSync(LOADED_VERSION_FILE, version);
      installed = true;
    }
  }
});
toChrome.on("error", () => {});
fromChrome.on("error", () => {});
installSidebar();

chrome.on("exit", () => {
  if (installed) rmSync(LOADED_VERSION_FILE, { force: true });
  process.exit(0);
});
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, () => {});
process.on("SIGUSR1", installSidebar);
