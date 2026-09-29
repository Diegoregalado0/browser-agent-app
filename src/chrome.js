import { spawn, execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, openSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { PROFILE_DIR, HOME_DIR } from "./config.js";
import { CDP } from "./cdp.js";

const KEEPER = join(dirname(fileURLToPath(import.meta.url)), "chrome-keeper.js");
const ACTIVE_PORT_FILE = join(PROFILE_DIR, "DevToolsActivePort");
// The built extension the test browser loads (npm run build:extension).
export const EXTENSION_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "extension");
// Fixed by the manifest's "key" (scripts/build-extension.js); Outlook's redirect relies on it.
export const EXTENSION_ID = "fddhceodbfeklilaakgioapmildcmgjo";
// The build the running browser has loaded: the manifest's mtime at install, written by the
// keeper and removed when the browser exits.
export const LOADED_FILE = join(HOME_DIR, "extension-loaded");
// Held while one caller launches Chrome, so two launches at once do not start a second
// keeper (whose Chrome would hand off to the first and open an extra window).
const LAUNCH_LOCK = join(PROFILE_DIR, "launching");
const LAUNCH_LOCK_MAX_AGE_MS = 20000;

function claimLaunch() {
  mkdirSync(PROFILE_DIR, { recursive: true });
  const age = Date.now() - (statSync(LAUNCH_LOCK, { throwIfNoEntry: false })?.mtimeMs ?? 0);
  if (age > LAUNCH_LOCK_MAX_AGE_MS) rmSync(LAUNCH_LOCK, { force: true });
  try {
    writeFileSync(LAUNCH_LOCK, String(process.pid), { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

// The DevTools port of the running browser, from the file Chrome writes in the profile.
export function activePort() {
  if (!existsSync(ACTIVE_PORT_FILE)) return null;
  const [port, path] = readFileSync(ACTIVE_PORT_FILE, "utf8").trim().split("\n");
  return port && path ? { port: Number(port), wsUrl: `ws://127.0.0.1:${port}${path}` } : null;
}

async function tryConnect(wsUrl) {
  try {
    return await CDP.connect(wsUrl);
  } catch {
    return null;
  }
}

// The test browser on this profile and its keeper (the parent of the main Chrome process).
// Returns { chrome, keeper } pids; either is null when not found.
export function browserProcesses() {
  let chrome = null;
  let keeper = null;
  try {
    const rows = execFileSync("ps", ["-ax", "-o", "pid=,ppid=,command="], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })
      .split("\n")
      .map((row) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(row))
      .filter(Boolean);
    const main = rows.find((m) => m[3].includes(`--user-data-dir=${PROFILE_DIR} `) && !m[3].includes("--type="));
    if (main) {
      chrome = Number(main[1]);
      const parent = rows.find((m) => m[1] === main[2]);
      if (parent?.[3].includes("chrome-keeper.js")) keeper = Number(parent[1]);
    }
  } catch {}
  return { chrome, keeper };
}

// Connects to the test browser, launching it through the keeper (which installs the
// extension) when it is not running. devtoolsPort applies only to a new launch; 0 picks a
// free port. Chrome runs with --remote-debugging-pipe, which sets navigator.webdriver, so
// pages can tell it is automated.
export async function connectChrome({ devtoolsPort = 0 } = {}) {
  const existing = activePort();
  if (existing) {
    const cdp = await tryConnect(existing.wsUrl);
    if (cdp) return cdp;
    rmSync(ACTIVE_PORT_FILE, { force: true });
  }

  const launching = claimLaunch();
  if (launching) {
    const log = openSync(join(HOME_DIR, "chrome.log"), "a");
    spawn(process.execPath, [KEEPER, String(devtoolsPort)], { detached: true, stdio: ["ignore", log, log], env: process.env }).unref();
  }

  try {
    for (let i = 0; i < 400; i++) {
      await sleep(50);
      const wsUrl = activePort()?.wsUrl;
      if (!wsUrl) continue;
      const cdp = await tryConnect(wsUrl);
      if (cdp) return cdp;
    }
  } finally {
    if (launching) rmSync(LAUNCH_LOCK, { force: true });
  }
  throw new Error("Chrome started but its DevTools endpoint never became reachable.");
}
