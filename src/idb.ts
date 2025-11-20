import { Logger } from "./utils";

export class KeyNotFoundError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "KeyNotFoundError";
  }
}

export interface BaseSchema {
  id: IDBValidKey,
}

let activeConns = 0;

export class IDBStoreConnection<T extends BaseSchema> {
  #tx: IDBTransaction | null;
  #completeHandlers: (() => void)[];
  #objectStoreName: string;
  #db: IDBDatabase;
  #mode: IDBTransactionMode;
  #logger: Logger;
  constructor(db: IDBDatabase, objectStoreName: string, mode: IDBTransactionMode) {
    this.#logger = new Logger("idb:connection");
    activeConns++;
    this.#logger.debug(`Active IDB connections: ${activeConns} (+1, ${objectStoreName})`);
    this.#db = db;
    this.#completeHandlers = [];
    this.#tx = null;
    this.#objectStoreName = objectStoreName;
    this.#mode = mode;
  }

  [Symbol.dispose]() {
    this.#db.close();
    activeConns--;
    this.#logger.debug(`Active IDB connections: ${activeConns} (-1; ${this.#objectStoreName})`);
  }

  get #objectStore() {
    if (this.#tx === null) {
      this.#tx = this.#db.transaction([this.#objectStoreName], this.#mode);
      this.#tx.oncomplete = () => {
        this.#logger.debug(`IDB transaction completed (${this.#mode}:${this.#objectStoreName}).`);
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
        else reject(new KeyNotFoundError(`Key not found: ${query}`));
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
      const next = await this.get(key);
      this.commit();
      yield next;
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
