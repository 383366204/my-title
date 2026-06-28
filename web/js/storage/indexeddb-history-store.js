'use strict';

class BrowserIndexedDbHistoryStore {
  constructor(options = {}) {
    this.dbName = options.dbName || window.HistoryStoreContract.dbName;
    this.dbVersion = options.dbVersion || window.HistoryStoreContract.dbVersion;
    this.dbPromise = null;
  }

  open() {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.dbVersion);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('historyRecords')) {
          const records = db.createObjectStore('historyRecords', { keyPath: 'id' });
          records.createIndex('keywordKey', 'keywordKey', { unique: false });
          records.createIndex('signatureKey', 'signatureKey', { unique: false });
          records.createIndex('coreProductKey', 'coreProductKey', { unique: false });
          records.createIndex('status', 'status', { unique: false });
          records.createIndex('lastSeenAt', 'lastSeenAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('historyActions')) {
          const actions = db.createObjectStore('historyActions', { keyPath: 'id', autoIncrement: true });
          actions.createIndex('recordId', 'recordId', { unique: false });
          actions.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbPromise;
  }

  async get(storeName, key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async put(storeName, value) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
    });
  }

  async upsertSeen(record) {
    const existing = await this.get('historyRecords', record.id);
    const now = new Date().toISOString();
    const next = {
      ...record,
      firstSeenAt: existing && existing.firstSeenAt ? existing.firstSeenAt : (record.firstSeenAt || now),
      lastSeenAt: record.lastSeenAt || now,
      seenCount: existing && Number.isFinite(existing.seenCount) ? existing.seenCount + 1 : (record.seenCount || 1)
    };
    return this.put('historyRecords', next);
  }

  async upsertSeenBatch(records) {
    const db = await this.open();
    const now = new Date().toISOString();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('historyRecords', 'readwrite');
      const store = tx.objectStore('historyRecords');
      const output = [];
      let pending = records.length;
      if (pending === 0) {
        resolve([]);
        return;
      }

      for (const record of records) {
        const getReq = store.get(record.id);
        getReq.onsuccess = () => {
          const existing = getReq.result || null;
          const next = {
            ...record,
            firstSeenAt: existing && existing.firstSeenAt ? existing.firstSeenAt : (record.firstSeenAt || now),
            lastSeenAt: record.lastSeenAt || now,
            seenCount: existing && Number.isFinite(existing.seenCount) ? existing.seenCount + 1 : (record.seenCount || 1)
          };
          output.push(next);
          store.put(next);
          pending -= 1;
        };
        getReq.onerror = () => reject(getReq.error);
      }
      tx.oncomplete = () => resolve(output);
      tx.onerror = () => reject(tx.error);
    });
  }

  async findBySignature(signatureKey) {
    return this.get('historyRecords', signatureKey);
  }

  async markAction(recordId, action, payload = {}) {
    return this.put('historyActions', {
      recordId,
      action,
      payload,
      createdAt: new Date().toISOString()
    });
  }
}

window.BrowserIndexedDbHistoryStore = BrowserIndexedDbHistoryStore;
