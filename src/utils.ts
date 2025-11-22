import type resources from "../assets/resources.json";
import { GeofenceMap } from "./types";

//#region resources

/** Key of a resource in `assets/resources.json` and extra keys defined by `tools/post-build.ts` */
export type ResourceKey = keyof typeof resources;

/**
 * Returns the URL of a resource by its name, as defined in `assets/resources.json`, from GM resource cache - [see GM.getResourceUrl docs](https://wiki.greasespot.net/GM.getResourceUrl)  
 * Falls back to a `raw.githubusercontent.com` URL or base64-encoded data URI if the resource is not available in the GM resource cache.  
 * ⚠️ Requires the directive `@grant GM.getResourceUrl`
 */
export async function getResourceUrl(name: ResourceKey) {
  const logger = new Logger("utils:resources");
  let url = await GM.getResourceUrl(name);
  if(!url || url.length === 0) {
    logger.warn(`Couldn't get blob URL nor external URL for @resource '${name}', trying to use base64-encoded fallback`);
    // @ts-ignore
    url = await GM.getResourceUrl(name, false);
  }
  return url;
}

class EOFError extends Error {
  constructor() {
    super("End of file reached");
  }
}

export class ByteReader {
  stream: ReadableStreamDefaultReader<Uint8Array>;
  buffer: Uint8Array;
  offset: number;
  done: boolean;
  constructor(stream: ReadableStream<Uint8Array>) {
    this.stream = stream.getReader();
    this.buffer = new Uint8Array(0);
    this.offset = 0;
    this.done = false;
  }

  async read(length: number): Promise<ArrayBuffer> {
    if (this.buffer.length - this.offset >= length) {
      this.offset += length;
      return this.buffer.slice(this.offset - length, this.offset).buffer;
    } else {
      const firstHalf = this.buffer.slice(this.offset, this.buffer.length);
      const result = await this.stream.read();
      this.done = result.done;
      if (!result.done) {
        this.buffer = result.value;
        this.offset = length - firstHalf.length;
        const secondHalf = this.buffer.slice(0, this.offset);
        const combined = new Uint8Array(length);
        combined.set(firstHalf, 0);
        combined.set(secondHalf, firstHalf.length);
        return combined.buffer;
      } else {
        this.buffer = new Uint8Array(0);
        this.offset = 0;
        if (length > firstHalf.length) throw new EOFError();
        return firstHalf.buffer;
      }
    }
  }
}

let geofenceCache: GeofenceMap | null = null;
export const readGeofences = async () => {
  const logger = new Logger("utils:geofences");
  if (geofenceCache) return geofenceCache;
  logger.info("Reading geofences...");
  const resp = await fetch(await getResourceUrl("geofences"));
  geofenceCache = await resp.json() as GeofenceMap;
  // For binary encoded data
  // Disabled because for some reason this is extremely slow
  /*const ds = new DecompressionStream("gzip");
  const rawStream = resp.body?.pipeThrough(ds);
  const reader = new ByteReader(rawStream!);
  geofenceCache = {};
  const decoder = new TextDecoder();
  while (!reader.done) {
    try {
      const zLength = new Uint8Array(await reader.read(1));
      const zBytes = await reader.read(zLength[0]);
      const zone = decoder.decode(zBytes);
      geofenceCache[zone] = [];
      const pLength = new Uint32Array(await reader.read(4));
      for (let i = 0; i < pLength[0]; i++) {
        const ll = new Float32Array(await reader.read(8));
        geofenceCache[zone].push([ll[0], ll[1]]);
      }
    } catch (e) {
      logger.warn(e);
    }
  }*/
  logger.info("Done reading geofences");
  return geofenceCache;
};

export const isDarkMode = () => !!document.querySelector("html")?.classList.contains("dark");

//#region DOM utils

export let domLoaded = document.readyState === "complete" || document.readyState === "interactive";
document.addEventListener("DOMContentLoaded", () => domLoaded = true);

/**
 * Adds a style element to the DOM at runtime.
 * @param css The CSS stylesheet to add
 * @param ref A reference string to identify the style element - defaults to a random 5-character string
 */
export function addStyle(css: string) {
  if(!domLoaded)
    throw new Error("DOM has not finished loading yet");
  const elem = document.createElement("style");
  elem.innerHTML = css;
  document.querySelector("head")?.appendChild(elem);
  return elem;
}

export function untilTruthy<T>(listener: () => T | null | undefined) {
  return new Promise<T>((resolve, _reject) => {
    const queryLoop = () => {
      const ref = listener();
      if (ref) resolve(ref);
      else setTimeout(queryLoop, 100);
    };
    queryLoop();
  });
}

export function debounce(callback: () => any, wait: number) {
  let timeout: any;
  return (...args: any) => {
    clearTimeout(timeout);
    timeout = setTimeout(function() {
      callback.apply(this, args);
    }, wait);
  };
}

export const makeChildNode = (parent: Node, tagName: string, content?: string) => {
  const e = document.createElement(tagName);
  if (typeof content !== "undefined") {
    e.textContent = content;
  }
  parent.appendChild(e);
  return e;
};

export const insertAfter = (after: Node, node: Node) => {
  after.parentNode!.insertBefore(node, after.nextSibling);
};

//#region Storage utils

// https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js
export const cyrb53 = function(str: string, seed: number = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1>>>16), 2246822507) ^ Math.imul(h2 ^ (h2>>>13), 3266489909);
  h2 = Math.imul(h2 ^ (h2>>>16), 2246822507) ^ Math.imul(h1 ^ (h1>>>13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1>>>0);
};

//#region Miscellaneous

/**
 * Returns an copy of obj containing only the keys specified in the keys array.
 * @param obj The object to remove entries from
 * @param keys The keys to keep
 * @returns 
 */
export const filterObject = <T extends Record<K, T[K]>, K extends keyof T & string>(obj: T, keys: readonly K[]): Pick<T, K> =>
  keys
    .reduce((nObj, key) => {
      nObj[key] = obj[key]; return nObj;
    }, <Pick<T, K>>{});

/**
 * Type-safe version of Object.entries(). The object must be string-keyed.
 * @param obj The object to get entries from
 * @returns An array of pairs of the object's keys and values
 */
export const iterObject = <T extends Record<K, T[K]>, K extends keyof T & string>(obj: T): [K, T[K]][] =>
  Object
    .entries(obj)
    .map(([k, v]) => [k as K, v as T[K]]);
 
/**
 * Type-safe version of Object.keys(). The object must be string-keyed.
 * @param obj The object to get keys from
 * @returns An array of the object's keys
 */
export const iterKeys = <T extends Record<K, T[K]>, K extends keyof T & string>(obj: T): K[] =>
  Object
    .keys(obj)
    .map(k => k as K);

/**
 * Type-safe version of Object.assign(target, ...source).
 * @param target The target to assign to
 * @param source An array of sources to assign from
 * @returns The target that was assigned to
 */
export const assignAll = <Tt extends Record<Kt, Tt[Kt]> & Ts, Kt extends keyof Tt, Ts extends Record<Ks, Ts[Ks]>, Ks extends keyof Ts>(target: Tt, ...source: Ts[]): Tt & Ts =>
  source
    .reduce((t: Tt, s: Ts) => Object.assign(t, s), target);

/**
 * Converts an array of objects of type `T` to a map indexed by a property of `T`.
 * @param arr The list of objects to index
 * @param index The key by which to index
 * @returns An object `{ [T[index]]: T }` for all `T` in `arr`
 */
export const indexToMap = <T extends Record<K, T[K]>, K extends keyof T>(arr: T[], index: K): Record<T[K], T> =>
  assignAll({}, ...arr.map(e => ({ [e[index]]: e })));

export const downloadAsFile = (data: string, type: string, name: string) => {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.setAttribute("download", name);
  anchor.href = url;
  anchor.setAttribute("target", "_blank");
  anchor.click();
  URL.revokeObjectURL(url);
};

export const readFile = (...accept: readonly string[]) => new Promise<File>((resolve, reject) => {
  const input = document.createElement("input");
  input.type = "file";
  if (accept.length > 0) {
    input.accept = accept.join(",");
  }
  input.addEventListener("change", () => {
    if (input.files !== null && input.files.length >= 1) {
      resolve(input.files[0]);
    } else {
      reject();
    }
  });
  input.click();
});

export const readFiles = (...accept: readonly string[]) => new Promise<File[]>((resolve, reject) => {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  if (accept.length > 0) input.accept = accept.join(",");
  input.addEventListener("change", () => {
    if (input.files !== null) {
      resolve([...input.files]);
    } else {
      reject();
    }
  });
  input.click();
});

export const haversine = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const toRad = (x: number) => x * Math.PI / 180;
  const R = 6371; // km

  const x1 = lat2 - lat1;
  const dLat = toRad(x1);
  const x2 = lon2 - lon1;
  const dLon = toRad(x2);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c;

  // returns in meters
  return d * 1000;
};

export const toUtcIsoDate = (d: Date) =>
  `${d.getUTCFullYear()}-` +
  `${(d.getUTCMonth() + 1).toString().padStart(2, "0")}-` +
  `${d.getUTCDate().toString().padStart(2, "0")}`;

export const shiftDays = (date: Date, offset: number) => {
  const nd = new Date(date);
  nd.setUTCDate(nd.getUTCDate() + offset);
  return nd;
};

const mergeArraysToObject = <Ta, Tb>(a: Ta[],  b: Tb[]) =>
  a.map((e, i) => ({ a: e, b: b[i] }));

const weightNumbers = (a: number, b: number, ratio: number) =>
  a * ratio + b * (1 - ratio);

export const weightNumericArray = (arr1: number[], arr2: number[], ratio: number) =>
  mergeArraysToObject(arr1, arr2).map(({a, b}) => weightNumbers(a, b, ratio));

//#region Loggnig

export class Logger {
  #subsystem: string;
  constructor(subsystem: string) {
    this.#subsystem = subsystem;
  }

  debug(...data: any) {
    //console.debug("[D]", "[opr-tools]", `[${this.#subsystem}]`, ...data);
  }
  
  info(...data: any) {
    console.log("[I]", "[opr-tools]", `[${this.#subsystem}]`, ...data);
  };

  warn(...data: any) {
    console.warn("[W]", "[opr-tools]", `[${this.#subsystem}]`, ...data);
  };

  error(...data: any) {
    console.error("[E]", "[opr-tools]", `[${this.#subsystem}]`, ...data);
  };
}
