// Internal builds only (BROWSBY_INTERNAL=1): every event of each saved conversation, which
// `browser-agent session-logs` writes to files. A database of its own, so the conversations'
// schema is untouched. Past MAX_LINES the oldest lines go.

const MAX_LINES = 100000;
const TRIM_EVERY = 1000;

let dbPromise = null;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("browsby-debug", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("lines", { autoIncrement: true }).createIndex("session", "session");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function trim(store) {
  store.count().onsuccess = (e) => {
    let extra = e.target.result - MAX_LINES;
    if (extra <= 0) return;
    store.openCursor().onsuccess = (c) => {
      const cursor = c.target.result;
      if (!cursor || extra-- <= 0) return;
      cursor.delete();
      cursor.continue();
    };
  };
}

let sinceTrim = 0;
export const debugLog = {
  async append(session, lines) {
    const transaction = (await db()).transaction("lines", "readwrite");
    const store = transaction.objectStore("lines");
    for (const line of lines) store.add({ session, ...line });
    if ((sinceTrim += lines.length) >= TRIM_EVERY) {
      sinceTrim = 0;
      trim(store);
    }
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    });
  },
};
