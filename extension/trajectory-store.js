// Internal builds only: recorded trajectories (src/trajectory.js), in a database of their own
// on this computer. Nothing here is sent anywhere; the benchmark reads them out over DevTools
// (drain). Retention (RETENTION in src/trajectory.js) is applied on every write.

let dbPromise = null;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("browsby-trajectories", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("trajectories", { keyPath: "id" }).createIndex("endedAt", "endedAt");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

const finished = (transaction) =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  });

export const trajectoryStore = {
  // Adds a record, then drops records older than maxDays and the oldest past maxTrajectories.
  async append(record, { maxDays, maxTrajectories }) {
    const transaction = (await db()).transaction("trajectories", "readwrite");
    const store = transaction.objectStore("trajectories");
    const byEnd = store.index("endedAt");
    store.put(record);
    const cutoff = new Date(Date.now() - maxDays * 86400000).toISOString();
    byEnd.openCursor(IDBKeyRange.upperBound(cutoff, true)).onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        return cursor.continue();
      }
      store.count().onsuccess = (c) => {
        let extra = c.target.result - maxTrajectories;
        if (extra <= 0) return;
        byEnd.openCursor().onsuccess = (o) => {
          const oldest = o.target.result;
          if (!oldest || extra-- <= 0) return;
          oldest.delete();
          oldest.continue();
        };
      };
    };
    return finished(transaction);
  },

  // Every record, removed from the store.
  async drain() {
    const transaction = (await db()).transaction("trajectories", "readwrite");
    const store = transaction.objectStore("trajectories");
    const all = store.getAll();
    store.clear();
    await finished(transaction);
    return all.result;
  },
};
