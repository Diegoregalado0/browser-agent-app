#!/usr/bin/env node
// browser-agent            start in the background if needed, then bring up the agent browser
//                          (chat lives in its side panel)
// browser-agent window     same, but open the chat as a separate app window
// browser-agent serve      run the server in the foreground (--port=N, --no-open)
// browser-agent stop       stop the background server
// browser-agent status     report whether it is running
// browser-agent logs       print the server log path and its last lines
// browser-agent activity   show recent tasks, actions, and safety-check decisions

import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, rmSync, openSync, chmodSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { HOME_DIR } from "../src/config.js";

const PROJECT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const PID_FILE = join(HOME_DIR, "server.pid");
const URL_FILE = join(HOME_DIR, "ui-url");
const LOG_FILE = join(HOME_DIR, "server.log");
const TOKEN_FILE = join(HOME_DIR, "ui-token");

// API keys in the project's .env apply no matter where the command is run from.
try {
  process.loadEnvFile(join(PROJECT_DIR, ".env"));
} catch {}

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith("--")) || "open";
const portArg = args.find((a) => a.startsWith("--port="));
const port = portArg ? Number(portArg.split("=")[1]) : 7788;

function runningPid() {
  if (!existsSync(PID_FILE)) return null;
  const pid = Number(readFileSync(PID_FILE, "utf8"));
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

// A browser-agent server holding the port without our pid file (e.g. an old `npm start`).
function untrackedServerPid() {
  const [, pid, cmd] = /^(\d+)\s+(.*)$/.exec(portOwner() || "") || [];
  return pid && Number(pid) !== runningPid() && /browser-agent\.js/.test(cmd) ? Number(pid) : null;
}

// "<pid> <command>" of whatever listens on the port, or null.
function portOwner() {
  try {
    const pid = execFileSync("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim().split("\n")[0];
    return pid ? execFileSync("ps", ["-o", "pid=,command=", "-p", pid], { encoding: "utf8" }).trim() : null;
  } catch {
    return null;
  }
}

async function serverUrl() {
  if (!runningPid() || !existsSync(URL_FILE)) return null;
  const url = readFileSync(URL_FILE, "utf8").trim();
  try {
    const res = await fetch(new URL("/", url), { signal: AbortSignal.timeout(1500) });
    return res.ok ? url : null;
  } catch {
    return null;
  }
}

// The UI opens as an app window in the everyday Chrome profile, outside the agent browser.
function openWindow(url) {
  spawn("open", ["-na", "Google Chrome", "--args", `--app=${url}`], { stdio: "ignore", detached: true }).unref();
}

// The UI token survives restarts so open windows reconnect on their own.
function uiToken() {
  mkdirSync(HOME_DIR, { recursive: true });
  if (existsSync(TOKEN_FILE)) {
    const token = readFileSync(TOKEN_FILE, "utf8").trim();
    if (/^[0-9a-f]{48}$/.test(token)) return token;
  }
  const token = randomBytes(24).toString("hex");
  writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
  return token;
}

async function serve() {
  const { startServer } = await import("../src/server.js");
  const { url } = await startServer({ port, token: uiToken() });
  writeFileSync(PID_FILE, String(process.pid));
  writeFileSync(URL_FILE, url);
  chmodSync(URL_FILE, 0o600);
  const cleanup = () => {
    if (runningPid() === process.pid) rmSync(PID_FILE, { force: true });
    process.exit(0);
  };
  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
  console.log(`browser-agent UI: ${url}`);
  if (!args.includes("--no-open")) openWindow(url);
}

// Brings the agent's Chrome to the front and opens the chat side panel by pressing its
// shortcut (⌘⇧Y). Chrome only opens side panels on a real user gesture, which the native
// helper's keystroke provides; without Accessibility permission, the pinned icon does it.
async function focusAgentBrowser() {
  const { connectChrome } = await import("../src/chrome.js");
  const cdp = await connectChrome();
  const panelOpen = async () =>
    (await cdp.send("Target.getTargets")).targetInfos.some((t) => t.url.startsWith("chrome-extension://") && t.url.endsWith("/sidepanel.html"));
  const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
  const pid = processInfo.find((p) => p.type === "browser")?.id;
  const helper = join(HOME_DIR, "bin", "oshelper");
  let opened = await panelOpen();
  if (pid && existsSync(helper)) {
    execFileSync(helper, ["activate", String(pid)]);
    if (!opened && JSON.parse(execFileSync(helper, ["status"], { encoding: "utf8" })).accessibility) {
      await sleep(600);
      execFileSync(helper, ["key", "cmd+shift+y"]);
      await sleep(1200);
      opened = await panelOpen();
    }
  }
  cdp.close();
  console.log(
    opened
      ? "Agent browser is up with the chat panel open."
      : "Agent browser is up. Press ⌘⇧Y or click the Browser Agent icon in its toolbar to open the chat panel.",
  );
}

async function open(mode) {
  let url = await serverUrl();
  if (!url) {
    const stale = untrackedServerPid();
    if (stale) {
      console.error(`An older browser-agent (pid ${stale}) is already using port ${port}. Run \`browser-agent stop\`, then try again.`);
      process.exit(1);
    }
    const owner = portOwner();
    if (owner) {
      console.error(`Port ${port} is in use by: ${owner}\nFree it or start with --port=<other>.`);
      process.exit(1);
    }
    mkdirSync(HOME_DIR, { recursive: true });
    const log = openSync(LOG_FILE, "a");
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "serve", "--no-open", `--port=${port}`], {
      detached: true,
      stdio: ["ignore", log, log],
      cwd: PROJECT_DIR,
    });
    child.unref();
    for (let i = 0; i < 50 && !url; i++) {
      await sleep(200);
      url = await serverUrl();
    }
    if (!url) {
      console.error(`browser-agent did not start. See ${LOG_FILE}`);
      process.exit(1);
    }
  }
  if (mode === "window") openWindow(url);
  else await focusAgentBrowser();
}

switch (command) {
  case "serve":
    await serve();
    break;
  case "open":
  case "window":
    await open(command);
    break;
  case "stop": {
    const pids = [runningPid(), untrackedServerPid()].filter(Boolean);
    for (const pid of pids) process.kill(pid, "SIGTERM");
    console.log(pids.length ? `Stopped (pid ${pids.join(", ")}).` : "Not running.");
    break;
  }
  case "status": {
    const url = await serverUrl();
    console.log(url ? `Running (pid ${runningPid()}) at http://127.0.0.1:${new URL(url).port}` : "Not running.");
    break;
  }
  case "logs": {
    console.log(LOG_FILE);
    if (existsSync(LOG_FILE)) console.log(readFileSync(LOG_FILE, "utf8").split("\n").slice(-30).join("\n"));
    break;
  }
  case "activity": {
    const file = join(HOME_DIR, "activity.log");
    if (!existsSync(file)) {
      console.log("No activity yet.");
      break;
    }
    const count = Number(args.find((a) => a.startsWith("--last="))?.split("=")[1]) || 40;
    for (const line of readFileSync(file, "utf8").trim().split("\n").slice(-count)) {
      const e = JSON.parse(line);
      const time = e.time.slice(11, 19);
      const detail = {
        task: () => `TASK  ${e.text}`,
        tool_call: () => `tool  ${e.name} ${JSON.stringify(e.input).slice(0, 120)}`,
        tool_result: () => (e.isError ? `error ${e.content.join(" ").slice(0, 160)}` : null),
        guard: () => `check ${e.verdict.toUpperCase()} ${e.name}${e.target ? ` on ${e.target}` : ""}: ${e.reason}`,
        notice: () => `note  ${e.text}`,
        error: () => `ERROR ${e.text}`,
        permission_request: () => `ASK   ${e.text}`,
        permission_answer: () => `you   ${e.decision}`,
        usage: () => null,
        reply: () => `reply ${e.text.replace(/\s+/g, " ").slice(0, 200)}`,
      }[e.type]?.();
      if (detail) console.log(`${time} ${detail}`);
    }
    break;
  }
  default:
    console.error(`Unknown command "${command}". Use: open (default), window, serve, stop, status, logs, activity.`);
    process.exit(1);
}
