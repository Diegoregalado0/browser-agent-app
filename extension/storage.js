import { mergeConfig } from "../src/config-core.js";
import { SESSION_ID_PATTERN, metaOf, sessionRecord } from "../src/session-format.js";

// Settings live in chrome.storage.local, which stays on this device and is never synced,
// so API keys do not leave it. Conversations live in IndexedDB.

// The extension's changes to the default settings: code-running tools start off.
export const EXTENSION_DEFAULTS = { developerTools: false };

export async function loadConfig() {
  const { config } = await chrome.storage.local.get("config");
  return mergeConfig(config, EXTENSION_DEFAULTS);
}

export async function saveConfig(config) {
  await chrome.storage.local.set({ config });
}

export async function loadUsage() {
  return (await chrome.storage.local.get("usage")).usage ?? null;
}

export async function saveUsage(usage) {
  await chrome.storage.local.set({ usage });
}

let dbPromise = null;

function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("browser-agent", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("sessions", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function run(mode, action) {
  const store = (await db()).transaction("sessions", mode).objectStore("sessions");
  return new Promise((resolve, reject) => {
    const request = action(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function checkId(id) {
  if (!SESSION_ID_PATTERN.test(String(id))) throw new Error("Invalid session id");
  return id;
}

export const sessions = {
  save: (conversation) => run("readwrite", (store) => store.put(sessionRecord(conversation))),
  // Newest first.
  list: async () => (await run("readonly", (store) => store.getAll())).map(metaOf).sort((a, b) => b.updated.localeCompare(a.updated)),
  load: async (id) => {
    const session = await run("readonly", (store) => store.get(checkId(id)));
    if (!session) throw new Error("That session no longer exists.");
    return session;
  },
  remove: (id) => run("readwrite", (store) => store.delete(checkId(id))),
  removeAll: () => run("readwrite", (store) => store.clear()),
};
