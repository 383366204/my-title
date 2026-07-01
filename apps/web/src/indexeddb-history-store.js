export class IndexedDbHistoryStore {
  constructor({ dbName = 'ecom-ai-tools-history', version = 1 } = {}) {
    this.dbName = dbName;
    this.version = version;
  }

  open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('historyRecords')) {
          const records = db.createObjectStore('historyRecords', { keyPath: 'id' });
          records.createIndex('signatureKey', 'signatureKey', { unique: false });
        }
        if (!db.objectStoreNames.contains('historyActions')) {
          db.createObjectStore('historyActions', { keyPath: 'id', autoIncrement: true });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async get(storeName, key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async put(storeName, value) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value);
      request.onsuccess = () => resolve(value);
      request.onerror = () => reject(request.error);
    });
  }

  async upsertSeen(record) {
    const existing = await this.get('historyRecords', record.id);
    const now = new Date().toISOString();
    return this.put('historyRecords', {
      ...record,
      firstSeenAt: existing?.firstSeenAt || record.firstSeenAt || now,
      lastSeenAt: record.lastSeenAt || now,
      seenCount: existing?.seenCount ? existing.seenCount + 1 : record.seenCount || 1
    });
  }

  async upsertSeenBatch(records) {
    const output = [];
    for (const record of records || []) output.push(await this.upsertSeen(record));
    return output;
  }

  async findBySignature(signatureKey) {
    return this.get('historyRecords', signatureKey);
  }

  async markAction(recordId, action, payload = {}) {
    return this.put('historyActions', { recordId, action, payload, createdAt: new Date().toISOString() });
  }
}
