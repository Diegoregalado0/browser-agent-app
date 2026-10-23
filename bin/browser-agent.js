#!/usr/bin/env node
// The Browsby sandbox: a dedicated test Chrome profile running the real built extension.
//
// browser-agent            build the extension if sources changed, launch the test browser
//                          (or reinstall the extension in the running one), open the panel
// browser-agent reload     rebuild and reinstall the extension in the running test browser
// browser-agent stop       quit the test browser
// browser-agent status     report whether it is running, its DevTools port and the build
// browser-agent logs       print the browser log path and its last lines
// browser-agent session-logs [N]
//                          internal builds: write the newest N (default 5) conversations'
//                          debug logs to ~/.browser-agent/session-logs/<session>.jsonl
//
// --port=N sets the DevTools port when the browser launches (default: any free port).
// BROWSER_AGENT_HOME moves the profile and logs (default ~/.browser-agent). The default is
// refused unless the command runs in a terminal or from the Browsby app, so scripts and
// tests must pass a throwaway BROWSER_AGENT_HOME.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { HOME_DIR } from "../src/config.js";
import { connectChrome, browserProcesses, activePort, buildOutdated, EXTENSION_DIR, EXTENSION_ID, LOADED_FILE } from "../src/chrome.js";

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith("--")) || "open";

// The app is launched by launchd (parent pid 1) without a terminal. session-logs only reads
// a running browser's debug log and never launches one, so it may run from scripts.
if (!process.env.BROWSER_AGENT_HOME && !process.stdin.isTTY && process.ppid !== 1 && command !== "session-logs") {
  console.error(`Refusing to use the default profile at ${HOME_DIR} outside a terminal. Set BROWSER_AGENT_HOME to a separate directory.`);
  process.exit(1);
}

const PROJECT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOG_FILE = join(HOME_DIR, "chrome.log");
const MANIFEST = join(EXTENSION_DIR, "manifest.json");

const devtoolsPort = Number(args.find((a) => a.startsWith("--port="))?.split("=")[1]) || 0;

const mtime = (path) => statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? 0;

function build(force) {
  if (!force && !buildOutdated()) return;
  console.log("Building the extension…");
  const result = spawnSync(process.execPath, [join(PROJECT_DIR, "scripts", "build-extension.js")], { stdio: "inherit" });
  if (result.status !== 0) {
    console.error("The extension build failed.");
    process.exit(1);
  }
}

const loadedBuild = () => (existsSync(LOADED_FILE) ? Number(readFileSync(LOADED_FILE, "utf8")) : 0);

// Polls check() every 100 ms until it returns true or timeoutMs passes; returns the last result.
async function waitFor(check, timeoutMs) {
  const end = Date.now() + timeoutMs;
  let ok = await check();
  while (!ok && Date.now() < end) {
    await sleep(100);
    ok = await check();
  }
  return ok;
}

// Asks the running browser's keeper to reinstall the extension when it has an older build
// loaded, and waits for it. Exits when that is not possible (a browser started by an older
// version of this command), since only a browser restart loads the new build then.
async function reinstallIfOutdated() {
  const { keeper } = browserProcesses();
  const built = mtime(MANIFEST);
  if (loadedBuild() === built) return;
  if (!keeper || !existsSync(LOADED_FILE)) {
    console.error("The test browser was started by an older browser-agent. Run `browser-agent stop`, then try again.");
    process.exit(1);
  }
  process.kill(keeper, "SIGUSR1");
  if (!(await waitFor(() => loadedBuild() === built, 10000))) {
    console.error(`The extension did not reload. See ${LOG_FILE}`);
    process.exit(1);
  }
  console.log("Reloaded the extension.");
}

async function open({ force = false } = {}) {
  build(force);
  const running = Boolean(browserProcesses().chrome);
  if (running) await reinstallIfOutdated();
  const cdp = await connectChrome({ devtoolsPort });
  const panelOpen = async () =>
    (await cdp.send("Target.getTargets")).targetInfos.some((t) => t.url === `chrome-extension://${EXTENSION_ID}/sidepanel.html`);
  // Chrome on macOS keeps running after its last window closes; open one so there is
  // something to show, and bring it forward.
  const pages = (await cdp.send("Target.getTargets")).targetInfos.filter((t) => t.type === "page" && !t.url.startsWith("chrome-extension://"));
  const targetId = pages[0]?.targetId ?? (await cdp.send("Target.createTarget", { url: "chrome://newtab/", newWindow: true })).targetId;
  await cdp.send("Target.activateTarget", { targetId });
  // A fresh launch or a reinstall opens the panel by itself; otherwise ask the keeper.
  let opened = await waitFor(panelOpen, 3000);
  const { keeper } = browserProcesses();
  if (!opened && keeper) {
    process.kill(keeper, "SIGUSR2");
    opened = await waitFor(panelOpen, 3000);
  }
  cdp.close();
  console.log(
    `${opened ? "Test browser is up with the Browsby panel open." : "Test browser is up. Press ⌘⇧Y or click the Browsby icon to open the panel."}` +
      `\nDevTools: http://127.0.0.1:${activePort()?.port}`,
  );
}

// Reads the debug database (extension/debug-log.js) inside a running extension page or worker.
// Opening a database that does not exist yet would create it without its store, so the open
// is aborted then and nothing is returned.
const readLogs = (count) => `new Promise((resolve, reject) => {
  const open = indexedDB.open("browsby-debug");
  open.onupgradeneeded = () => open.transaction.abort();
  open.onerror = () => resolve({});
  open.onsuccess = () => {
    const db = open.result;
    const ids = [];
    db.transaction("lines").objectStore("lines").index("session").openKeyCursor(null, "prevunique").onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor && ids.length < ${count}) return (ids.push(cursor.key), cursor.continue());
      const out = {};
      const t = db.transaction("lines");
      for (const id of ids) t.objectStore("lines").index("session").getAll(IDBKeyRange.only(id)).onsuccess = (ev) => (out[id] = ev.target.result);
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
    };
  };
})`;

async function sessionLogs(count) {
  if (!browserProcesses().chrome) return console.log("The test browser is not running; its logs are read from the running extension.");
  const cdp = await connectChrome({ devtoolsPort });
  try {
    const targets = (await cdp.send("Target.getTargets")).targetInfos.filter((t) => t.url.startsWith(`chrome-extension://${EXTENSION_ID}/`));
    const target = targets.find((t) => t.type === "page") ?? targets.find((t) => t.type === "service_worker");
    if (!target) return console.log("No Browsby page is running in the test browser. Open the panel, then try again.");
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", { expression: readLogs(count), awaitPromise: true, returnByValue: true }, sessionId);
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    const logs = result.value ?? {};
    if (!Object.keys(logs).length) return console.log("No debug logs yet. They are kept by internal builds (the Browsby app) for saved conversations.");
    const dir = join(HOME_DIR, "session-logs");
    mkdirSync(dir, { recursive: true });
    for (const [id, lines] of Object.entries(logs)) {
      const file = join(dir, `${id}.jsonl`);
      writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
      const errors = lines.filter((l) => l.type === "error" || l.isError).length;
      const request = lines.find((l) => l.type === "request")?.text?.replace(/\s+/g, " ").slice(0, 70) ?? "";
      console.log(`${file}  ${lines.length} events, ${errors} errors  ${request}`);
    }
  } finally {
    cdp.close();
  }
}

switch (command) {
  case "open":
    await open();
    break;
  case "reload":
    if (!browserProcesses().chrome) {
      build(true);
      console.log("The test browser is not running; `browser-agent` starts it with this build.");
      break;
    }
    await open({ force: true });
    break;
  case "stop": {
    const { chrome } = browserProcesses();
    if (!chrome) {
      console.log("Not running.");
      break;
    }
    process.kill(chrome, "SIGTERM");
    const stopped = await waitFor(() => !browserProcesses().chrome, 10000);
    console.log(stopped ? `Stopped the test browser (pid ${chrome}).` : `Asked the test browser (pid ${chrome}) to quit; it is still running.`);
    break;
  }
  case "status": {
    const { chrome } = browserProcesses();
    if (!chrome) {
      console.log("Not running.");
      break;
    }
    const current = loadedBuild() === mtime(MANIFEST);
    console.log(
      `Running (pid ${chrome}), DevTools at http://127.0.0.1:${activePort()?.port}\n` +
        `Extension: ${current && !buildOutdated() ? "current build loaded" : "sources changed since the loaded build; run `browser-agent reload`"}`,
    );
    break;
  }
  case "logs":
    console.log(LOG_FILE);
    if (existsSync(LOG_FILE)) console.log(readFileSync(LOG_FILE, "utf8").split("\n").slice(-30).join("\n"));
    break;
  case "session-logs":
    await sessionLogs(Number(args.find((a) => /^\d+$/.test(a))) || 5);
    break;
  default:
    console.error(`Unknown command "${command}". Use: open (default), reload, stop, status, logs, session-logs.`);
    process.exit(1);
}
