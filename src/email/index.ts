import diacritics from "./diacritics.json" with { type: "json" };
import { iterObject, Logger, makeChildNode } from "src/utils";
import { decodeBodyUsingCTE, extractEmail, parseMIME } from "./parsing";
import { EmailFile, Header, StoredEmail } from "./types";
import { DisambiguationFailedError, HeaderNotFoundError, InvalidContentTypeError, NoMatchingTemplateError } from "./errors";
import { IDBStoreConnection, KeyNotFoundError } from "src/idb";
import emailTemplates, { EmailTemplate } from "./templates";

type IDBConnectionFactory = (mode: "readonly" | "readwrite") => Promise<IDBStoreConnection<StoredEmail>>;

const SUPPORTED_SENDERS: string[] = [
  "notices@recon.nianticspatial.com",
  "notices@wayfarer.nianticlabs.com",
  "nominations@portals.ingress.com",
  "hello@pokemongolive.com",
  "ingress-support@nianticlabs.com",
  "ingress-support@google.com",
] as const;

type EmailPutStatus = "inserted" | "replaced" | "retained" | "ignored";
type ImportHandler = (email: WayfarerEmail, result: EmailPutStatus) => Promise<void>;
type ActiveListener = AsyncGenerator<ImportHandler>;
export type ImportListener = () => Promise<ActiveListener>;

export class EmailAPI {
  #openIDB: IDBConnectionFactory;
  #listeners: ImportListener[];
  #logger: Logger;
  constructor(idbConn: IDBConnectionFactory) {
    this.#openIDB = idbConn;
    this.#listeners = [];
    this.#logger = new Logger("api:email");
  }

  /**
   * Retrieves the email represented by the given Message-ID.
   * @param id The Message-ID of the email to fetch
   * @throws {KeyNotFoundError} if no email was found by this ID
   * @returns The requested email
   */
  async get(id: string) {
    using idb = await this.#openIDB("readonly");
    return new WayfarerEmail(await idb.get(id));
  }

  async import(
    iterator: AsyncGenerator<EmailFile>,
    report?: (result: EmailPutStatus) => void,
  ) {
    this.#logger.info("Now importing emails from generator!");
    this.#logger.info(`Invoking ${this.#listeners.length} email listeners...`);
    const listeners: ActiveListener[] = [];
    for (const listener of this.#listeners) {
      listeners.push(await listener());
    }
    this.#logger.info("All email listeners were invoked.");

    const counters: Record<EmailPutStatus, number> = {
      inserted: 0,
      replaced: 0,
      retained: 0,
      ignored: 0,
    };
    {
      this.#logger.info("Opening email object store for writing...");
      using idb = await this.#openIDB("readwrite");
      this.#logger.info(`Email store opened; iterating handlers from ${listeners.length} email listeners...`);
      const handlers: ImportHandler[] = [];
      for (const listener of listeners) {
        handlers.push((await listener.next()).value);
      }
      this.#logger.info("All email listeners were iterated.");
      const dispatcher: ImportHandler = async (e, r) => {
        for (const handler of handlers) {
          try {
            await handler(e, r);
          } catch (ex) {
            this.#logger.error("Email event listener threw an exception", e, r, ex);
          }
        }
      };
      this.#logger.info("Now iterating emails...");
      for await (const file of iterator) {
        const result = await this.#put(file, idb, dispatcher);
        counters[result]++;
        if (typeof report !== "undefined") report(result);
      }
      this.#logger.info("Email iteration complete; closing object store...");
    }
    this.#logger.info("Successfully imported emails", counters);
    this.#logger.info(`Finally iterating ${listeners.length} email listeners...`);
    for (const listener of listeners) {
      const result = await listener.next();
      if (!result.done) {
        this.#logger.error("Email event listener did not return", result);
      }
    }
    this.#logger.info("All email listeners were finally iterated.");
    return counters;
  }

  async #put(file: EmailFile, idb: IDBStoreConnection<StoredEmail>, dispatch: ImportHandler): Promise<EmailPutStatus> {
    const email = parseMIME(file.contents);
    const emailAddress = extractEmail(email.getFirstHeaderValue("From"));
    if (!SUPPORTED_SENDERS.includes(emailAddress)) {
      return "ignored";
      /*throw new UnsupportedSenderError(
        `Sender ${emailAddress} was not recognized as a valid Niantic Wayfarer or OPR-related email address.`,
      );*/
    }
    const emailDate = new Date(email.getFirstHeaderValue("Date"));
    const scopelySplitDate = new Date(1748023200000);
    if (emailAddress === "hello@pokemongolive.com" && emailDate.getUTCFullYear() <= 2018) {
      // Newsletters used this email address for some time up until late 2018, which was before this game got Wayfarer/OPR access.
      return "ignored";
    }
    if (emailAddress !== "notices@recon.nianticspatial.com" && emailDate > scopelySplitDate) {
      // Ignore any emails post-Scopely split
      return "ignored";
    }
    const toSave: StoredEmail = {
      id: email.getFirstHeaderValue("Message-ID"),
      pids: typeof file.processingID !== "undefined" ? [ file.processingID ] : [],
      filename: file.filename,
      ts: Date.now(),
      headers: email.headers,
      body: email.body,
    };
    try {
      const existing = await idb.get(toSave.id);
      const joinedPids = new Set([...toSave.pids, ...existing.pids]);
      const existingHops = new Email(existing.headers, existing.body).getHeaderValues("Received").length;
      const proposedHops = new Email(toSave.headers, toSave.body).getHeaderValues("Received").length;
      if (proposedHops < existingHops) {
        const hybrid = {
          ...toSave,
          pids: [...joinedPids],
        };
        idb.put(hybrid);
        idb.commit();
        await dispatch(new WayfarerEmail(hybrid), "replaced");
        return "replaced";
      } else {
        idb.put({
          ...existing,
          pids: [...joinedPids],
        });
        idb.commit();
        return "retained";
      }
    } catch (ex) {
      if (ex instanceof KeyNotFoundError) {
        idb.put(toSave);
        idb.commit();
        await dispatch(new WayfarerEmail(toSave), "inserted");
        return "inserted";
      } else {
        throw ex;
      }
    }
  }

  async getProcessedIDs() {
    const pids = new Set<string>();
    using idb = await this.#openIDB("readonly");
    this.#logger.debug("Iterating emails to find processed IDs");
    for await (const email of idb.iterate()) {
      for (const pid of email.pids) {
        pids.add(pid);
      }
    }
    this.#logger.debug("Email iteration completed.");
    return pids;
  }

  /**
   * Returns an asynchronous generator that iterates over all emails that have been imported to the
   * local database. The generator must be fully iterated, otherwise the database will not be
   * closed!
   */
  async *iterate() {
    using idb = await this.#openIDB("readonly");
    this.#logger.debug("Starting email iterator");
    for await (const email of idb.iterate()) {
      this.#logger.debug("Yielding email from iterator");
      yield new WayfarerEmail(email);
    }
    this.#logger.debug("Exhausted email iterator");
  }

  listen(listener: ImportListener) {
    this.#listeners.push(listener);
  }

  /**
   * Niantic will often strip diacritic marks from Portal titles/descriptions when they are sent in
   * emails to end users. This can make title matching difficult, because the OPR website does not
   * strip diacritics. Strings passed to this function will be returned with their diacritic marks
   * removed, to emulate the process applied by Niantic's email system. This can make it easier to
   * match OPR-sourced wayspot data against data sourced from imported emails.
   * @param text The Portal title/description to strip
   * @returns A normalized string representation of the given text
   */
  static stripDiacritics(text: string) {
    for (const [k, v] of iterObject(diacritics)) {
      text = text.replace(new RegExp(`[${v}]`, "g"), k);
    }
    return text.normalize("NFD");
  }
}

export class Email {
  headers: Header[];
  body: string;
  #cache: {
    document?: Document,
    classification?: EmailTemplate | null,
  };
  constructor(headers: Header[], body: string) {
    this.headers = headers;
    this.body = body;
    this.#cache = {};
  }

  getHeaderValues(name: string) {
    return this.headers
      .filter((h) => h.name.toLowerCase() === name.toLowerCase())
      .map((h) => h.value);
  }

  getFirstHeaderValue(name: string): string;
  getFirstHeaderValue<T>(name: string, defaultValue: T): string | T;
  getFirstHeaderValue<T>(name: string, defaultValue?: T): string | T {
    const hvs = this.getHeaderValues(name);
    if (hvs.length) return hvs[0];
    if (typeof defaultValue !== "undefined") return defaultValue;
    throw new HeaderNotFoundError(`Could not find any headers with name ${name}`);
  }

  getBody(contentType: string) {
    const alts = this.getMultipartAlternatives();
    return alts[contentType.toLowerCase()] ?? null;
  }

  getMultipartAlternatives() {
    const alts: Record<string, string> = {};
    const ct = this.#parseContentType(this.getFirstHeaderValue("Content-Type"));
    if (ct.type === "multipart/alternative") {
      const parts = this.body.split(`--${ct.params.boundary}`).filter(part => part !== "");
      for (const part of parts) {
        if (!part.startsWith("\r\n") || !part.endsWith("\r\n")) continue;
        const partMime = parseMIME(part.substring(2, part.length - 2));
        if (partMime.body.trim().length === 0) continue;
        const partCTHdr = partMime.getFirstHeaderValue("Content-Type", null);
        if (partCTHdr === null) continue;
        const partCT = this.#parseContentType(partCTHdr);
        const partCTE = partMime.getFirstHeaderValue("Content-Transfer-Encoding", null);
        const partCharset = (partCT.params.charset ?? "utf-8").toLowerCase();
        alts[partCT.type] = decodeBodyUsingCTE(partMime.body, partCTE, partCharset);
      }
    } else {
      const cte = this.getFirstHeaderValue("Content-Transfer-Encoding", null);
      const charset = (ct.params.charset ?? "utf-8").toLowerCase();
      alts[ct.type] = decodeBodyUsingCTE(this.body, cte, charset);
    }
    return alts;
  }

  getDocument() {
    if (typeof this.#cache.document !== "undefined") {
      return this.#cache.document;
    } else {
      const html = this.getBody("text/html");
      if (!html) return null;
      const dp = new DOMParser();
      this.#cache.document = dp.parseFromString(html, "text/html");
      return this.#cache.document;
    }
  }

  display() {
    let emlUri = "data:text/plain,";
    const alts = this.getMultipartAlternatives();
    for (const [k, v] of iterObject(alts)) {
      const b = new Blob([v], { type: k });
      alts[k] = URL.createObjectURL(b);
    }
    if ("text/html" in alts) emlUri = alts["text/html"];
    else if ("text/plain" in alts) emlUri = alts["text/plain"];

    const doc = document.createElement("html");
    const head = makeChildNode(doc, "head");
    makeChildNode(head, "meta").setAttribute("charset", "utf-8");
    makeChildNode(head, "title", this.getFirstHeaderValue("Subject"));
    makeChildNode(head, "style", `
body {
    margin: 0;
    font-family: sans-serif;
}
#outer {
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    position: absolute;
    display: flex;
    flex-flow: column;
}
#headers {
    flex: 0 1 auto;
    padding: 10px;
}
#variants span::after {
    content: ', ';
}
#variants span:last-child::after {
    content: '';
}
iframe {
    flex: 1 1 auto;
    border: none;
}
td:first-child {
    font-weight: bold;
    padding-right: 15px;
}
@media (prefers-color-scheme: dark) {
    #headers {
        background-color: #1b1b1b;
        color: #fff;
    }
    a {
        color: lightblue;
    }
}
`);

    const body = makeChildNode(doc, "body");
    const outer = makeChildNode(body, "div");
    outer.id = "outer";
    const headers = makeChildNode(outer, "div");
    headers.id = "headers";

    const table = makeChildNode(headers, "table");
    for (const header of ["From", "To", "Subject", "Date"]) {
      const row = makeChildNode(table, "tr");
      makeChildNode(row, "td", header);
      makeChildNode(row, "td", this.getFirstHeaderValue(header, ""));
    }
    const row = makeChildNode(table, "tr");
    makeChildNode(row, "td", "Variants");
    const vcell = makeChildNode(row, "td");
    vcell.id = "variants";
    for (const [variant, dataUri] of iterObject(alts)) {
      const typeSpan = makeChildNode(vcell, "span");
      const typeAnchor = makeChildNode(typeSpan, "a") as HTMLAnchorElement;
      typeAnchor.target = "emailFrame";
      typeAnchor.href = dataUri;
      typeAnchor.textContent = variant;
    }

    const ifr = makeChildNode(outer, "iframe") as HTMLIFrameElement;
    ifr.name = "emailFrame";
    ifr.src = emlUri;

    const data = `<!DOCTYPE html>\n${doc.outerHTML}`;
    const blob = new Blob([data], { type: "text/html" });
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, "_blank", "popup");
  }

  classify(): EmailTemplate {
    if (typeof this.#cache.classification !== "undefined") {
      if (this.#cache.classification === null) {
        throw new DisambiguationFailedError("Disambiguation of ambiguous email template failed");
      }
      return this.#cache.classification;
    } else {
      const subject = this.getFirstHeaderValue("Subject");
      for (const template of emailTemplates) {
        if (subject.match(template.subject)) {
          if ("disambiguate" in template && typeof template.disambiguate !== "undefined") {
            this.#cache.classification = template.disambiguate(this);
          } else if ("type" in template) {
            this.#cache.classification = {
              type: template.type,
              style: template.style,
              language: template.language,
            };
          } else {
            this.#cache.classification = null;
          }
          return this.classify();
        }
      }
    }
    throw new NoMatchingTemplateError("This email does not appear to match any styles of Niantic emails currently known to Email API.");
  }

  #parseContentType(ctHeader: string) {
    const m = ctHeader.match(/^(?<type>[^/]+\/[^/;\s]+)(?=($|(?<params>(;[^;]*)*)))/);
    if (m === null) throw new InvalidContentTypeError(`Unrecognized Content-Type ${ctHeader}`);
    const { type, params } = m.groups!;
    const paramMap: Record<string, string> = {};
    if (params) {
      const paramList = params.substring(1).split(";");
      for (const param of paramList) {
        const [ attr, value ] = param.trim().split("=");
        paramMap[attr.toLowerCase()] = (
          value.startsWith("\"") && value.endsWith("\"")
            ? value.substring(1, value.length - 1)
            : value
        );
      }
    }
    return {
      type: type.toLowerCase(),
      params: paramMap,
    };
  }
}

export class WayfarerEmail extends Email {
  /**
   * @deprecated For internal use only!
   */
  createDebugBundle() {
    return this.#dbObject;
  }
  #dbObject: StoredEmail;
  constructor(dbObject: StoredEmail) {
    super(dbObject.headers, dbObject.body);
    this.#dbObject = dbObject;
  }

  /**
   * Returns the filename of the email at the time it was imported. For *.eml imports, this will be
   * the real name of the file. For emails imported from third-party APIs that do not provide a
   * filename, the name will be generated, based on some identifier if one is available. In either
   * case, filenames returned by this property are NOT guaranteed to be unique.
   */
  get originatingFilename() {
    return this.#dbObject.filename;
  }

  /**
   * Returns the ID of this email. The ID can be passed to API.get() to return this email. The ID
   * is based on the Message-ID header of the email and is globally unique.
   */
  get messageID() {
    return this.#dbObject.id;
  }

  /**
   * Returns a Date object representing the exact time this email was last imported to the local
   * database.
   */
  get importedDate() {
    return new Date(this.#dbObject.ts);
  }
}
