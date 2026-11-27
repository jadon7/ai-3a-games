// IndexedDB 小缓存（保存烘焙好的光照数据，二次进入秒开）
function open() {
  return new Promise((res) => {
    try {
      const rq = indexedDB.open('khamsin', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res(null);
    } catch (e) { res(null); }
  });
}
export async function idbGet(key) {
  const db = await open(); if (!db) return null;
  return new Promise((res) => {
    try { const g = db.transaction('kv', 'readonly').objectStore('kv').get(key); g.onsuccess = () => res(g.result || null); g.onerror = () => res(null); } catch (e) { res(null); }
  });
}
export async function idbSet(key, val) {
  const db = await open(); if (!db) return false;
  return new Promise((res) => {
    try { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(val, key); tx.oncomplete = () => res(true); tx.onerror = () => res(false); } catch (e) { res(false); }
  });
}
