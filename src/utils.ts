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

//#region requests / urls

/**
 * Sends a request with the specified parameters and returns the response as a Promise.  
 * Ignores the CORS policy, contrary to fetch and fetchAdvanced.  
 * ⚠️ Requires the directive `@grant GM.xmlhttpRequest`
 */
export function sendRequest<T = any>(details: GM.Request<T>) {
  return new Promise<GM.Response<T>>((resolve, reject) => {
    GM.xmlHttpRequest({
      timeout: 10_000,
      ...details,
      onload: resolve,
      onerror: reject,
      ontimeout: reject,
      onabort: reject,
    });
  });
}

/**
 * Opens the given URL in a new tab
 */
export function openInTab(href: string) {
  window.open(href, "_blank", "noopener noreferrer");
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
