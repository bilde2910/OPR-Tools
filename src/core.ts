import { ApiResult, UserProperties } from "./types";
import { cyrb53 } from "./utils";

let userHash = 0;
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

const AddonUtils = {
  intercept, interceptJson
};

export interface Addon<T> {
  id: string,
  defaultConfig: T,
  initialize: (toolbox: typeof AddonUtils, config: AddonSettings<T>) => void,
}

export const register = <T>(addon: Addon<T>) => {
  addon.initialize(AddonUtils, new AddonSettings(addon.id, addon.defaultConfig));
};
