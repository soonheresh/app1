// IndexedDB 래퍼 — 모든 데이터는 이 기기 브라우저 안에만 저장됩니다.
const DB = (() => {
  const NAME = 'patient-survey';
  const VERSION = 1;
  let dbp;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('surveys')) db.createObjectStore('surveys', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('responses')) {
          const s = db.createObjectStore('responses', { keyPath: 'id' });
          s.createIndex('createdAt', 'createdAt');
          s.createIndex('surveyId', 'surveyId');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let result;
      const r = fn(s);
      if (r) r.onsuccess = () => { result = r.result; };
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  return {
    all: (store) => tx(store, 'readonly', (s) => s.getAll()),
    get: (store, id) => tx(store, 'readonly', (s) => s.get(id)),
    put: (store, obj) => tx(store, 'readwrite', (s) => s.put(obj)),
    del: (store, id) => tx(store, 'readwrite', (s) => s.delete(id)),
    clear: (store) => tx(store, 'readwrite', (s) => s.clear()),
    async bulkPut(store, list) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const t = db.transaction(store, 'readwrite');
        const s = t.objectStore(store);
        list.forEach((o) => s.put(o));
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      });
    },
  };
})();
