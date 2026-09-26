// Thin promise-based wrapper around a single IndexedDB database.
// Stores: assets (uploaded/sample images), characters, objects, scenes,
// folders (asset library organization).

const DB_NAME = 'cartoonmaker';
const DB_VERSION = 2;
const STORES = ['assets', 'characters', 'objects', 'scenes', 'folders'];

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDb().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function putRecord(storeName, record) {
  const store = await tx(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(record);
    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error);
  });
}

export async function getRecord(storeName, id) {
  const store = await tx(storeName, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function getAll(storeName) {
  const store = await tx(storeName, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteRecord(storeName, id) {
  const store = await tx(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// --- Asset blob URL cache -------------------------------------------------
// Object URLs are process-local; keep a cache so repeated renders don't leak them.
const urlCache = new Map();

export async function getAssetUrl(assetId) {
  if (!assetId) return null;
  if (urlCache.has(assetId)) return urlCache.get(assetId);
  const asset = await getRecord('assets', assetId);
  if (!asset) return null;
  const url = URL.createObjectURL(asset.blob);
  urlCache.set(assetId, url);
  return url;
}

export async function importAssetFile(file, folderId = null) {
  const id = uid('asset');
  const record = {
    id,
    name: file.name || 'untitled',
    mime: file.type || 'image/png',
    blob: file,
    folderId,
    createdAt: Date.now(),
  };
  await putRecord('assets', record);
  return record;
}

// Register a sample asset (bundled with the app) into the asset store the
// first time the app runs, so scenes/characters can reference it by id like
// any uploaded asset.
export async function importAssetFromUrl(url, name, id, folderId = null) {
  const existing = await getRecord('assets', id);
  if (existing) return existing;
  const res = await fetch(url);
  const blob = await res.blob();
  const record = { id, name, mime: blob.type || 'image/png', blob, folderId, createdAt: Date.now() };
  await putRecord('assets', record);
  return record;
}
