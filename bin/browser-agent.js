#!/usr/bin/env node
// The Browsby sandbox: a dedicated test Chrome profile running the real built extension.
//
// browser-agent            build the extension if sources changed, launch the test browser
//                          (or reinstall the extension in the running one), open the panel
// browser-agent reload     rebuild and reinstall the extension in the running test browser
// browser-agent stop       quit the test browser
// browser-agent status     report whether it is running, its DevTools port and the build
// browser-agent logs       print the browser log path and its last lines
//
// --port=N sets the DevTools port when the browser launches (default: any free port).
// BROWSER_AGENT_HOME moves the profile and logs (default ~/.browser-agent).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { HOME_DIR } from "../src/config.js";
import { connectChrome, browserProcesses, activePort, EXTENSION_DIR, EXTENSION_ID, LOADED_FILE } from "../src/chrome.js";

const PROJECT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOG_FILE = join(HOME_DIR, "chrome.log");
const MANIFEST = join(EXTENSION_DIR, "manifest.json");
// What the extension build reads.
const SOURCES = ["extension", "src", "ui", "scripts/build-extension.js", "scripts/icon-16.png", "scripts/icon-32.png", "scripts/icon-48.png", "scripts/icon-128.png", "package.json", "package-lock.json"];

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith("--")) || "open";
const devtoolsPort = Number(args.find((a) => a.startsWith("--port="))?.split("=")[1]) || 0;

const mtime = (path) => statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? 0;

function newestSource(path) {
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat?.isDirectory()) return stat?.mtimeMs ?? 0;
  return Math.max(stat.mtimeMs, ...readdirSync(path).map((name) => newestSource(join(path, name))));
}

const buildOutdated = () => mtime(MANIFEST) < Math.max(...SOURCES.map((s) => newestSource(join(PROJECT_DIR, s))));

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
  default:
    console.error(`Unknown command "${command}". Use: open (default), reload, stop, status, logs.`);
    process.exit(1);
}
