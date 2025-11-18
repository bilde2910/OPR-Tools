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
  #tx: IDBTransaction | null;
  #completeHandlers: (() => void)[];
  #objectStoreName: string;
  #db: IDBDatabase;
  #mode: IDBTransactionMode;
  constructor(db: IDBDatabase, objectStoreName: string, mode: IDBTransactionMode) {
    this.#db = db;
    this.#completeHandlers = [];
    this.#tx = null;
    this.#objectStoreName = objectStoreName;
    this.#mode = mode;
  }

  [Symbol.dispose]() {
    this.#db.close();
  }

  get #objectStore() {
    if (this.#tx === null) {
      this.#tx = this.#db.transaction([this.#objectStoreName], this.#mode);
      this.#tx.oncomplete = () => {
        for (const handler of this.#completeHandlers) handler();
      };
    }
    return this.#tx.objectStore(this.#objectStoreName);
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
    if (this.#tx !== null) {
      this.#tx.commit();
      this.#tx = null;
    }
  }
}
