// Copyright 2025 tehstone, bilde2910
// This file is part of the OPR Tools collection.

// This script is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This script is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You can find a copy of the GNU General Public License in the root
// directory of this script's GitHub repository:
// <https://github.com/bilde2910/OPR-Tools/blob/main/LICENSE>
// If not, see <https://www.gnu.org/licenses/>.

import { register } from "src/core";
import { iterObject, makeChildNode, shiftDays, toUtcIsoDate } from "src/utils";

import GASImportIcon from "../../assets/gmail-gas-importer/ga-script.svg";
import GASUserManual from "../../assets/gmail-gas-importer/user-manual.html";
import GASContent from "../../assets/gmail-gas-importer/opr-importer.gs";
import "./gmail-gas-importer.css";

const DEFAULT_CONFIG = {
  url: "",
  token: "",
  since: "",
};

const GAS_MIN_VERSION = 2;
const LIST_BATCH_SIZE = 500;
const FETCH_BATCH_SIZE = 20;

interface FormInput {
  id: keyof typeof DEFAULT_CONFIG,
  type: string,
  label: string,
  placeholder?: string,
  required: boolean,
  field?: HTMLInputElement,
}

type GASRequestType = "list" | "fetch" | "test";

interface GASSuccessResponse<T> {
  version: number,
  status: "OK"
  result: T,
}

interface GASErrorResponse {
  version: number,
  status: "ERROR",
  result: "unauthorized" | "unknown_route",
}

type GASBaseResponse<T> = GASSuccessResponse<T> | GASErrorResponse;

interface GASRequestOptions extends Record<GASRequestType, any> {
  "list": {
    since: string,
    offset: number,
    size: number,
  },
  "fetch": {
    ids: string[],
  },
  "test": undefined,
}

interface GASResponses extends Record<GASRequestType, any> {
  "list": GASBaseResponse<string[]>,
  "fetch": GASBaseResponse<{ [id: string]: string }>,
  "test": GASBaseResponse<string>,
}

interface EmailLoader {
  setTitle: (text: string) => void,
  setStatus: (text: string) => void,
  getStatus: () => string,
  destroy: () => void,
}

export default () => {
  register()({
    id: "gmail-gas-importer",
    name: "Gmail Importer",
    authors: ["tehstone", "bilde2910"],
    description: "Adds the capability to import emails from Gmail into OPR to enrich other plugins through usage of a Google Apps Script",
    defaultConfig: DEFAULT_CONFIG,
    sessionData: {},
    initialize: (toolbox, logger, config) => {
      const createEmailLoader = async (title: string, body: string): Promise<EmailLoader> => {
        const modal = await toolbox.createModal("opremli-modal");
        const header = makeChildNode(modal.container, "h2", title);
        const status = makeChildNode(modal.container, "p", body);
        return {
          setTitle: (text: string) => header.textContent = text,
          setStatus: (text: string) => status.textContent = text,
          getStatus: () => status.textContent,
          destroy: () => modal.dismiss(),
        };
      };

      const showGASManual = async () => {
        const html = await fetch(GASUserManual).then(resp => resp.text());
        const gasContent = await fetch(GASContent).then(resp => resp.text());
        const dp = new DOMParser();
        const doc = dp.parseFromString(html, "text/html");
        doc.getElementById("gas-importer-script")!.textContent = gasContent;
        const xmls = new XMLSerializer();
        const blob = new Blob([xmls.serializeToString(doc)], { type: "text/html" });
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, "_blank", "popup");
      };

      const showImportModal = async () => {
        const modal = await toolbox.createModal("oprtcore-modal-common", "opregas-options-modal");
        makeChildNode(modal.container, "h1", "Import using Google Apps Script");
        const helpText = makeChildNode(modal.container, "p");
        makeChildNode(helpText, "span", "Please enter your Importer Script details below. New to the Importer Script? ");
        makeChildNode(helpText, "a", "Please click here").addEventListener("click", showGASManual);
        makeChildNode(helpText, "span", " for detailed setup instructions.");
        const form = makeChildNode(modal.container, "form");
        const tbl = makeChildNode(form, "table");
        tbl.classList.add("opregas-table");

        const inputs: FormInput[] = [
          {
            id: "url",
            type: "text",
            label: "Script URL",
            placeholder: "https://script.google.com/macros/.../exec",
            required: true,
          },
          {
            id: "token",
            type: "password",
            label: "Access token",
            required: true,
          },
          {
            id: "since",
            type: "date",
            label: "Search emails starting from",
            required: false,
          },
        ];

        for (const input of inputs) {
          const row = makeChildNode(tbl, "tr");
          makeChildNode(row, "td", input.label);
          const col2 = makeChildNode(row, "td");
          input.field = makeChildNode(col2, "input") as HTMLInputElement;
          input.field.type = input.type;
          input.field.required = input.required;
          input.field.placeholder = input.placeholder ?? "";
          input.field.value = config.get(input.id);
        }

        const btn1 = makeChildNode(form, "input") as HTMLInputElement;
        btn1.type = "submit";
        btn1.classList.add("oprtcore-ui-button");
        btn1.value = "Start import";

        const btn2 = makeChildNode(form, "input") as HTMLInputElement;
        btn2.type = "button";
        btn2.classList.add("oprtcore-ui-button", "opregas-cancel-btn");
        btn2.value = "Cancel import";
        btn2.addEventListener("click", () => modal.dismiss());

        form.addEventListener("submit", (ev) => {
          ev.preventDefault();
          for (const input of inputs) config.set(input.id, input.field!.value);
          modal.dismiss();
          void importEmails();
        });
      };

      const getGasApi = (url: string, token: string, loader: EmailLoader) => {
        const fetchGAS = <T extends GASRequestType>(request: T, options: GASRequestOptions[T], errDelay: number = 30) =>
          new Promise<GASResponses[T]>((resolve, reject) => {
            fetch(url, {
              method: "POST",
              headers: { "Content-Type": "text/plain" },
              body: JSON.stringify({ request, token, options }),
            }).then(resp => {
              resp.json().then(data => resolve(data)).catch(reject);
            }).catch(() => {
              // Most likely a 429 error, so we need to slow down/wait a little bit before
              // retrying. Unfortunately GAS does not return CORS headers on 429, so it is returned
              // to us as a generic NetworkError. We can catch it, of course, but not distinguish
              // it from other errors, such as HTTP 403 (setup not run/GAS not authorized on Google
              // account) or an actual network connection error, which is unfortunate, because such
              // errors will then be trapped here in an infinite retry loop.
              let counter = errDelay;
              const origStatus = loader.getStatus();
              loader.setStatus(`Error! Retrying in ${counter}s...`);
              const i = setInterval(() => {
                counter--;
                if (counter > 0) {
                  loader.setStatus(`Error! Retrying in ${counter}s...`);
                } else {
                  clearInterval(i);
                  loader.setStatus(origStatus);
                  fetchGAS(request, options, errDelay + 30).then(resolve).catch(reject);
                }
              }, 1000);
            });
          });
        return fetchGAS;
      };

      const importEmails = async () => {
        const emailAPI = await toolbox.getAddonAPI("opr-tools-core")!.email();
        const loader = await createEmailLoader("Connecting...", "Validating script credentials");
        const url = config.get("url");
        const token = config.get("token");
        const since = config.get("since");
        const fetchGAS = getGasApi(url, token, loader);
        try {
          const data = await fetchGAS("test", undefined);
          if (data.status !== "OK") {
            alert("Credential validation failed. Please double check your access token and script URL.");
            loader.destroy();
          } else if (data.version < GAS_MIN_VERSION) {
            alert("Your script is out of date. Please update your script with the latest code provided in the setup guide.");
            loader.destroy();
          } else {
            const startTime = new Date();
            loader.setStatus("Searching for new emails");
            const oldIDs = new Set(
              [...await emailAPI.getProcessedIDs()]
                .filter(pid => pid.startsWith("G-"))
                .map(pid => pid.substring(2)),
            );
            const newIDs: string[] = [];
            let count = 0;
            const size = LIST_BATCH_SIZE;
            let offset = 0;
            do {
              const batch = await fetchGAS("list", { since, offset, size });
              if (batch.status !== "OK") throw new Error("Email listing failed");
              count = batch.result.length;
              offset += count;
              for (const pid of batch.result) {
                if (!oldIDs.has(pid)) newIDs.push(pid);
              }
              loader.setStatus(`Searching for new emails (${newIDs.length}/${offset})`);
            } while (count === size);

            const totalCount = newIDs.length;
            loader.setTitle("Downloading...");
            loader.setTitle("Please wait");
            offset = 0;
            let iterSuccess = true;

            const iterator = async function*() {
              try {
                let batch: string[] = [];
                while (newIDs.length > 0) {
                  while (batch.length < FETCH_BATCH_SIZE && newIDs.length > 0) batch.push(newIDs.shift()!);
                  loader.setTitle("Downloading...");
                  loader.setStatus(`Downloading ${offset + 1}-${offset + batch.length} of ${totalCount}`);
                  const emlMap = await fetchGAS("fetch", { ids: batch });
                  if (emlMap.status !== "OK") throw new Error("Email fetching failed");
                  loader.setTitle("Parsing...");
                  for (const [id, text] of iterObject(emlMap.result)) {
                    yield {
                      filename: `${id}.eml`,
                      contents: text,
                      processingID: `G-${id}`,
                    };
                  }
                  offset += batch.length;
                  batch = [];
                }
              } catch (ex) {
                iterSuccess = false;
                logger.error(ex);
                alert("An error occurred fetching emails from Google. You may have to continue importing from the same date again to ensure all emails are downloaded.");
              }
            };

            count = 1;
            await emailAPI.import(iterator(), () => {
              loader.setStatus(`Processing email ${count} of ${totalCount}`);
              count++;
            });
            if (iterSuccess) {
              const newSince = toUtcIsoDate(shiftDays(startTime, -1));
              config.set("since", newSince);
            }
          }
        } catch (ex) {
          logger.error(ex);
          alert("The Importer Script returned an invalid response. Please see the console for more information.");
        }
        loader.destroy();
      };

      toolbox.addImporter({
        title: "Import from Gmail",
        description: "Import emails directly from Gmail, using a Google Apps Script",
        callback: showImportModal,
        icon: GASImportIcon,
      });
    },
  });
};
