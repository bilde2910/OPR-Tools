import type resources from "../assets/resources.json";

//#region resources

/** Key of a resource in `assets/resources.json` and extra keys defined by `tools/post-build.ts` */
export type ResourceKey = keyof typeof resources;

/**
 * Returns the URL of a resource by its name, as defined in `assets/resources.json`, from GM resource cache - [see GM.getResourceUrl docs](https://wiki.greasespot.net/GM.getResourceUrl)  
 * Falls back to a `raw.githubusercontent.com` URL or base64-encoded data URI if the resource is not available in the GM resource cache.  
 * ⚠️ Requires the directive `@grant GM.getResourceUrl`
 */
export async function getResourceUrl(name: string) {
  let url = await GM.getResourceUrl(name);
  if(!url || url.length === 0) {
    console.warn(`Couldn't get blob URL nor external URL for @resource '${name}', trying to use base64-encoded fallback`);
    // @ts-ignore
    url = await GM.getResourceUrl(name, false);
  }
  return url;
}

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

export function awaitElement<T>(listener: () => T | null) {
  return new Promise((resolve: (value: T) => void, _reject) => {
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

export const makeChildNode = (parent: Element, tagName: string, content?: string) => {
  const e = document.createElement(tagName);
  if (typeof content !== "undefined") {
    e.textContent = content;
  }
  parent.appendChild(e);
  return e;
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
export const filterObject = (obj: Record<string, any>, keys: string[]) => Object
  .keys(obj)
  .filter(key => keys.includes(key))
  .reduce((nObj, key) => {
    nObj[key] = obj[key]; return nObj;
  }, <Record<string, any>>{});

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

export const readFile = (...accept: string[]) => new Promise((resolve: (v: string | ArrayBuffer | null) => void, reject) => {
  const input = document.createElement("input");
  input.type = "file";
  if (accept.length > 0) {
    input.accept = accept.join(",");
  }
  input.onchange = () => {
    const reader = new FileReader();
    reader.onload = function (e2) {
      resolve(e2.target!.result);
    };
    if (input.files !== null) {
      reader.readAsText(input.files[0]);
    } else {
      reject();
    }
  };
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
