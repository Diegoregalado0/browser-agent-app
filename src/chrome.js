import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, openSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { PROFILE_DIR, HOME_DIR } from "./config.js";
import { CDP } from "./cdp.js";

const KEEPER = join(dirname(fileURLToPath(import.meta.url)), "chrome-keeper.js");
const ACTIVE_PORT_FILE = join(PROFILE_DIR, "DevToolsActivePort");
// Held while one caller launches Chrome. At app launch the server and the CLI both
// connect; a second keeper would start a second Chrome, which hands off to the first
// and opens an extra window that the next session restores.
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

function readActivePort() {
  if (!existsSync(ACTIVE_PORT_FILE)) return null;
  const [port, path] = readFileSync(ACTIVE_PORT_FILE, "utf8").trim().split("\n");
  return port && path ? `ws://127.0.0.1:${port}${path}` : null;
}

async function tryConnect(wsUrl) {
  try {
    return await CDP.connect(wsUrl);
  } catch {
    return null;
  }
}

// Connects to the agent's Chrome, launching it (through the keeper, which also installs
// the sidebar) on the dedicated profile if it is not already running. It is launched
// without automation switches, so pages see a normal browser.
export async function connectChrome() {
  const existing = readActivePort();
  if (existing) {
    const cdp = await tryConnect(existing);
    if (cdp) return cdp;
    rmSync(ACTIVE_PORT_FILE, { force: true });
  }

  const launching = claimLaunch();
  if (launching) {
    const log = openSync(join(HOME_DIR, "chrome.log"), "a");
    spawn(process.execPath, [KEEPER], { detached: true, stdio: ["ignore", log, log], env: process.env }).unref();
  }

  try {
    for (let i = 0; i < 400; i++) {
      await sleep(50);
      const wsUrl = readActivePort();
      if (!wsUrl) continue;
      const cdp = await tryConnect(wsUrl);
      if (cdp) return cdp;
    }
  } finally {
    if (launching) rmSync(LAUNCH_LOCK, { force: true });
  }
  throw new Error("Chrome started but its DevTools endpoint never became reachable.");
}
