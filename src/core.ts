import { AnyReview, ApiResult, Profile, Showcase, SubmissionsResult, UserSettings } from "./types";
import { awaitElement, cyrb53, makeChildNode } from "./utils";

const CORE_ADDON_ID = "opr-tools-core";

let userHash = 0;
let language = "en";

const addons = <Addon<any>[]>[];
let initialized = false;

export const initializeUserHash = () => new Promise<number>((resolve, reject) => {
  if (userHash !== 0) {
    reject("Cannot reconfigure user hash");
  } else {
    const req = new XMLHttpRequest();
    req.open("GET", "/api/v1/vault/properties");
    req.addEventListener("load", () => {
      const props = JSON.parse(req.responseText).result;
      if (req.status >= 200 && req.status < 400) {
        userHash = props.socialProfile?.email ? cyrb53(props.socialProfile.email) : 0;
        language = props.language;
        resolve(userHash);
      }
    });
    req.send();
  }
});

interface OptionMetadata {
  label: string,
  help?: string,
}

interface RendererOptions<T> extends OptionMetadata {
  value: T,
  parent: HTMLElement,
  save: (v: T) => void,
}

interface OptionEditor<T> {
  render: (opts: RendererOptions<T>) => void,
}

export class CheckboxEditor implements OptionEditor<boolean> {
  render(opts: RendererOptions<boolean>) {
    const label = makeChildNode(opts.parent, "label");
    if (opts.help) {
      label.title = opts.help;
      label.classList.add("oprtcore-help-available");
    }
    const checkbox = document.createElement("input");
    label.appendChild(checkbox);
    checkbox.setAttribute("type", "checkbox");
    if (opts.value) checkbox.setAttribute("checked", "checked");
    checkbox.addEventListener("change", () => {
      opts.save(!!checkbox.checked);
    });
    makeChildNode(label, "span", ` ${opts.label} `);
  }
}

export class UnixTimestampDateOnlyEditor implements OptionEditor<number> {
  render(opts: RendererOptions<number>) {
    const label = makeChildNode(opts.parent, "label", `${opts.label}: `);
    if (opts.help) {
      label.title = opts.help;
      label.classList.add("oprtcore-help-available");
    }
    const input = document.createElement("input");
    label.appendChild(input);
    input.classList.add("oprtcore-fix");
    input.setAttribute("type", "date");
    input.value = opts.value ? new Date(opts.value).toISOString().substring(0, 10) : "";
    input.addEventListener("change", () => {
      if (input.value === "") opts.save(0);
      else (opts.save(new Date(input.value).getTime()));
    });
  }
}

interface UserEditableOption<T> extends OptionMetadata {
  editor: OptionEditor<T>,
}

interface InternalEditableOption<T, Ti> extends UserEditableOption<Ti> {
  iface: AddonSettings<T>,
}

type SetUserEditableCallable<T> = <Tk extends keyof T>(
  key: Tk,
  options: InternalEditableOption<T, T[Tk]>,
) => void

class AddonSettings<T> {
  private key: string;
  private defaults: T;
  addEditor: SetUserEditableCallable<T>;

  constructor(
    key: string,
    defaults: T,
    addEditor: SetUserEditableCallable<T>
  ) {
    this.key = key;
    this.defaults = defaults;
    this.addEditor = addEditor;
  }

  get<Tk extends keyof T>(key: Tk): T[Tk] {
    const data = localStorage.getItem(`opr-tools-settings-${userHash}`) ?? "{}";
    const props: T = JSON.parse(data)[this.key] ?? {};
    if (Object.prototype.hasOwnProperty.call(props, key)) {
      return props[key];
    } else {
      return this.defaults[key];
    }
  }

  set<Tk extends keyof T>(key: Tk, value: T[Tk]) {
    const data = localStorage.getItem(`opr-tools-settings-${userHash}`) ?? "{}";
    const props = JSON.parse(data);
    if (!Object.prototype.hasOwnProperty.call(props, this.key)) {
      props[this.key] = {};
    }
    props[this.key][key] = value;
    const nData = JSON.stringify(props);
    localStorage.setItem(`opr-tools-settings-${userHash}`, nData);
  }

  setUserEditable<Tk extends keyof T>(key: Tk, options: UserEditableOption<T[Tk]>) {
    this.addEditor(key, {...options, iface: this });
  }
}

/**
 * Opens an IDB database connection.
 * IT IS YOUR RESPONSIBILITY TO CLOSE THE RETURNED DATABASE CONNECTION WHEN YOU ARE DONE WITH IT.
 * THIS FUNCTION DOES NOT DO THIS FOR YOU - YOU HAVE TO CALL db.close()!
 * @param objectStoreName The name of the object store to open
 * @param version 
 * @returns 
 */
const getIDBInstance = (objectStoreName: string, version?: number) => new Promise<IDBDatabase>((resolve, reject) => {
  "use strict";

  if (!window.indexedDB) {
    reject("This browser doesn't support IndexedDB!");
    return;
  }

  const openRequest = indexedDB.open(`opr-tools-${userHash}`, version);
  openRequest.onsuccess = (event: any) => {
    const db = event.target!.result;
    const dbVer = db.version;
    console.log(`IndexedDB initialization complete (database version ${dbVer}).`);
    if (!db.objectStoreNames.contains(objectStoreName)) {
      db.close();
      console.log(`Database does not contain column ${objectStoreName}. Closing and incrementing version.`);
      getIDBInstance(objectStoreName, dbVer + 1).then(resolve);
    } else {
      resolve(db);
    }
  };
  openRequest.onupgradeneeded = (event: any) => {
    console.log("Upgrading database...");
    const db = event.target!.result;
    if (!db.objectStoreNames.contains(objectStoreName)) {
      db.createObjectStore(objectStoreName, { keyPath: "id" });
    }
  };
});

export interface SanitizedAddon {
  id: string,
  name: string,
  authors: string[],
  description: string,
  url?: string,
}

interface Responses {
  "GET": {
    "/api/v1/vault/manage": SubmissionsResult,
    "/api/v1/vault/review": AnyReview,
    "/api/v1/vault/home": Showcase,
    "/api/v1/vault/settings": UserSettings,
    "/api/v1/vault/profile": Profile,
  },
}

class AddonToolbox<T> {
  private addon: Addon<T>;
  constructor(addon: Addon<T>) {
    this.addon = addon;
  }

  public interceptOpen(method: string, url: string, callback: (e: Event) => void) {
    (function (open) {
      XMLHttpRequest.prototype.open = function (m, u) {
        if (u === url && m == method) {
          this.addEventListener("load", callback, false);
        }
        const args: any = arguments;
        open.apply(this, args);
      };
    })(XMLHttpRequest.prototype.open);
  }

  public interceptOpenJson<Tm extends keyof Responses, Tu extends keyof Responses[Tm]>(method: Tm, url: Tu, callback: (obj: Responses[Tm][Tu]) => void) {
    if (typeof url !== "string") throw Error("Invalid URL type");
    function handle(_event: Event) {
      try {
        const resp = this.response;
        const json: ApiResult<Responses[Tm][Tu]> = JSON.parse(resp);
        if (!json) return;
        if (json.captcha) return;
        callback(json.result);
      } catch (e) {
        console.error(e);
      }
    }
    this.interceptOpen(method, url, handle);
  }

  public interceptSend(url: string, callback: (data: string, request: XMLHttpRequest, response: Event) => void) {
    (function (send) {
      XMLHttpRequest.prototype.send = function (body: string) {
        this.addEventListener("load", function (e: Event) {
          if (this.responseURL === window.origin + url) {
            callback(body, this, e);
          }
        }, false);
        const args: any = arguments;
        send.apply(this, args);
      };
    })(XMLHttpRequest.prototype.send);
  }

  public interceptSendJson<Ts, Tr>(url: string, callback: (sent: Ts, received: Tr) => void) {
    function handle(data: string, request: XMLHttpRequest, _event: Event) {
      try {
        const resp = request.response;
        const jSent: Ts = JSON.parse(data);
        const jRecv: ApiResult<Tr> = JSON.parse(resp);
        if (!jRecv) return;
        if (jRecv.captcha) return;
        callback(jSent, jRecv.result);
      } catch (e) {
        console.error(e);
      }
    }
    this.interceptSend(url, handle);
  }

  public listAvailableAddons() {
    return addons.map((a: Addon<any>): SanitizedAddon => {
      const copy: any = {...a};
      delete copy.defaultConfig;
      delete copy.initialize;
      return copy;
    });
  }

  public log(...data: any) {
    console.log(`OPR-Tools[${this.addon.id}]:`, ...data);
  }

  public warn(...data: any) {
    console.warn(`OPR-Tools[${this.addon.id}]:`, ...data);
  }

  public get userHash() {
    return userHash;
  }

  public get l10n(): Record<string, string> {
    const i18n = JSON.parse(localStorage["@transloco/translations"]);
    return i18n[language];
  }

  public i18nPrefixResolver(prefix: string) {
    const l10n = this.l10n;
    return (id: string) => l10n[prefix + id];
  }

  public async usingIDB(objectStoreName: string) {
    const scopedOSN = `${this.addon.id}-${objectStoreName}`;
    const db = await getIDBInstance(scopedOSN);
    const transaction = (mode: IDBTransactionMode) =>
      db.transaction([scopedOSN], mode);
    const getStore = (tx: IDBTransaction) =>
      tx.objectStore(scopedOSN);
    return { db, transaction, getStore };
  }
}

export interface Addon<T> extends SanitizedAddon {
  defaultConfig: T,
  initialize: (toolbox: AddonToolbox<T>, config: AddonSettings<T>) => void,
}

interface AddonOptionsEntry {
  addon: Addon<any>,
  options: Record<PropertyKey, InternalEditableOption<any, any>>,
}

export const register = <T>(addon: Addon<T>) => addons.push(addon);
export const initializeAllAddons = () => {
  if (initialized) {
    throw new Error("Addons have already been initialized!");
  }
  initialized = true;
  const coreSettings = new AddonSettings(
    CORE_ADDON_ID,
    { activePlugins: <string[]>[] },
    () => {},
  );
  const toInitialize = [
    CORE_ADDON_ID,
    ...coreSettings.get("activePlugins").filter(n => n !== CORE_ADDON_ID),
  ];
  console.log("Preparing to initialize addons", toInitialize);
  const options: Record<string, AddonOptionsEntry> = {};
  for (const addon of addons) {
    if (toInitialize.includes(addon.id)) {
      console.log(`Initializing addon ${addon.id}...`);
      addon.initialize(
        new AddonToolbox(addon),
        new AddonSettings(
          addon.id,
          addon.defaultConfig,
          (key, opts) => {
            if (!(addon.id in options)) {
              options[addon.id] = { addon, options: {} };
            }
            options[addon.id].options[key] = opts;
          }
        )
      );
    }
  }
  if (Object.keys(options).length > 0) {
    console.log("Hooking settings editor...");
    const dummyAddon: any = {};
    const toolbox = new AddonToolbox(dummyAddon);
    toolbox.interceptOpenJson(
      "GET", "/api/v1/vault/settings",
      renderEditors(Object.values(options))
    );
  }
  console.log("Addon initialization done.");
};

const renderEditors = (options: AddonOptionsEntry[]) => async () => {
  const ref = await awaitElement(() => document.querySelector("app-settings"));
  const box = makeChildNode(ref, "div");
  box.id = "oprtoolsMainPluginSettingsPane";
  const header = makeChildNode(box, "h3", "Plugin Settings");
  header.classList.add("wf-page-header");

  for (const entry of options) {
    const entryBox = makeChildNode(box, "div");
    entryBox.classList.add("settings__item");
    entryBox.classList.add("settings-item");
    const entryHeader = makeChildNode(entryBox, "div");
    entryHeader.classList.add("settings-item__header");
    makeChildNode(entryHeader, "div", entry.addon.name);
    const entryBody = makeChildNode(entryBox, "div");
    entryBody.classList.add("settings-item__description");
    
    for (const [key, option] of Object.entries(entry.options)) {
      option.editor.render({
        value: option.iface.get(key),
        parent: entryBody,
        save: (v: any) => option.iface.set(key, v),
        ...option,
      });
    }
  }
};
