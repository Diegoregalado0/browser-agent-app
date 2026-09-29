import { createController } from "../src/controller.js";
import { Browser } from "../src/browser-tools.js";
import { DebuggerTransport } from "./transport-debugger.js";
import { DiscordBridge } from "../src/remote-discord.js";
import { OutlookGraph } from "../src/outlook-graph.js";
import { loadConfig, saveConfig, loadUsage, saveUsage, sessions, EXTENSION_DEFAULTS } from "./storage.js";

// The extension edition runs the whole agent inside the side panel page: the panel's
// window is the agent's workspace, and closing the panel ends its task. The UI (ui/app.js)
// talks to the controller in-page through globalThis.agentHost instead of a WebSocket.

const win = await chrome.windows.getCurrent();

// Detach anything a previous panel in this window left attached, so no stale debugging
// banner remains. Other windows' agents are left alone. This runs while the UI loads;
// ensureBrowser waits for it, so no task starts before it is done.
const staleDetached = (async () => {
  const windowTabs = new Set((await chrome.tabs.query({ windowId: win.id })).map((t) => t.id));
  const stale = (await chrome.debugger.getTargets()).filter((t) => t.attached && windowTabs.has(t.tabId));
  await Promise.all(stale.map((t) => chrome.debugger.detach({ tabId: t.tabId }).catch(() => {})));
})().catch(() => {});

// Outlook on Microsoft Graph. Its tokens have their own key in chrome.storage.local (never
// synced), apart from the settings, so they never pass through the UI.
const outlook = new OutlookGraph({
  loadAuth: async () => (await chrome.storage.local.get("outlookAuth")).outlookAuth ?? null,
  saveAuth: (outlookAuth) => (outlookAuth ? chrome.storage.local.set({ outlookAuth }) : chrome.storage.local.remove("outlookAuth")),
  launchAuth: (url, interactive) => chrome.identity.launchWebAuthFlow({ url, interactive }),
  redirectUri: chrome.identity.getRedirectURL(),
});
await outlook.init();

const host = {
  env: {},
  loadConfig,
  saveConfig,
  loadUsage,
  saveUsage,
  defaults: EXTENSION_DEFAULTS,
  sessions,
  outlook,
  ensureBrowser: async (agent) => {
    await staleDetached;
    if (agent.browser) return;
    const transport = new DebuggerTransport({ windowId: win.id });
    transport.onCanceled = () => agent.stop();
    agent.browser = new Browser(transport);
  },
};
const controller = createController(host);

// Discord remote control runs in one panel at a time, since two connections for one bot
// would each take every task: the first panel opened holds the lock, and the next one
// waiting takes over when it closes. Incognito panels never run it.
const discordAway = (state) => ({ status: async () => ({ type: "discord_status", state }), configure() {}, unpair() {}, remove() {} });
host.discord = discordAway(win.incognito ? "incognito" : "elsewhere");
if (!win.incognito) {
  navigator.locks.request("discord-bridge", () => {
    host.discord = new DiscordBridge({ controller, loadConfig, saveConfig, onChange: () => controller.discordChanged(), place: "the computer" });
    host.discord.start().catch((err) => console.error(`Discord: ${err.message}`));
    // Held until this page closes.
    return new Promise(() => {});
  });
}

// Settings changed in another window's panel.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.config) controller.refreshConfig();
  // Outlook signed in or out, here or in another window's panel.
  if (area === "local" && changes.outlookAuth && Boolean(changes.outlookAuth.newValue) !== outlook.signedIn) {
    outlook.init().then(() => controller.outlookChanged());
  }
});

// Closing the panel stops the task and removes the debugging banner and the Agent group.
addEventListener("pagehide", () => {
  controller.agent.stop();
  controller.agent.browser?.endTask();
});

globalThis.agentHost = {
  incognito: win.incognito,
  connect(onEvent) {
    // Events are cloned so the UI never shares objects with the agent's history.
    const client = { send: (event) => queueMicrotask(() => onEvent(structuredClone(event))) };
    const receive = controller.connect(client);
    return { send: (msg) => receive(structuredClone(msg)) };
  },
};

await import("../ui/app.js");
