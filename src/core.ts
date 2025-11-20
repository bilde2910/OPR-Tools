import { BaseSchema, IDBStoreConnection } from "./idb";
import { ApiResult, Requests, Responses } from "./types";
import { unilTruthy, cyrb53, iterObject, makeChildNode, Logger } from "./utils";
import { CorePluginAPI } from "./scripts/opr-tools-core";

import ImportIcon from "../assets/import.svg";

const CORE_ADDON_ID = "opr-tools-core";
const ADDON_APIS: {
  [CORE_ADDON_ID]?: CorePluginAPI,
} = {};

let userHash = 0;
let language = "en";

type UnspecAddon = Addon<any, any, any, any>;
type IDBStoreDeclaration<T> = {
  [ P in keyof T ]: BaseSchema
};

const addons = <UnspecAddon[]>[];
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
  clear: () => void,
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

export class SelectBoxEditor<T extends string> implements OptionEditor<T> {
  options: Record<T, string>;
  constructor(options: Record<T, string>) {
    this.options = options;
  }

  render(opts: RendererOptions<T>) {
    const label = makeChildNode(opts.parent, "label", `${opts.label}: `);
    if (opts.help) {
      label.title = opts.help;
      label.classList.add("oprtcore-help-available");
    }
    const select = document.createElement("select");
    label.appendChild(select);
    for (const [v, label] of iterObject(this.options)) {
      const option = document.createElement("option");
      option.textContent = label;
      option.value = v;
      select.appendChild(option);
    }
    select.classList.add("oprtcore-fix");
    select.value = opts.value;
    select.addEventListener("change", () => {
      opts.save(select.value as T);
    });
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
      if (input.value === "") opts.clear();
      else (opts.save(new Date(input.value).getTime()));
    });
  }
}

interface NumericInputEditorOptions {
  min?: number,
  max?: number,
  step?: number,
}

export class NumericInputEditor implements OptionEditor<number> {
  options?: NumericInputEditorOptions;
  constructor(options?: NumericInputEditorOptions) {
    this.options = options;
  }

  render(opts: RendererOptions<number>) {
    const label = makeChildNode(opts.parent, "label", `${opts.label}: `);
    if (opts.help) {
      label.title = opts.help;
      label.classList.add("oprtcore-help-available");
    }
    const input = document.createElement("input");
    input.type = "number";
    if (typeof this.options?.min !== "undefined") input.min = this.options.min.toString();
    if (typeof this.options?.max !== "undefined") input.max = this.options.max.toString();
    if (typeof this.options?.step !== "undefined") input.step = this.options.step.toString();
    label.appendChild(input);
    input.classList.add("oprtcore-fix");
    input.value = opts.value.toString();
    input.addEventListener("change", () => {
      if (input.value === "") opts.clear();
      else if ((this.options?.step ?? 1) < 1) opts.save(parseFloat(input.value));
      else opts.save(parseInt(input.value));
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
) => void;

class AddonSettings<T> {
  storage: Storage;
  key: string;
  defaults: T;
  addEditor: SetUserEditableCallable<T>;

  constructor(
    storage: Storage,
    key: string,
    defaults: T,
    addEditor: SetUserEditableCallable<T>,
  ) {
    this.storage = storage;
    this.key = key;
    this.defaults = defaults;
    this.addEditor = addEditor;
  }

  get<Tk extends keyof T>(key: Tk): T[Tk] {
    const data = this.storage.getItem(`opr-tools-settings-${userHash}`) ?? "{}";
    const props: T = JSON.parse(data)[this.key] ?? {};
    if (Object.prototype.hasOwnProperty.call(props, key)) {
      return props[key];
    } else {
      return this.defaults[key];
    }
  }

  set<Tk extends keyof T>(key: Tk, value: T[Tk]) {
    const data = this.storage.getItem(`opr-tools-settings-${userHash}`) ?? "{}";
    const props = JSON.parse(data);
    if (!Object.prototype.hasOwnProperty.call(props, this.key)) {
      props[this.key] = {};
    }
    props[this.key][key] = value;
    const nData = JSON.stringify(props);
    this.storage.setItem(`opr-tools-settings-${userHash}`, nData);
  }

  clear<Tk extends keyof T>(key: Tk) {
    const data = this.storage.getItem(`opr-tools-settings-${userHash}`) ?? "{}";
    const props = JSON.parse(data);
    if (!Object.prototype.hasOwnProperty.call(props, this.key)) {
      props[this.key] = {};
    }
    if (Object.prototype.hasOwnProperty.call(props[this.key], key)) {
      delete props[this.key][key];
    }
    const nData = JSON.stringify(props);
    this.storage.setItem(`opr-tools-settings-${userHash}`, nData);
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

  const logger = new Logger("core:idb");
  const openRequest = indexedDB.open(`opr-tools-${userHash}`, version);
  openRequest.onsuccess = () => {
    const db = openRequest.result;
    const dbVer = db.version;
    logger.info(`IndexedDB initialization complete (database version ${dbVer}).`);
    if (!db.objectStoreNames.contains(objectStoreName)) {
      db.close();
      logger.info(`Database does not contain column ${objectStoreName}. Closing and incrementing version.`);
      getIDBInstance(objectStoreName, dbVer + 1).then(resolve).catch(reject);
    } else {
      resolve(db);
    }
  };
  openRequest.onupgradeneeded = () => {
    logger.info("Upgrading database...");
    const db = openRequest.result;
    if (!db.objectStoreNames.contains(objectStoreName)) {
      db.createObjectStore(objectStoreName, { keyPath: "id" });
    }
  };
});

const getNotificationDiv = () => {
  const div = document.getElementById("oprtcore-notifications");
  if (div) return div;
  const nc = makeChildNode(document.getElementsByTagName("body")[0], "div");
  nc.id = "oprtcore-notifications";
  return nc;
};

interface SidebarMenuItem {
  imageUrl: string,
  label: string,
  callback: () => void,
}

interface Importer {
  title: string,
  description: string,
  callback: () => void,
  icon?: string,
}

const sidebarItems: Record<string, SidebarMenuItem> = {};
const importers: Importer[] = [];

const createSidebarItems = (sidebar: Node) => {
  for (const [id, item] of iterObject(sidebarItems)) {
    const elId = `oprtcore-sidebar-item-${id}`;
    if (document.getElementById(elId) === null) {
      const div = makeChildNode(sidebar, "div");
      div.id = elId;
      const anchor = makeChildNode(div, "a");
      anchor.classList.add("sidebar-link");
      anchor.title = item.label;
      anchor.addEventListener("click", () => item.callback());
      const img = makeChildNode(anchor, "img") as HTMLImageElement;
      img.classList.add("sidebar-link__icon", "oprtcore-sidebar-icon");
      img.src = item.imageUrl;
      makeChildNode(anchor, "span", item.label);
    }
  }
};

const addSidebarItem = async (id: string, item: SidebarMenuItem) => {
  if (id in sidebarItems) {
    throw new Error(`Tried to add already existing sidebar item ${id}`);
  }
  sidebarItems[id] = item;
  const sidebar = await unilTruthy(() => document.querySelector("app-sidebar-link"));
  createSidebarItems(sidebar.parentNode!);
};

export interface SanitizedAddon {
  id: string,
  name: string,
  authors: string[],
  description: string,
  url?: string,
}

export type NotificationColor = "red" | "green" | "blue" | "purple" | "gold" | "gray" | "brown" | "dark-gray";

class AddonToolbox<Tcfg, Tidb extends IDBStoreDeclaration<Tidb>, Tsess> {
  #addon: Addon<Tcfg, Tidb, Tsess, unknown>;
  constructor(addon: Addon<Tcfg, Tidb, Tsess, unknown>) {
    this.#addon = addon;
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
        const logger = new Logger("core:toolbox");
        logger.error(e);
      }
    }
    this.interceptOpen(method, url, handle);
  }

  public manipulateOpenJson<Tm extends keyof Responses, Tu extends keyof Responses[Tm]>(method: Tm, url: Tu, callback: (obj: Responses[Tm][Tu]) => Responses[Tm][Tu]) {
    if (typeof url !== "string") throw Error("Invalid URL type");
    function handle(_event: Event) {
      try {
        const resp = this.response;
        const json: ApiResult<Responses[Tm][Tu]> = JSON.parse(resp);
        if (!json) return;
        if (json.captcha) return;
        const nv = callback(json.result);
        json.result = nv;
        Object.defineProperty(this, "response", { writable: true });
        this.response = JSON.stringify(json);
        Object.defineProperty(this, "response", { writable: false });
      } catch (e) {
        const logger = new Logger("core:toolbox");
        logger.error(e);
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

  public filterSend(method: string, url: string, filter: (data: string, request: XMLHttpRequest) => boolean) {
    const addonId = this.#addon.id;
    (function (open) {
      XMLHttpRequest.prototype.open = function (m, u) {
        this._oprTools = {
          method: m,
          url: u,
        };
        const args: any = arguments;
        open.apply(this, args);
      };
    })(XMLHttpRequest.prototype.open);
    (function (send) {
      XMLHttpRequest.prototype.send = function (body: string) {
        if (this._oprTools.method !== method || this._oprTools.url !== url || filter(body, this)) {
          const args: any = arguments;
          send.apply(this, args);
        } else {
          const logger = new Logger("core:toolbox");
          logger.warn(`OPR Tools addon ${addonId} blocked a ${method} request to ${url}!`);
        }
      };
    })(XMLHttpRequest.prototype.send);
  }

  public interceptSendJson<Tu extends keyof Requests & keyof Responses["POST"]>(url: Tu, callback: (sent: Requests[Tu], received: Responses["POST"][Tu]) => void) {
    function handle(data: string, request: XMLHttpRequest, _event: Event) {
      try {
        const resp = request.response;
        const jSent: Requests[Tu] = JSON.parse(data);
        const jRecv: ApiResult<Responses["POST"][Tu]> = JSON.parse(resp);
        if (!jRecv) return;
        if (jRecv.captcha) return;
        callback(jSent, jRecv.result);
      } catch (e) {
        const logger = new Logger("core:toolbox");
        logger.error(e);
      }
    }
    this.interceptSend(url, handle);
  }

  public filterSendJson<Tm extends keyof Responses, Tu extends keyof Requests & keyof Responses[Tm]>(method: Tm, url: Tu, callback: (sent: Requests[Tu]) => boolean) {
    function handle(data: string) {
      try {
        const jSent: Requests[Tu] = JSON.parse(data);
        return callback(jSent);
      } catch (e) {
        const logger = new Logger("core:toolbox");
        logger.error(e);
        return true;
      }
    }
    this.filterSend(method, url, handle);
  }

  public listAvailableAddons() {
    return addons.map((a: UnspecAddon) => {
      const copy = {...a} as Partial<UnspecAddon> & SanitizedAddon;
      delete copy.defaultConfig;
      delete copy.sessionData;
      delete copy.initialize;
      return copy as SanitizedAddon;
    });
  }

  public notify(options: {
    color: NotificationColor,
    message: string | Node,
    icon?: string,
    dismissable?: boolean,
  }) {
    const div = getNotificationDiv();
    const message = typeof options.message === "string" ? document.createTextNode(options.message) : options.message;

    const notification = makeChildNode(div, "div");
    notification.classList.add("oprtcore-notification", `oprtcore-nbg-${options.color}`);
    if (options.dismissable ?? true) {
      notification.addEventListener("click", () => notification.remove());
    }
    const contentWrapper = makeChildNode(notification, "div");
    contentWrapper.classList.add("oprtcore-notify-content-wrapper");

    if (typeof options.icon !== "undefined") {
      const iconWrapper = makeChildNode(contentWrapper, "div");
      iconWrapper.classList.add("oprtcore-notify-icon-wrapper");
      const img = makeChildNode(iconWrapper, "img") as HTMLImageElement;
      img.src = options.icon;
    }

    const content = makeChildNode(contentWrapper, "p");
    content.appendChild(message);
    return notification;
  }

  public addSidebarItem(id: string, item: SidebarMenuItem) {
    void addSidebarItem(`addon-${this.#addon.id}-${id}`, item);
  }

  public async createModal(...cssClasses: string[]) {
    const body = await unilTruthy(() => document.querySelector("body"));
    const outer = makeChildNode(body, "div");
    outer.classList.add("oprtcore-fullscreen-overlay");
    const inner = makeChildNode(outer, "div");
    inner.classList.add("oprtcore-fullscreen-inner", ...cssClasses);
    return {
      container: inner,
      dismiss: () => outer.remove(),
    };
  }

  public addImporter(importer: Importer) {
    importers.push(importer);
    if (!("core-importer" in sidebarItems)) {
      void addSidebarItem("core-importer", {
        imageUrl: ImportIcon,
        label: "Import Data",
        callback: async () => {
          const { container, dismiss } = await this.createModal("oprtcore-modal-common", "oprtcore-import-options");
          makeChildNode(container, "h1", "Import data to OPR Tools");
          makeChildNode(container, "p", "Please select the kind of data you want to import.");
          for (const method of importers) {
            const btn = makeChildNode(container, "div");
            btn.classList.add("oprtcore-import-method");
            if (typeof method.icon !== "undefined") {
              btn.style.paddingLeft = "60px";
              btn.style.backgroundImage = `url(${method.icon})`;
            }
            makeChildNode(btn, "p", method.title).classList.add("oprtcore-import-method-title");
            makeChildNode(btn, "p", method.description).classList.add("oprtcore-import-method-desc");
            btn.addEventListener("click", () => {
              dismiss();
              method.callback();
            });
          }
        },
      });
    }
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

  public async openIDB<Tk extends keyof Tidb & string>(objectStoreName: Tk, mode: "readonly" | "readwrite") {
    const scopedOSN = `${this.#addon.id}-${objectStoreName}`;
    const db = await getIDBInstance(scopedOSN);
    return new IDBStoreConnection<Tidb[Tk]>(db, scopedOSN, mode);
  }

  public get session() {
    return new AddonSettings<Tsess>(
      sessionStorage,
      this.#addon.id,
      this.#addon.sessionData,
      () => {},
    );
  }

  public getAddonAPI<Ti extends keyof typeof ADDON_APIS>(addon: Ti): typeof ADDON_APIS[Ti] {
    return ADDON_APIS[addon];
  }
}

export interface Addon<Tcfg, Tidb extends IDBStoreDeclaration<Tidb>, Tsess, Tapi> extends SanitizedAddon {
  defaultConfig: Tcfg,
  sessionData: Tsess,
  initialize: (
    toolbox: AddonToolbox<Tcfg, Tidb, Tsess>,
    logger: Logger,
    config: AddonSettings<Tcfg>,
  ) => Tapi,
}

interface AddonOptionsEntry {
  addon: UnspecAddon,
  options: Record<PropertyKey, InternalEditableOption<any, any>>,
}

export const register = <Tidb extends IDBStoreDeclaration<Tidb>, Tapi>() => <Tcfg, Tsess>(addon: Addon<Tcfg, Tidb, Tsess, Tapi>) => addons.push(addon);
export const initializeAllAddons = () => {
  const logger = new Logger("core:init");
  if (initialized) {
    throw new Error("Addons have already been initialized!");
  }
  initialized = true;
  const coreSettings = new AddonSettings(
    localStorage,
    CORE_ADDON_ID,
    { activePlugins: <string[]>[] },
    () => {},
  );
  const toInitialize = [
    CORE_ADDON_ID,
    ...coreSettings.get("activePlugins").filter(n => n !== CORE_ADDON_ID),
  ];
  logger.info("Preparing to initialize addons", toInitialize);
  const options: Record<string, AddonOptionsEntry> = {};
  for (const addon of addons) {
    if (toInitialize.includes(addon.id)) {
      logger.info(`Initializing addon ${addon.id}...`);
      const api = addon.initialize(
        new AddonToolbox(addon),
        new Logger(`addon:${addon.id}`),
        new AddonSettings(
          localStorage,
          addon.id,
          addon.defaultConfig,
          (key, opts) => {
            if (!(addon.id in options)) {
              options[addon.id] = { addon, options: {} };
            }
            options[addon.id].options[key] = opts;
          },
        ),
      );
      if (api) {
        ADDON_APIS[addon.id as keyof typeof ADDON_APIS] = api;
      }
    }
  }
  if (Object.keys(options).length > 0) {
    logger.info("Hooking settings editor...");
    const toolbox = new AddonToolbox({} as any);
    toolbox.interceptOpenJson(
      "GET", "/api/v1/vault/settings",
      renderEditors(Object.values(options)),
    );
  }
  logger.info("Addon initialization done.");
};

const renderEditors = (options: AddonOptionsEntry[]) => async () => {
  const ref = await unilTruthy(() => document.querySelector("app-settings"));
  const box = makeChildNode(ref, "div");
  box.classList.add("max-w-md");
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

    for (const [key, option] of iterObject(entry.options)) {
      const lineItem = makeChildNode(entryBody, "div");
      lineItem.classList.add("oprtcore-option-line");

      option.editor.render({
        value: option.iface.get(key),
        parent: lineItem,
        save: (v: any) => option.iface.set(key, v),
        clear: () => option.iface.clear(key),
        ...option,
      });
    }
  }
};
