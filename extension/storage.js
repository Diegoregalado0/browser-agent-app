import { mergeConfig } from "../src/config-core.js";
import { SESSION_ID_PATTERN, metaOf, sessionRecord } from "../src/session-format.js";

// Settings live in chrome.storage.local, which stays on this device and is never synced,
// so API keys do not leave it. Conversations live in IndexedDB.

export async function loadConfig() {
  const { config } = await chrome.storage.local.get("config");
  return mergeConfig(config);
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

// Version 2 adds "meta": one small record per session (metaOf), so the history list does
// not read every full conversation. The upgrade builds it from the saved sessions inside
// the upgrade transaction, so it either completes fully or leaves version 1 untouched.
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("browser-agent", 2);
    request.onupgradeneeded = (event) => {
      const database = request.result;
      if (event.oldVersion < 1) database.createObjectStore("sessions", { keyPath: "id" });
      if (event.oldVersion < 2) {
        const meta = database.createObjectStore("meta", { keyPath: "id" });
        request.transaction.objectStore("sessions").openCursor().onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor) return;
          meta.put(safeMetaOf(cursor.value));
          cursor.continue();
        };
      }
    };
    request.onsuccess = () => {
      // Another panel running a newer version needs this connection closed to upgrade.
      request.result.onversionchange = () => {
        request.result.close();
        dbPromise = null;
      };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

// A malformed old record still gets listed (and can be opened or deleted) rather than
// failing the upgrade.
function safeMetaOf(session) {
  try {
    return metaOf(session);
  } catch {
    const { id, title = "Untitled", created = "", updated = created } = session;
    return { id, title, created, updated, requests: 0 };
  }
}

// Runs action(...stores) in one transaction and resolves with the result of the request it
// returns, once the transaction has committed.
async function run(names, mode, action) {
  const transaction = (await db()).transaction(names, mode);
  const request = action(...names.map((name) => transaction.objectStore(name)));
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function checkId(id) {
  if (!SESSION_ID_PATTERN.test(String(id))) throw new Error("Invalid session id");
  return id;
}

export const sessions = {
  save: (conversation) =>
    run(["sessions", "meta"], "readwrite", (store, meta) => {
      const record = sessionRecord(conversation);
      meta.put(metaOf(record));
      return store.put(record);
    }),
  // Newest first.
  list: async () => (await run(["meta"], "readonly", (meta) => meta.getAll())).sort((a, b) => b.updated.localeCompare(a.updated)),
  load: async (id) => {
    const session = await run(["sessions"], "readonly", (store) => store.get(checkId(id)));
    if (!session) throw new Error("That session no longer exists.");
    return session;
  },
  remove: (id) =>
    run(["sessions", "meta"], "readwrite", (store, meta) => {
      meta.delete(checkId(id));
      return store.delete(id);
    }),
  removeAll: () =>
    run(["sessions", "meta"], "readwrite", (store, meta) => {
      meta.clear();
      return store.clear();
    }),
};
