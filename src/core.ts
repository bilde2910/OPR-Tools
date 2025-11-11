import { ApiResult, UserProperties } from "./types";
import { cyrb53 } from "./utils";

const CORE_ADDON_ID = "opr-tools-core";

let userHash = 0;
const addons = <Addon<any>[]>[];
let initialized = false;

export const initializeUserHash = () => new Promise((resolve: (v: number) => void, reject) => {
  if (userHash !== 0) {
    reject("Cannot reconfigure user hash");
  } else {
    interceptJson("GET", "/api/v1/vault/properties", (props: UserProperties) => {
      userHash = props.socialProfile?.email ? cyrb53(props.socialProfile.email) : 0;
      resolve(userHash);
    });
  }
});

class AddonSettings<T> {
  key: string;
  defaults: T;

  constructor(key: string, defaults: T) {
    this.key = key;
    this.defaults = defaults;
  }

  get(key: keyof T): T extends { [key]: infer V } ? V : never {
    const data = localStorage.getItem(`opr-tools-settings-${userHash}`) ?? "{}";
    const props = JSON.parse(data)[this.key] ?? {};
    if (Object.prototype.hasOwnProperty.call(props, key)) {
      return props[key];
    } else {
      return this.defaults[key];
    }
  }

  set(key: keyof T, value: T extends { [key]: infer V } ? V : never) {
    const data = localStorage.getItem(`opr-tools-settings-${userHash}`) ?? "{}";
    const props = JSON.parse(data);
    if (!Object.prototype.hasOwnProperty.call(props, this.key)) {
      props[this.key] = {};
    }
    props[this.key][key] = value;
    const nData = JSON.stringify(props);
    localStorage.setItem(`opr-tools-settings-${userHash}`, nData);
  }
}

function intercept(method: string, url: string, callback: (e: Event) => any) {
  (function (open) {
    XMLHttpRequest.prototype.open = function (m, u) {
      if (u === url && m == method) {
        this.addEventListener("load", callback, false);
      }
      open.apply(this, arguments);
    };
  })(XMLHttpRequest.prototype.open);
}

function interceptJson<T>(method: string, url: string, callback: (obj: T) => any) {
  function handle(_: Event) {
    try {
      const resp = this.response;
      const json: ApiResult<T> = JSON.parse(resp);
      if (!json) return;
      if (json.captcha) return;
      callback(json.result);
    } catch (e) {
      console.error(e);
    }
  }
  intercept(method, url, handle);
}

const listAvailableAddons = () => addons.map((a: Addon<any>): SanitizedAddon => {
  const copy: any = {...a};
  delete copy.defaultConfig;
  delete copy.initialize;
  return copy;
});

export interface SanitizedAddon {
  id: string,
  name: string,
  authors: string[],
  description: string,
  url?: string,
}

interface AddonToolbox {
  intercept: typeof intercept,
  interceptJson: typeof interceptJson,
  listAvailableAddons: typeof listAvailableAddons,
  log: (...data: any) => void,
}

export interface Addon<T> extends SanitizedAddon {
  defaultConfig: T,
  initialize: (toolbox: AddonToolbox, config: AddonSettings<T>) => void,
}

export const register = <T>(addon: Addon<T>) => addons.push(addon);
export const initializeAllAddons = () => {
  if (initialized) {
    throw new Error("Addons have already been initialized!");
  }
  initialized = true;
  const coreSettings = new AddonSettings(CORE_ADDON_ID, { 
    activePlugins: <string[]>[],
  });
  const toInitialize = [
    CORE_ADDON_ID,
    ...coreSettings.get("activePlugins").filter(n => n !== CORE_ADDON_ID),
  ];
  console.log(toInitialize);
  for (const addon of addons) {
    if (toInitialize.includes(addon.id)) {
      const AddonUtils = {
        intercept,
        interceptJson,
        listAvailableAddons,
        log: (...data: any) => console.log(`OPR-Tools[${addon.id}]:`, ...data),
      };
      console.log(`Initializing addon ${addon.id}...`);
      addon.initialize(AddonUtils, new AddonSettings(addon.id, addon.defaultConfig));
    }
  }
  console.log("Addon initialization done.");
};
