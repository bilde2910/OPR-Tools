export class KeyNotFoundError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "KeyNotFoundError";
  }
}

export interface BaseSchema {
  id: IDBValidKey,
}

export class IDBStoreConnection<T extends BaseSchema> {
  #tx: IDBTransaction;
  #completeHandlers: (() => void)[];
  #objectStore: IDBObjectStore;
  #db: IDBDatabase;
  constructor(db: IDBDatabase, objectStoreName: string, mode: IDBTransactionMode) {
    this.#db = db;
    this.#tx = db.transaction([objectStoreName], mode);
    this.#completeHandlers = [];
    this.#tx.oncomplete = () => {
      for (const handler of this.#completeHandlers) handler();
    };
    this.#objectStore = this.#tx.objectStore(objectStoreName);
  }

  [Symbol.dispose]() {
    this.#db.close();
  }

  get(query: IDBValidKey) {
    return new Promise<T>((resolve, reject) => {
      const req = this.#objectStore.get(query);
      req.onsuccess = () => {
        if (typeof req.result !== "undefined") resolve(req.result);
        else throw new KeyNotFoundError(`Key not found: ${query}`);
      };
      req.onerror = () => reject();
    });
  }

  getAll() {
    return new Promise<T[]>((resolve, reject) => {
      const req = this.#objectStore.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject();
    });
  }

  keys() {
    return new Promise<T["id"][]>((resolve, reject) => {
      const req = this.#objectStore.getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject();
    });
  }

  async *iterate() {
    const keys = await this.keys();
    for (const key of keys) {
      yield await this.get(key);
    }
  }

  put(...values: T[]) {
    const store = this.#objectStore;
    for (const value of values) store.put(value);
  }

  clear() {
    return new Promise<void>((resolve, reject) => {
      const req = this.#objectStore.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject();
    });
  }

  on(event: "complete", callback: () => void) {
    if (event === "complete") this.#completeHandlers.push(callback);
  }

  commit() {
    this.#tx.commit();
  }
}
