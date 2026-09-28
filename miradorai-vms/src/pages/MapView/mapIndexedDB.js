/**
 * mapIndexedDB.js
 * High-capacity IndexedDB persistent storage for MapView & DesignerView.
 * Prevents 5MB localStorage quota truncation for large 3D models and high-res floor plans.
 */

const DB_NAME = "miradorai_map_db";
const DB_VERSION = 1;
const FLOORS_STORE = "floors_store";
const ZONES_STORE = "zones_store";

function openDB() {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      resolve(null);
      return;
    }
    try {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(FLOORS_STORE)) {
          db.createObjectStore(FLOORS_STORE);
        }
        if (!db.objectStoreNames.contains(ZONES_STORE)) {
          db.createObjectStore(ZONES_STORE);
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveFloorsDB(mapId, floors) {
  try {
    const db = await openDB();
    if (!db) return false;
    return new Promise((resolve) => {
      const tx = db.transaction(FLOORS_STORE, "readwrite");
      const store = tx.objectStore(FLOORS_STORE);
      store.put(floors, `floors_${mapId}`);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (err) {
    console.warn("[IndexedDB] saveFloorsDB failed:", err);
    return false;
  }
}

export async function loadFloorsDB(mapId) {
  try {
    const db = await openDB();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(FLOORS_STORE, "readonly");
      const store = tx.objectStore(FLOORS_STORE);
      const req = store.get(`floors_${mapId}`);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    console.warn("[IndexedDB] loadFloorsDB failed:", err);
    return null;
  }
}

export async function saveZonesDB(mapId, zones) {
  try {
    const db = await openDB();
    if (!db) return false;
    return new Promise((resolve) => {
      const tx = db.transaction(ZONES_STORE, "readwrite");
      const store = tx.objectStore(ZONES_STORE);
      store.put(zones, `zones_${mapId}`);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (err) {
    console.warn("[IndexedDB] saveZonesDB failed:", err);
    return false;
  }
}

export async function loadZonesDB(mapId) {
  try {
    const db = await openDB();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(ZONES_STORE, "readonly");
      const store = tx.objectStore(ZONES_STORE);
      const req = store.get(`zones_${mapId}`);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    console.warn("[IndexedDB] loadZonesDB failed:", err);
    return null;
  }
}
