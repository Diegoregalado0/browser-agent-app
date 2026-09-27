import { mkdirSync, writeFileSync, copyFileSync, existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { HOME_DIR } from "./config.js";
import { BRIDGE_SOURCE } from "./transport-cdp.js";

export const SIDEBAR_DIR = join(HOME_DIR, "sidebar-extension");
// The extension version the running browser has loaded, written by the keeper.
export const LOADED_VERSION_FILE = join(HOME_DIR, "sidebar-loaded-version");

// Chrome derives an unpacked extension's id from its absolute path: SHA-256, first 32 hex
// digits, each mapped 0-f to a-p.
export function sidebarExtensionId() {
  const hex = createHash("sha256").update(SIDEBAR_DIR).digest("hex").slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
}

// Pins the panel's toolbar icon by adding it to the profile's pinned extensions. Only
// valid while Chrome is not running (it rewrites Preferences on exit).
export function pinSidebarIcon(profileDir) {
  const prefsPath = join(profileDir, "Default", "Preferences");
  if (!existsSync(prefsPath)) return;
  try {
    const prefs = JSON.parse(readFileSync(prefsPath, "utf8"));
    prefs.extensions ??= {};
    const pinned = prefs.extensions.pinned_extensions ?? [];
    const id = sidebarExtensionId();
    if (pinned.includes(id)) return;
    prefs.extensions.pinned_extensions = [id, ...pinned];
    writeFileSync(prefsPath, JSON.stringify(prefs));
  } catch {}
}
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ICON_SOURCE = join(ROOT, "scripts", "icon-128.png");
// The extension edition's service worker, which sets the same panel behavior.
const BACKGROUND_SOURCE = join(ROOT, "extension", "background.js");

// Bumped whenever the extension's files change, so a running browser reloads it.
export const SIDEBAR_VERSION = "1.4.0";

// The keeper of the browser running on this profile: the parent of its main Chrome
// process. Returns { chrome, keeper } pids; either is null when not found.
function browserProcesses(profileDir) {
  let chrome = null;
  let keeper = null;
  try {
    const rows = execFileSync("ps", ["-ax", "-o", "pid=,ppid=,command="], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).split("\n");
    const parse = (row) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(row);
    const main = rows.map(parse).find((m) => m && m[3].includes(`--user-data-dir=${profileDir} `) && !m[3].includes("--type="));
    if (main) {
      chrome = Number(main[1]);
      const parent = rows.map(parse).find((m) => m && m[1] === main[2]);
      if (parent?.[3].includes("chrome-keeper.js")) keeper = Number(parent[1]);
    }
  } catch {}
  return { chrome, keeper };
}

// Asks the keeper of a running browser to reinstall the extension when the loaded copy
// is older than the files on disk. Returns false when that is not possible (a browser
// started by a keeper from before reinstalls were supported), in which case a browser
// restart loads it.
export function updateRunningSidebar(profileDir) {
  const { chrome, keeper } = browserProcesses(profileDir);
  if (!chrome) return true;
  const loaded = existsSync(LOADED_VERSION_FILE) ? readFileSync(LOADED_VERSION_FILE, "utf8").trim() : "";
  if (loaded === SIDEBAR_VERSION) return true;
  if (!keeper || !loaded) return false;
  try {
    process.kill(keeper, "SIGUSR1");
    return true;
  } catch {
    return false;
  }
}

// Writes the side panel extension for the agent browser. The panel is a thin shell that
// frames the local UI (same origin as the server, so the WebSocket checks still pass).
// It lives in browser UI, outside any page, so page tools cannot see or click it.
export function writeSidebarExtension(uiUrl) {
  mkdirSync(SIDEBAR_DIR, { recursive: true });
  const manifest = {
    manifest_version: 3,
    name: "Browser Agent",
    version: SIDEBAR_VERSION,
    description: "Side panel for the local browser agent.",
    permissions: ["sidePanel", "tabs", "tabGroups", "debugger", "storage"],
    background: { service_worker: "background.js" },
    side_panel: { default_path: "sidepanel.html" },
    action: { default_title: "Browser Agent (⌘⇧Y)" },
    commands: {
      _execute_action: { suggested_key: { default: "Ctrl+Shift+Y", mac: "Command+Shift+Y" }, description: "Open the chat panel" },
    },
    ...(existsSync(ICON_SOURCE) && { icons: { 128: "icon-128.png" } }),
  };
  writeFileSync(join(SIDEBAR_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  copyFileSync(BACKGROUND_SOURCE, join(SIDEBAR_DIR, "background.js"));
  writeFileSync(join(SIDEBAR_DIR, "bridge.js"), BRIDGE_SOURCE);
  writeFileSync(
    join(SIDEBAR_DIR, "bridge.html"),
    `<!doctype html><html><head><meta charset="utf-8"><script src="bridge.js"></script></head><body></body></html>\n`,
  );
  // The panel tells the UI when it sits in an incognito window, where Ghost mode is locked on.
  // Extension pages may not run inline scripts, so the frame URL is set from sidepanel.js.
  writeFileSync(
    join(SIDEBAR_DIR, "sidepanel.html"),
    `<!doctype html>
<html><head><meta charset="utf-8"><title>Browser Agent</title>
<style>html,body,iframe{margin:0;border:0;width:100%;height:100%;display:block;background:#1b1c1e}</style>
</head><body><iframe allow="clipboard-write"></iframe><script src="sidepanel.js"></script></body></html>
`,
  );
  const frameUrl = `${uiUrl}${uiUrl.includes("?") ? "&" : "?"}embed=sidebar`;
  writeFileSync(
    join(SIDEBAR_DIR, "sidepanel.js"),
    `chrome.windows.getCurrent().then(
  (win) => (document.querySelector("iframe").src = ${JSON.stringify(frameUrl)} + (win.incognito ? "&incognito=1" : "")),
  () => (document.querySelector("iframe").src = ${JSON.stringify(frameUrl)}),
);
`,
  );
  if (existsSync(ICON_SOURCE)) copyFileSync(ICON_SOURCE, join(SIDEBAR_DIR, "icon-128.png"));
  return SIDEBAR_DIR;
}
