function request(operation) {
  const result = {};
  queueMicrotask(() => {
    try { result.result = operation(); result.onsuccess?.(); }
    catch (error) { result.error = error; result.onerror?.(); }
  });
  return result;
}

export function installBrowserStorage() {
  const databases = new Map(); const local = new Map();
  globalThis.innerWidth = 1200; globalThis.innerHeight = 800;
  globalThis.localStorage = { getItem: (key) => local.get(key) ?? null, setItem: (key, value) => local.set(key, String(value)), removeItem: (key) => local.delete(key) };
  globalThis.indexedDB = {
    open(name) {
      const openRequest = {};
      queueMicrotask(() => {
        let record = databases.get(name); const isNew = !record;
        if (!record) { record = { stores: new Map() }; databases.set(name, record); }
        const db = {
          objectStoreNames: { contains: (storeName) => record.stores.has(storeName) },
          createObjectStore(storeName) { record.stores.set(storeName, new Map()); },
          transaction(storeName) {
            const store = record.stores.get(storeName);
            if (!store) throw new Error(`Missing store ${storeName}`);
            return { objectStore: () => ({
              get: (key) => request(() => structuredClone(store.get(key))),
              getAll: () => request(() => [...store.values()].map((value) => structuredClone(value))),
              put: (value) => request(() => { store.set(value.id, structuredClone(value)); return value.id; }),
              delete: (key) => request(() => store.delete(key)),
            }) };
          },
        };
        openRequest.result = db;
        if (isNew) openRequest.onupgradeneeded?.();
        openRequest.onsuccess?.();
      });
      return openRequest;
    },
  };
  return { databases, local };
}
