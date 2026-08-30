const DB_NAME = "infinite-whiteboard";
const DB_VERSION = 1;
const BOARD_STORE = "boards";
const ASSET_STORE = "assets";
let dbPromise;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BOARD_STORE)) db.createObjectStore(BOARD_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(ASSET_STORE)) db.createObjectStore(ASSET_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function transact(storeName, mode, operation) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = operation(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

export const boardDb = {
  get: (id = "default") => transact(BOARD_STORE, "readonly", (store) => store.get(id)),
  put: (board) => transact(BOARD_STORE, "readwrite", (store) => store.put(board)),
};

export const assetDb = {
  get: (id) => transact(ASSET_STORE, "readonly", (store) => store.get(id)),
  put: (asset) => transact(ASSET_STORE, "readwrite", (store) => store.put(asset)),
  delete: (id) => transact(ASSET_STORE, "readwrite", (store) => store.delete(id)),
  all: () => transact(ASSET_STORE, "readonly", (store) => store.getAll()),
};
