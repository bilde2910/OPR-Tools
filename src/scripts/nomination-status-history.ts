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

import { NotificationColor, register } from "src/core";
import { filterObject, iterObject, unilTruthy, indexToMap, makeChildNode, toUtcIsoDate, iterKeys, assignAll } from "src/utils";
import { AnyContribution, ContributionStatus, ContributionType, Nomination, OriginalPoiData, SubmissionsResult } from "src/types";

import "./nomination-status-history.css";
import { EmailAPI, WayfarerEmail } from "src/email";
import { IDBStoreConnection, KeyNotFoundError } from "src/idb";
import { EmailStyle, EmailType } from "src/email/types";

const EMAIL_PROCESSING_VERSION = 1;
const STRICT_MODE = true;

const FILTER_COLUMNS = ["id", "type", "day", "upgraded", "status", "isNianticControlled", "canAppeal", "isClosed", "canHold", "canReleaseHold"] as const;
const SUPPORTED_EMAIL_TYPES = [
  EmailType.NOMINATION_RECEIVED,
  EmailType.NOMINATION_DECIDED,
  EmailType.NOMINATION_APPEAL_RECEIVED,
  EmailType.NOMINATION_APPEAL_DECIDED,
  EmailType.EDIT_RECEIVED,
  EmailType.EDIT_DECIDED,
  EmailType.PHOTO_RECEIVED,
  EmailType.PHOTO_DECIDED,
];

// If this changes, also update the CSS declaration
const CONTRIB_DATE_SELECTOR = "app-submissions app-details-pane app-submission-tag-set + span";

// Right triangle needs a VS15 variant selector (U+FE0E) to avoid being rendered as an emoji
// https://en.wikipedia.org/wiki/Geometric_Shapes_(Unicode_block)#Emoji
const RIGHT_TRIANGLE = "\uFE0E\u25B6";
const DOWN_TRIANGLE = "\u25BC";

type HistoryEntryStatus = ContributionStatus | "UPGRADE";

const STATE_MAP: Record<HistoryEntryStatus, string> = {
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  VOTING: "Entered voting",
  DUPLICATE: "Rejected as duplicate",
  WITHDRAWN: "Withdrawn",
  NOMINATED: "Nominated",
  APPEALED: "Appealed",
  NIANTIC_REVIEW: "Entered Niantic review",
  HELD: "Held",
  UPGRADE: "Upgraded",
};

enum EmailProcessingResult {
  SUCCESS = "success",
  SKIPPED = "skipped",
  UNSUPPORTED = "unsupported",
  AMBIGUOUS = "ambiguous",
  FAILURE = "failure",
  UNCHANGED = "unchanged",
}

interface StatusHistoryEntry {
  timestamp: number,
  status: HistoryEntryStatus,
  verified?: boolean,
  email?: string,
}

type FilteredContribution = Pick<AnyContribution, typeof FILTER_COLUMNS[number]>;
interface StoredContribution extends FilteredContribution {
  poiData?: OriginalPoiData,
  statusHistory: StatusHistoryEntry[],
};

interface EmailProcessingRecord {
  id: string,
  ts: number,
  result: EmailProcessingResult,
  version: number,
}

interface EmailProcessingError {
  email: unknown,
  error: any,
  stack?: string[],
}

interface IdbStores {
  history: StoredContribution,
  emails: EmailProcessingRecord,
}

export default () => {
  register<IdbStores, void>()({
    id: "nomination-status-history",
    name: "Nomination Status History",
    authors: ["tehstone", "bilde2910", "Tntnnbltn"],
    description: "Track changes to contribution status, and receive alerts when a contribution has changed status.",
    defaultConfig: {},
    sessionData: {},
    initialize: (toolbox, logger, _config) => {
      let ready = false;

      class EmailProcessor {
        #submissions: AnyContribution[];
        #statusHistoryMap: Record<string, StatusHistoryEntry[]>;
        #alreadyProcessed: Set<string>;
        #stats: Record<EmailProcessingResult, number>;
        #errors: EmailProcessingError[];

        constructor(submissions: AnyContribution[]) {
          this.#submissions = submissions;
          this.#statusHistoryMap = {};
          this.#alreadyProcessed = new Set();
          this.#errors = [];
          this.#stats = {
            success: 0,
            skipped: 0,
            unsupported: 0,
            ambiguous: 0,
            failure: 0,
            unchanged: 0,
          };
        }

        async prepare() {
          logger.info("Preparing email processor...");
          {
            using idb = await toolbox.openIDB("history", "readonly");
            const history = await idb.getAll();
            this.#statusHistoryMap = assignAll({}, ...history.map(e => ({ [e.id]: e.statusHistory })));
          }
          {
            using idb = await toolbox.openIDB("emails", "readonly");
            const records = await idb.getAll();
            this.#alreadyProcessed.clear();
            for (const record of records) {
              if (
                // Reprocess 
                record.version < EMAIL_PROCESSING_VERSION ||
                // Reprocess old failures due to bugfixes and template additions
                record.result === EmailProcessingResult.UNSUPPORTED ||
                record.result === EmailProcessingResult.FAILURE
              ) {
                continue;
              }
              this.#alreadyProcessed.add(record.id);
            }
          }
          for (const k of iterKeys(this.#stats)) {
            this.#stats[k] = 0;
          }
          logger.info("Email processor fully prepared.");
        }

        #mergeEmailChange(id: string, change: ProcessedEmailChange) {
          const storedHistory = this.#statusHistoryMap[id];
          const joined = [...change.updates, ...storedHistory];
          joined.sort((a, b) => a.timestamp - b.timestamp);
          this.#deduplicateHistoryArray(joined);
          // It should not be possible for the stored history to have duplicates,
          // but this line of code exists because it did somehow happen to someone
          this.#deduplicateHistoryArray(storedHistory);
          const diffs = [];
          if (storedHistory.length) {
            for (let i = 0, j = 0; i < storedHistory.length && j < joined.length; i++, j++) {
              while (storedHistory[i].status !== joined[j].status) diffs.push({ ...joined[j++], previously: null });
              if (
                storedHistory[i].timestamp !== joined[j].timestamp ||
                !!storedHistory[i].verified !== !!joined[j].verified ||
                storedHistory[i].email !== joined[j].email
              ) diffs.push({ ...joined[j], previously: storedHistory[i].timestamp });
            }
          } else {
            for (let j = 0; j < joined.length; j++) {
              diffs.push({ ...joined[j++], previously: null });
            }
          }
          if (diffs.length) return { ...change, updates: joined, diffs };
          return null;
        }

        #deduplicateHistoryArray(arr: StatusHistoryEntry[]) {
          for (let i = arr.length - 2; i >= 0; i--) {
            if (arr[i].status == arr[i + 1].status) {
              // Duplicate status
              const curDate = new Date(arr[i].timestamp);
              if (!(curDate.getUTCMilliseconds() || curDate.getUTCSeconds() || curDate.getUTCMinutes() || curDate.getUTCHours())) {
                // All of the above are 0 means this was with extreme likelihood a WFES import that is less accurate.
                // Thus we keep the email date instead for this one even though it happened "in the future".
                arr.splice(i, 1);
              } else {
                arr.splice(i + 1, 1);
              }
            }
          }
        }

        async #importChangeIntoDatabase(
          idb: IDBStoreConnection<StoredContribution>,
          id: string,
          statusHistory: StatusHistoryEntry[],
        ) {
          // Import changes to IDB
          try {
            // Get existing from IDB (we can't store an "empty" object)
            const stored = await idb.get(id);
            idb.put({
              ...stored,
              statusHistory,
            });
          } catch (ex) {
            if (!(ex instanceof KeyNotFoundError)) {
              throw ex;
            }
          }
          idb.commit();
        }

        async import(
          email: WayfarerEmail,
          dbHistory: IDBStoreConnection<StoredContribution>,
          dbEmails: IDBStoreConnection<EmailProcessingRecord>,
        ) {
          if (this.#alreadyProcessed.has(email.messageID)) return;
          const result = processEmail(email, this.#submissions, this.#statusHistoryMap);
          this.#alreadyProcessed.add(email.messageID);
          let status = result.status;
          if (status === EmailProcessingResult.SUCCESS && result.change && result.id) {
            const merged = this.#mergeEmailChange(result.id, result.change);
            if (merged) {
              await this.#importChangeIntoDatabase(dbHistory, result.id, merged.updates);
            } else {
              status = EmailProcessingResult.UNCHANGED;
            }
          }
          if (status === EmailProcessingResult.UNSUPPORTED || status === EmailProcessingResult.FAILURE) {
            const err: EmailProcessingError = {
              email: email.createDebugBundle(),
              error: JSON.parse(JSON.stringify(result.error, Object.getOwnPropertyNames(result.error))),
            };
            if (result.error?.stack) {
              err.stack = result.error.stack.split("\n").filter(n => n.length);
            }
            this.#errors.push(err);
          }
          this.#stats[status]++;
          dbEmails.put({
            id: email.messageID,
            ts: Date.now(),
            result: status,
            version: EMAIL_PROCESSING_VERSION,
          });
          dbEmails.commit();
        }

        finalize(withNotification: boolean) {
          logger.info("Finalizing email processor...");
          const total = Object.values(this.#stats).reduce((p, c) => p + c, 0);
          const cUpdated = this.#stats[EmailProcessingResult.SUCCESS];
          const cUnchanged = this.#stats[EmailProcessingResult.UNCHANGED];
          const cSkipped = this.#stats[EmailProcessingResult.SKIPPED];
          const cAmbiguous = this.#stats[EmailProcessingResult.AMBIGUOUS];
          const cErrors = this.#stats[EmailProcessingResult.FAILURE] + this.#stats[EmailProcessingResult.UNSUPPORTED];

          if (withNotification || cUpdated || cAmbiguous) {
            toolbox.notify({
              color: "gray",
              message:
                `${total} emails from Email API were processed by Nomination Status History ` +
                `(of which ${cUpdated} change(s), ${cUnchanged} unchanged, ${cSkipped} skipped, ` +
                `${cAmbiguous} unmatched, and ${cErrors} error(s).`,
            });
          }

          // TODO: Error reporting
          logger.info("Email processor finalized.");
        }
      }

      const handleNominations = async (result: SubmissionsResult) => {
        await checkNominationChanges(result.submissions);
        importEmails(result.submissions);

        // Add event listener for each element in the nomination list,
        // so we can display the history box for nominations on click.
        const ref = await unilTruthy(() => document.querySelector("app-submissions-list"));

        ref.addEventListener("click", async (e) => {
          // Ensure there is only one selection box.
          const elements = document.querySelectorAll(".oprnsh-dropdown");
          for (const e of elements) e.remove();
          const item = (e.target! as HTMLElement).closest("app-submissions-list-item");
          if (item !== null) {
            // Hopefully this index is constant and never changes?
            // I don't see a better way to access it.
            const nomId: StoredContribution["id"] = (item as any).__ngContext__[22].id;
            if (nomId) {
              const dsRef = await unilTruthy(() => document.querySelector(CONTRIB_DATE_SELECTOR));
              const box = makeChildNode(dsRef.parentNode!, "div");
              box.classList.add("oprnsh-dropdown");

              const leftBox = makeChildNode(box, "a", RIGHT_TRIANGLE);
              leftBox.classList.add("oprnsh-dd-left");
              const rightBox = makeChildNode(box, "div");
              rightBox.classList.add("oprnsh-dd-right");

              const collapsedLine = makeChildNode(rightBox, "p");
              collapsedLine.classList.add("oprnsh-collapsed");
              const expandedBox = makeChildNode(rightBox, "div");
              expandedBox.classList.add("oprnsh-expanded");

              let collapsed = true;
              box.addEventListener("click", (ev) => {
                ev.preventDefault();
                collapsed = !collapsed;
                collapsedLine.style.display = collapsed ? "block" : "none";
                expandedBox.style.display = collapsed ? "none" : "block";
                leftBox.textContent = collapsed ? RIGHT_TRIANGLE : DOWN_TRIANGLE;
                return false;
              });

              // Don't populate the dropdown until the nomination change detection has run successfully.
              // That process sets ready = true when done. If it was already ready, then this will
              // continue immediately. When ready, that means the previous connection was closed, so we
              // open a new connection here to fetch data for the selected nomination.
              await unilTruthy(() => ready);
              using idb = await toolbox.openIDB("history", "readonly");
              const savedNom = await idb.get(nomId);

              // Create an option for initial nomination; this may not be stored in the IDB history,
              // so we need to handle this as a special case here.
              if (savedNom.statusHistory.length == 0 || savedNom.statusHistory[0].status !== ContributionStatus.NOMINATED) {
                collapsedLine.textContent = `${savedNom.day} - Nominated`;
                makeChildNode(expandedBox, "p", `${savedNom.day} - Nominated`);
              }
              // Then, add options for each entry in the history.
              let previous: HistoryEntryStatus | null = null;
              for (const entry of savedNom.statusHistory) {
                addEventToHistoryDisplay(box, entry, previous);
                previous = entry.status;
              }
            }
          }
        });
      };

      let lastLoadSubmissions: AnyContribution[] = [];
      let emailListenerAttached = false;

      const importEmails = async (submissions: AnyContribution[]) => {
        logger.info("Starting to process stored emails for history events");
        const emailAPI = await toolbox.getAddonAPI("opr-tools-core")!.email();
        const start = Date.now();
        const epInstance = new EmailProcessor(submissions);
        await epInstance.prepare();
        {
          logger.info("Opening history and email object stores");
          using dbHistory = await toolbox.openIDB("history", "readwrite");
          using dbEmails = await toolbox.openIDB("emails", "readwrite");
          for await (const email of emailAPI.iterate()) {
            await epInstance.import(email, dbHistory, dbEmails);
          }
          logger.info("Closing history and email object stores");
        }
        epInstance.finalize(false);
        lastLoadSubmissions = submissions;
        if (!emailListenerAttached) {
          attachEmailListener(emailAPI);
          emailListenerAttached = true;
        }
        logger.info(`Imported stored history events from email cache in ${Date.now() - start} msec.`);
      };

      const attachEmailListener = (emailAPI: EmailAPI) => {
        logger.info("Attaching Email API listener");
        emailAPI.listen(async () => {
          logger.info("Email API listener was invoked");
          const epInstance = new EmailProcessor(lastLoadSubmissions);
          await epInstance.prepare();
          return (async function*() {
            {
              logger.info("Opening history and email object stores within generator");
              using dbHistory = await toolbox.openIDB("history", "readwrite");
              using dbEmails = await toolbox.openIDB("emails", "readwrite");
              logger.info("Yielding importer function from generator");
              yield async (email: WayfarerEmail) => epInstance.import(email, dbHistory, dbEmails);
              logger.info("Generator import done; closing object stores");
            }
            epInstance.finalize(true);
          })();
        });
      };

      const addEventToHistoryDisplay = (box: Element, current: StatusHistoryEntry, prevStatus: HistoryEntryStatus | null) => {
        let statusText: string;
        if (current.status === "NOMINATED" && prevStatus !== null) {
          statusText = prevStatus === "HELD" ? "Hold released" : "Returned to queue";
        } else {
          statusText = STATE_MAP[current.status] ?? "Unknown";
        }

        // Format the date as UTC as this is what OPR uses to display the nomination date.
        // Maybe make this configurable to user's local time later?
        const prefix = `${toUtcIsoDate(new Date(current.timestamp))} - `;

        const collapsedLine = box.querySelector(".oprnsh-collapsed")!;
        collapsedLine.textContent = prefix + statusText;
        const line = document.createElement("p");
        line.appendChild(document.createTextNode(prefix));
        if (current.verified) collapsedLine.classList.add("oprnsh-verified");
        else if (collapsedLine.classList.contains("oprnsh-verified")) collapsedLine.classList.remove("oprnsh-verified");

        if (typeof current.email !== "undefined") {
          const aDisplay = makeChildNode(line, "a", statusText);
          aDisplay.addEventListener("click", async (e) => {
            e.stopPropagation();
            const emailAPI = await toolbox.getAddonAPI("opr-tools-core")!.email();
            const email = await emailAPI.get(current.email!);
            email.display();
          });
        } else {
          line.appendChild(document.createTextNode(statusText));
        }

        if (current.verified) line.classList.add("oprnsh-verified");
        const expandedBox = box.querySelector(".oprnsh-expanded")!;
        expandedBox.appendChild(line);
      };

      const checkNominationChanges = async (submissions: AnyContribution[]) => {
        const start = Date.now();
        using idb = await toolbox.openIDB("history", "readwrite");
        idb.on("complete", () => {
          console.log(`Contribution changes processed in ${Date.now() - start} msec.`);
          ready = true;
        });
        const saved = await idb.getAll();
        const savedMap = indexToMap(saved, "id");
        if (submissions.length < saved.length) {
          toolbox.notify({
            color: "red",
            message: `${saved.length - submissions.length} of ${saved.length} contributions are missing!`,
          });
        }

        const newCount: Record<ContributionType, number> = {
          NOMINATION: 0,
          EDIT_TITLE: 0,
          EDIT_DESCRIPTION: 0,
          EDIT_LOCATION: 0,
          PHOTO: 0,
        };

        for (const nom of submissions) {
          let history: StatusHistoryEntry[];
          if (nom.id in savedMap) {
            // Nomination ALREADY EXISTS in IDB
            const saved = savedMap[nom.id];
            history = saved.statusHistory;
            const title = nom.title || (nom.type !== ContributionType.NOMINATION && nom.poiData.title) || "[Title]";
            // Add upgrade change status if the nomination was upgraded.
            if (nom.upgraded && !saved.upgraded) {
              history.push({ timestamp: Date.now(), status: "UPGRADE" });
              toolbox.notify({
                color: "blue",
                message: `${title} was upgraded!`,
                icon: createNotificationIcon(nom.type),
              });
            }
            // Add status change if the current status is different to the stored one.
            if (nom.status !== saved.status) {
              history.push({ timestamp: Date.now(), status: nom.status });
              // For most status updates, it's also desired to send a notification to the user.
              if (nom.status !== "HELD" && !(nom.status === "NOMINATED" && saved.status === "HELD")) {
                const { message, color } = getStatusNotificationText(nom.status);
                toolbox.notify({
                  color,
                  message: title + message,
                  icon: createNotificationIcon(nom.type),
                });
              }
            }
          } else {
            // Nomination DOES NOT EXIST in IDB yet
            newCount[nom.type]++;
            history = [];
            // Add current status to the history array if it isn't
            // NOMINATED, which is the initial status
            if (nom.status !== ContributionStatus.NOMINATED) {
              history.push({ timestamp: Date.now(), status: nom.status });
            }
          }
          // Filter out irrelevant fields that we don't need store.
          // Only retain fields from FILTER_COLUMNS before we put it in IDB.
          const toSave: StoredContribution = {
            ...filterObject(nom, FILTER_COLUMNS),
            statusHistory: history,
          };
          if (nom.type !== ContributionType.NOMINATION) {
            toSave.poiData = nom.poiData;
          }
          idb.put(toSave);
        }
        // Commit all changes.
        idb.commit();

        const messageTypeMapping: Record<ContributionType, (count: number) => string> = {
          NOMINATION: (c) => `Found ${c} new nomination${c > 1 ? "s" : ""} in the list!`,
          EDIT_TITLE: (c) => `Found ${c} new title edit${c > 1 ? "s" : ""} in the list!`,
          EDIT_DESCRIPTION: (c) => `Found ${c} new description edit${c > 1 ? "s" : ""} in the list!`,
          EDIT_LOCATION: (c) => `Found ${c} new location edit${c > 1 ? "s" : ""} in the list!`,
          PHOTO: (c) => `Found ${c} new photo${c > 1 ? "s" : ""} in the list!`,
        };

        for (const [type, messageGenerator] of iterObject(messageTypeMapping)) {
          if (newCount[type] > 0) {
            const message = messageGenerator(newCount[type]);
            toolbox.notify({
              color: "gray",
              message,
              icon: createNotificationIcon(type),
            });
          }
        }
      };

      const getStatusNotificationText = (status: ContributionStatus): {
        color: NotificationColor,
        message: string,
      } => {
        switch (status) {
          case ContributionStatus.ACCEPTED: return {
            color: "green",
            message: " was accepted!",
          };
          // This is only generated when it used to have a status other than hold
          case ContributionStatus.NOMINATED: return {
            color: "brown",
            message: " returned to the queue!",
          };
          case ContributionStatus.REJECTED: return {
            color: "red",
            message: " was rejected!",
          };
          case ContributionStatus.DUPLICATE: return {
            color: "red",
            message: " was rejected as duplicate!",
          };
          case ContributionStatus.VOTING: return {
            color: "gold",
            message: " entered voting!",
          };
          case ContributionStatus.NIANTIC_REVIEW: return {
            color: "blue",
            message: " went into Niantic review!",
          };
          case ContributionStatus.APPEALED: return {
            color: "purple",
            message: " was appealed!",
          };
          default: return {
            color: "red",
            message: `: unknown status: ${status}`,
          };
        }
      };

      const createNotificationIcon = (type: ContributionType) => {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("version", "1.1");
        svg.setAttribute("viewBox", "0 0 512 512");
        svg.setAttribute("xml:space", "preserve");
        svg.setAttribute("width", "20");
        svg.setAttribute("height", "20");
        switch (type) {
          case ContributionType.NOMINATION:
            svg.innerHTML = `
              <g transform="matrix(5.5202 0 0 5.5202 7.5948 7.5921)">
                <path
                  d="m45 0c-19.537 0-35.375 15.838-35.375 35.375 0 8.722 3.171 16.693 8.404 22.861l26.971 31.764 26.97-31.765c5.233-6.167 8.404-14.139 8.404-22.861 1e-3 -19.536-15.837-35.374-35.374-35.374zm0 48.705c-8.035 0-14.548-6.513-14.548-14.548s6.513-14.548 14.548-14.548 14.548 6.513 14.548 14.548-6.513 14.548-14.548 14.548z"
                  fill="#ffffff"
                  stroke-linecap="round" />
              </g>`;
            break;
          case ContributionType.PHOTO:
            svg.innerHTML = `
              <path
                d="m190.39 84.949c-6.6975 5.26e-4 -12.661 4.2407-14.861 10.566l-16.951 48.736h-86.783c-16.463 8e-5 -29.807 13.346-29.807 29.809v221.27c-1.31e-4 17.518 14.201 31.719 31.719 31.719h360.38c19.84 1.8e-4 35.922-16.084 35.922-35.924v-215.54c5.2e-4 -17.307-14.029-31.337-31.336-31.338h-86.865l-16.549-48.605c-2.1787-6.3967-8.1858-10.698-14.943-10.697h-129.92zm224.45 102.69c12.237 5.2e-4 22.156 9.8009 22.156 21.889 3.9e-4 12.088-9.9185 21.888-22.156 21.889-12.238 5.4e-4 -22.161-9.7994-22.16-21.889 7e-4 -12.088 9.9224-21.889 22.16-21.889zm-158.85 30.947c37.042-8.9e-4 67.071 30.028 67.07 67.07-1.9e-4 37.042-30.029 67.069-67.07 67.068-37.041-1.8e-4 -67.07-30.028-67.07-67.068-8.9e-4 -37.041 30.029-67.07 67.07-67.07z"
                fill="#ffffff" />
              `;
            break;
          case ContributionType.EDIT_LOCATION:
            svg.innerHTML = `
              <path
                d="m275.28 191.57-37.927 265.39-182.75-401.92zm182.12 46.046-274.31 38.177-128.26-220.75z"
                stroke-linecap="round"
                stroke-linejoin="round"
                fill="#ffffff"
                stroke="#ffffff"
                stroke-width="26.07" />`;
            break;
          case ContributionType.EDIT_TITLE:
            svg.innerHTML = `
              <path d="m15.116 412.39v84.373h84.373" fill="none" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round" stroke-width="30" />
              <path d="m496.66 412.24v84.373h-84.373" fill="none" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round" stroke-width="30" />
              <path d="m14.915 100.07v-84.373h84.373" fill="none" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round" stroke-width="30" />
              <path d="m496.46 100.22v-84.373h-84.373" fill="none" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round" stroke-width="30" />
              <path
                d="m81.232 82.633v142.8l29.4 1.4004c1.2444-20.844 3.4221-38.112 6.5332-51.801 3.4222-14 7.7775-25.044 13.066-33.133 5.6-8.4 12.291-14.156 20.068-17.268 7.7778-3.4222 16.955-5.1328 27.533-5.1328h42.467v261.33c0 14.311-13.844 21.467-41.533 21.467v27.066h155.4v-27.066c-28 0-42-7.1557-42-21.467v-261.33h42c10.578 0 19.755 1.7106 27.533 5.1328 7.7778 3.1111 14.313 8.8676 19.602 17.268 5.6 8.0889 9.9553 19.133 13.066 33.133 3.4222 13.689 5.7556 30.956 7 51.801l29.4-1.4004v-142.8h-349.54z"
                fill="#ffffff" />`;
            break;
          case ContributionType.EDIT_DESCRIPTION:
            svg.innerHTML = `
              <path d="m15.116 412.39v84.373h84.373" fill="none" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round" stroke-width="30" />
              <path d="m496.66 412.24v84.373h-84.373" fill="none" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round" stroke-width="30" />
              <path d="m14.915 100.07v-84.373h84.373" fill="none" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round" stroke-width="30" />
              <path d="m496.46 100.22v-84.373h-84.373" fill="none" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round" stroke-width="30" />
              <path
                d="m79.133 82.633v27.533c27.689 0 41.533 7.1557 41.533 21.467v249.2c0 14.311-13.844 21.467-41.533 21.467v27.066h182c28.311 0 53.201-2.9561 74.668-8.8672s39.355-15.867 53.666-29.867c14.622-14 25.51-32.667 32.666-56 7.1556-23.333 10.734-52.577 10.734-87.732 0-34.533-3.5788-62.533-10.734-84-7.1556-21.467-18.044-38.111-32.666-49.934-14.311-11.822-32.199-19.756-53.666-23.801-21.467-4.3556-46.357-6.5332-74.668-6.5332h-182zm112.93 36.867h76.533c17.422 0 31.889 2.489 43.4 7.4668 11.822 4.6667 21.156 12.134 28 22.4 7.1556 10.267 12.134 23.644 14.934 40.133 2.8 16.178 4.1992 35.779 4.1992 58.801 0 23.022-1.3992 43.555-4.1992 61.6s-7.778 33.288-14.934 45.732c-6.8444 12.133-16.178 21.467-28 28-11.511 6.2222-25.978 9.334-43.4 9.334h-76.533v-273.47z"
                fill="#ffffff" />`;
            break;
        }
        return svg;
      };

      const simplePostHandler = (status: ContributionStatus) => <T extends { id: string }>(request: T, response: string) => {
        if (response === "DONE") {
          addManualStatusChange(request.id, status);
        }
      };

      const addManualStatusChange = async (id: string, status: ContributionStatus, historyOnly = false, extras: Partial<StoredContribution> = {}) => {
        using idb = await toolbox.openIDB("history", "readwrite");
        const nom = await idb.get(id);
        const history = nom.statusHistory;
        const oldStatus = history.length ? history[history.length - 1].status : null;
        const timestamp = Date.now();
        const newStatus = historyOnly ? nom.status : status;
        const newEntry = {
          timestamp,
          status,
          // Verified, because we caught the reponse from the API that
          // this event literally just happened right now
          verified: true,
        };
        history.push(newEntry);
        idb.put({
          ...nom,
          ...extras,
          status: newStatus,
          statusHistory: history,
        });
        idb.commit();
        
        const box = document.querySelector(".oprnsh-dropdown");
        if (box) {
          addEventToHistoryDisplay(box, newEntry, oldStatus);
        }
      };

      toolbox.interceptOpenJson("GET", "/api/v1/vault/manage", handleNominations);
      toolbox.interceptSendJson("/api/v1/vault/manage/hold", simplePostHandler(ContributionStatus.HELD));
      toolbox.interceptSendJson("/api/v1/vault/manage/releasehold", simplePostHandler(ContributionStatus.NOMINATED));
      // TODO:
      // toolbox.interceptSendJson("/api/v1/vault/manage/withdraw", simplePostHandler(ContributionStatus.WITHDRAWN));
      toolbox.interceptSendJson("/api/v1/vault/manage/appeal", simplePostHandler(ContributionStatus.APPEALED));
    },
  });
};

class UnresolvableProcessingError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "UnresolvableProcessingError";
  }
}

class NominationMatchingError extends UnresolvableProcessingError {
  constructor(message?: string) {
    super(message);
    this.name = "NominationMatchingError";
  }
}

class AmbiguousRejectionError extends UnresolvableProcessingError {
  constructor(message?: string) {
    super(message);
    this.name = "AmbiguousRejectionError";
  }
}

class EmailParsingError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "EmailParsingError";
  }
}
class UnknownTemplateError extends EmailParsingError {
  constructor(message?: string) {
    super(message);
    this.name = "UnknownTemplateError";
  }
}
class MissingDataError extends EmailParsingError {
  constructor(message?: string) {
    super(message);
    this.name = "MissingDataError";
  }
}

type EmailStatusResolver = (doc: Document, history: StatusHistoryEntry[], email: WayfarerEmail) => HistoryEntryStatus | undefined;
type EmailImageResolver<T extends AnyContribution> = (doc: Document, submissions: T[], email: WayfarerEmail) => string | undefined;

interface BaseTemplateResolver<T extends AnyContribution> {
  status: EmailStatusResolver[],
  image: EmailImageResolver<T>[],
}

interface NominationTemplateResolver extends BaseTemplateResolver<Nomination> {
  type: (
    EmailType.NOMINATION_DECIDED |
    EmailType.NOMINATION_RECEIVED |
    EmailType.NOMINATION_APPEAL_DECIDED |
    EmailType.NOMINATION_APPEAL_RECEIVED
  )
}

type TemplateResolver = NominationTemplateResolver;

const determineRejectType = (history: StatusHistoryEntry[], email: WayfarerEmail) => {
  const [appealed] = history.filter(e => e.status === ContributionStatus.APPEALED);
  if (appealed) {
    const appealDate = new Date(appealed.timestamp);
    const emailDate = new Date(email.getFirstHeaderValue("Date"));
    // Niantic doesn't send the correct email when they reject something as duplicate on appeal.
    // We catch this here to prevent errors.
    if (appealDate < emailDate) {
      return determineAppealRejectType(history);
    }
  }
  for (const entry of history) {
    switch (entry.status) {
      case ContributionStatus.REJECTED:
      case ContributionStatus.DUPLICATE:
        return entry.status;
      case ContributionStatus.APPEALED:
        if (STRICT_MODE) {
          throw new AmbiguousRejectionError(
            "This email was rejected because determining the former status of this nomination after " +
            "appealing it is impossible if it was appealed prior to the installation of this script.",
          );
        } else {
          return ContributionStatus.REJECTED;
        }
    }
  }
  throw new AmbiguousRejectionError(
    "This email was rejected because it was not possible to determine how this nomination was " + 
    "rejected (expected status REJECTED or DUPLICATE, but observed " +
    `${history[history.length - 1].status}).`,
  );
};

const determineAppealRejectType = (history: StatusHistoryEntry[]) => {
  const start = history.map(h => h.status).indexOf(ContributionStatus.APPEALED) + 1;
  for (let i = start; i < history.length; i++) {
    switch (history[i].status) {
      case ContributionStatus.REJECTED:
      case ContributionStatus.DUPLICATE:
        return history[i].status;
    }
  }
  if (STRICT_MODE) {
    throw new AmbiguousRejectionError(
      "This email was not processed because it was not possible to determine how Niantic rejected " +
      "the appeal (expected status REJECTED or DUPLICATE, but observed " +
      `${history[history.length - 1].status}).`);
  } else {
    return ContributionStatus.REJECTED;
  }
};

const shiftDays = (date: Date, offset: number) => {
  const nd = new Date(date);
  nd.setUTCDate(nd.getUTCDate() + offset);
  return nd;
};

const MONTHS = {
  ENGLISH:        ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  BENGALI:        ["জানু", "ফেব", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"],
  SPANISH:        ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"],
  FRENCH:         ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"],
  HINDI:          ["जन॰", "फ़र॰", "मार्च", "अप्रैल", "मई", "जून", "जुल॰", "अग॰", "सित॰", "अक्तू॰", "नव॰", "दिस॰"],
  ITALIAN:        ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"],
  DUTCH:          ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"],
  MARATHI:        ["जाने", "फेब्रु", "मार्च", "एप्रि", "मे", "जून", "जुलै", "ऑग", "सप्टें", "ऑक्टो", "नोव्हें", "डिसें"],
  NORWEGIAN:      ["jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "des"],
  POLISH:         ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"],
  PORTUGUESE:     ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"],
  RUSSIAN:        ["янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."],
  SWEDISH:        ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"],
  TAMIL:          ["ஜன.", "பிப்.", "மார்.", "ஏப்.", "மே", "ஜூன்", "ஜூலை", "ஆக.", "செப்.", "அக்.", "நவ.", "டிச."],
  TELUGU:         ["జన", "ఫిబ్ర", "మార్చి", "ఏప్రి", "మే", "జూన్", "జులై", "ఆగ", "సెప్టెం", "అక్టో", "నవం", "డిసెం"],
  THAI:           ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."],
  NUMERIC:        ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"],
  ZERO_PREFIXED:  ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"],
};

class ImageQuery {
  static imageAny = () => (doc: Document) => doc.querySelector("img")?.src;
  static imageAlt = (alt: string) => (doc: Document) => doc.querySelector<HTMLImageElement>(`img[alt='${alt}']`)?.src;
  static ingType1 = () => (doc: Document) => doc.querySelector("h2 ~ p:last-of-type")?.lastChild?.textContent?.trim();
  static ingType2 = () => (doc: Document) => doc.querySelector<HTMLImageElement>("h2 ~ p:last-of-type img")?.src;
  static ingType3 = (status: ContributionStatus, regex: RegExp, tooClose?: string) => (doc: Document, submissions: Nomination[], email: WayfarerEmail) => {
    const match = email.getFirstHeaderValue("Subject").match(regex);
    if (match === null) throw new Error("Unable to extract the name of the Wayspot from this email.");
    const text = doc.querySelector("p")?.textContent.trim();
    if (tooClose && text?.includes(tooClose)) status = ContributionStatus.ACCEPTED;
    const candidates = submissions.filter(e => e.title == match.groups!.title && e.status == status);
    if (!candidates.length) throw new NominationMatchingError(`Unable to find a nomination with status ${status} that matches the title "${match.groups!.title}" on this Wayfarer account.`);
    if (candidates.length > 1) throw new NominationMatchingError(`Multiple nominations with status ${status} on this Wayfarer account match the title "${match.groups!.title}" specified in the email.`);
    return candidates[0].imageUrl;
  };
  static ingType4 = () => (doc: Document, submissions: Nomination[]) => {
    const query = doc.querySelector("h2 ~ p:last-of-type");
    if (!query) return;
    const [title, desc] = query.textContent.split("\n");
    if (!title || !desc) return;
    const candidates = submissions.filter(e => e.title == title);
    if (!candidates.length) throw new Error(`Unable to find a nomination that matches the title "${title}" on this Wayfarer account.`);
    if (candidates.length > 1) {
      const cand2 = candidates.filter(e => e.description == desc);
      if (!cand2.length) throw new NominationMatchingError(`Unable to find a nomination that matches the title "${title}" and description "${desc}" on this Wayfarer account.`);
      if (cand2.length > 1) throw new NominationMatchingError(`Multiple nominations on this Wayfarer account match the title "${title}" and description "${desc}" specified in the email.`);
      return cand2[0].imageUrl;
    }
    return candidates[0].imageUrl;
  };
  static ingType5 = () => (doc: Document, submissions: Nomination[], email: WayfarerEmail) => {
    const a = doc.querySelector<HTMLAnchorElement>("a[href^=\"https://www.ingress.com/intel?ll=\"]");
    if (a === null) return;
    const match = a.href.match(/\?ll=(?<lat>-?\d{1,2}(\.\d{1,6})?),(?<lng>-?\d{1,3}(\.\d{1,6})?)/);
    if (match === null) return;
    const candidates = submissions.filter(e => e.lat == parseFloat(match.groups!.lat) && e.lng == parseFloat(match.groups!.lng));
    if (candidates.length != 1) {
      const m2 = email.getFirstHeaderValue("Subject").match(/^(Ingress Portal Live|Portal review complete): ?(?<title>.*)$/);
      if (m2 === null) throw new Error("Unable to extract the name of the Wayspot from this email.");
      const cand2 = (candidates.length ? candidates : submissions).filter(e => e.title == m2.groups!.title);
      if (!cand2.length) throw new NominationMatchingError(`Unable to find a nomination that matches the title "${m2.groups!.title}" or is located at ${match.groups!.lat},${match.groups!.lng} on this Wayfarer account.`);
      if (cand2.length > 1) throw new NominationMatchingError(`Multiple nominations on this Wayfarer account match the title "${m2.groups!.title}" and/or are located at ${match.groups!.lat},${match.groups!.lng} as specified in the email.`);
      return cand2[0].imageUrl;
    }
    return candidates[0].imageUrl;
  };
  static ingType6 = (regex: RegExp) => (doc: Document, submissions: Nomination[], email: WayfarerEmail) => {
    const match = email.getFirstHeaderValue("Subject").match(regex);
    if (match === null) throw new Error("Unable to extract the name of the Wayspot from this email.");
    const date = new Date(email.getFirstHeaderValue("Date"));
    // Wayfarer is in UTC, but emails are in local time. Work around this by also matching against
    // the preceding and following dates from the one specified in the email.
    const dateCur = toUtcIsoDate(date);
    const dateNext = toUtcIsoDate(shiftDays(date, 1));
    const datePrev = toUtcIsoDate(shiftDays(date, -1));
    const dates = [datePrev, dateCur, dateNext];
    const candidates = submissions.filter(e => dates.includes(e.day) && e.title.trim() == match.groups!.title);
    if (!candidates.length) throw new NominationMatchingError(`Unable to find a nomination that matches the title "${match.groups!.title}" and submission date ${dateCur} on this Wayfarer account.`);
    if (candidates.length > 1) throw new NominationMatchingError(`Multiple nominations on this Wayfarer account match the title "${match.groups!.title}" and submission date ${dateCur} specified in the email.`);
    return candidates[0].imageUrl;
  };
  static pgoType1 = () => (doc: Document) => doc.querySelector("h2 ~ p:last-of-type")?.previousElementSibling?.textContent.trim();
  static pgoType2 = () => (doc: Document) => doc.querySelector("h2 ~ p:last-of-type")?.previousElementSibling?.querySelector("img")?.src;
  static wfDecidedNomination = (regex: RegExp, monthNames: string[][]) => (doc: Document, submissions: Nomination[]) => {
    const header = (doc.querySelector(".em_font_20") || doc.querySelector(".em_org_u")?.firstChild)?.textContent?.trim();
    let month = null;
    let match = null;
    for (let i = 0; i < monthNames.length; i++) {
      const months = monthNames[i];
      const mr = new RegExp(regex.source.split("(?<month>)").join(`(?<month>${months.join("|")})`));
      match = header?.match(mr);
      if (match) {
        month = months.indexOf(match.groups!.month) + 1;
        break;
      }
    }
    if (!match || month === null) return;
    const date = `${match.groups!.year}-${month.toString().padStart(2, "0")}-${match.groups!.day.padStart(2, "0")}`;
    // Wayfarer is in UTC, but emails are in local time. Work around this by also matching against
    // the preceding and following dates from the one specified in the email.
    const dateNext = toUtcIsoDate(shiftDays(new Date(date), 1));
    const datePrev = toUtcIsoDate(shiftDays(new Date(date), -1));
    const dates = [datePrev, date, dateNext];
    const candidates = submissions.filter(e =>
      dates.includes(e.day) &&
      EmailAPI.stripDiacritics(e.title) == match.groups!.title &&
      [
        ContributionStatus.ACCEPTED,
        ContributionStatus.REJECTED,
        ContributionStatus.DUPLICATE,
        ContributionStatus.APPEALED,
        ContributionStatus.NIANTIC_REVIEW,
      ].includes(e.status),
    );
    if (!candidates.length) {
      throw new NominationMatchingError(
        `Unable to find a nomination that matches the title "${match.groups!.title}" ` +
        `and submission date ${date} on this Wayfarer account.`,
      );
    }
    if (candidates.length > 1) {
      throw new NominationMatchingError(
        `Multiple nominations on this Wayfarer account match the title "${match.groups!.title}" ` +
        `and submission date ${date} specified in the email.`,
      );
    }
    return candidates[0].imageUrl;
  };
}

class StatusQuery {
  static wfDecided = (acceptText?: string, rejectText?: string) => (doc: Document, history: StatusHistoryEntry[], email: WayfarerEmail) => {
    const text = doc.querySelector(".em_font_20")?.parentElement?.nextElementSibling?.textContent.replace(/\s+/g, " ").trim();
    if (acceptText && text?.includes(acceptText)) return ContributionStatus.ACCEPTED;
    if (rejectText && text?.includes(rejectText)) return determineRejectType(history, email);
  };
  static wfDecidedNia = (acceptText?: string, rejectText?: string) => (doc: Document, history: StatusHistoryEntry[], email: WayfarerEmail) => {
    const text = doc.querySelector(".em_org_u")?.textContent.replace(/\s+/g, " ").trim();
    if (acceptText && text?.includes(acceptText)) return ContributionStatus.ACCEPTED;
    if (rejectText && text?.includes(rejectText)) return determineRejectType(history, email);
  };
  static wfDecidedNia2 = (acceptText?: string, rejectText?: string) => (doc: Document, history: StatusHistoryEntry[], email: WayfarerEmail) => {
    const text = doc.querySelector(".em_font_20")?.textContent.split("\n")[2]?.replace(/\s+/g, " ").trim();
    if (acceptText && text?.includes(acceptText)) return ContributionStatus.ACCEPTED;
    if (rejectText && text?.includes(rejectText)) return determineRejectType(history, email);
  };
  static wfAppealDecided = (acceptText?: string, rejectText?: string) => (doc: Document, history: StatusHistoryEntry[]) => {
    const text = doc.querySelector(".em_font_20")?.parentElement?.nextElementSibling?.textContent.replace(/\s+/g, " ").trim();
    if (acceptText && text?.includes(acceptText)) return ContributionStatus.ACCEPTED;
    if (rejectText && text?.includes(rejectText)) return determineAppealRejectType(history);
  };
  static ingDecided = (acceptText1?: string, acceptText2?: string, rejectText?: string, dupText1?: string, tooCloseText?: string, dupText2?: string) => (doc: Document) => {
    const text = (doc.querySelector("h2 + p") || doc.querySelector("p"))?.textContent.trim();
    if (acceptText1 && text?.startsWith(acceptText1)) return ContributionStatus.ACCEPTED;
    if (acceptText2 && text?.startsWith(acceptText2)) return ContributionStatus.ACCEPTED;
    if (rejectText && text?.includes(rejectText)) return ContributionStatus.REJECTED;
    if (dupText1 && text?.includes(dupText1)) return ContributionStatus.DUPLICATE;
    if (tooCloseText && text?.includes(tooCloseText)) return ContributionStatus.ACCEPTED;
    const query2 = doc.querySelector("p:nth-child(2)");
    if (query2 && dupText2 && query2.textContent.trim().includes(dupText2)) return ContributionStatus.DUPLICATE;
  };
}

interface ProcessedEmailChange {
  type: ContributionType,
  title: string,
  updates: StatusHistoryEntry[],
}

interface ProcessedEmail {
  status: EmailProcessingResult,
  reason: string | null,
  change: ProcessedEmailChange | null,
  id: string | null,
  error: Error | null,
}

const processEmail = (email: WayfarerEmail, submissions: AnyContribution[], history: Record<string, StatusHistoryEntry[]>): ProcessedEmail => {
  let change: ProcessedEmail["change"] = null;
  let id: ProcessedEmail["id"] = null;
  let returnStatus: ProcessedEmail["status"] = EmailProcessingResult.SUCCESS;
  let reason: ProcessedEmail["reason"] = null;
  let except: ProcessedEmail["error"] = null;

  try {
    const emlClass = email.classify();
    if (!SUPPORTED_EMAIL_TYPES.includes(emlClass.type) || emlClass.style === EmailStyle.LIGHTSHIP) {
      returnStatus = EmailProcessingResult.SKIPPED;
      reason = (
        "This email is either for a type of contribution that is not trackable in OPR, " +
        "or for content that is unrelated to OPR."
      );
    } else {
      const doc = email.getDocument();
      if (doc === null) {
        throw new EmailParsingError("Email does not have a text/html alternative");
      }
      // TODO: Edits/photos
      let template: TemplateResolver | null = null;
      if (emlClass.style === EmailStyle.WAYFARER && emlClass.type === EmailType.NOMINATION_RECEIVED) {
        template = {
          type: emlClass.type,
          status: [() => ContributionStatus.NOMINATED],
          image: [ImageQuery.imageAlt("Submission Photo")],
        };
      } else if (emlClass.style === EmailStyle.WAYFARER && emlClass.type === EmailType.NOMINATION_APPEAL_RECEIVED) {
        template = {
          type: emlClass.type,
          status: [() => ContributionStatus.APPEALED],
          image: [ImageQuery.imageAlt("Submission Photo")],
        };
      } else {
        const subject = email.getFirstHeaderValue("Subject");
        for (const parser of EMAIL_PARSERS) {
          if (emlClass.type === parser.type && subject.match(parser.subject)) {
            template = parser;
          }
        }
      }
      if (template === null) {
        throw new UnknownTemplateError(
          "This email does not appear to match any styles of Niantic " +
          "emails currently known to Nomination Status History.",
        );
      }
      // TODO: Edit/photo handling
      
      let sub: AnyContribution | null = null;
      switch (template.type) {
        case EmailType.NOMINATION_APPEAL_DECIDED:
        case EmailType.NOMINATION_APPEAL_RECEIVED:
        case EmailType.NOMINATION_DECIDED:
        case EmailType.NOMINATION_RECEIVED:
          sub = processNominationEmail(doc, submissions.filter(s => s.type === ContributionType.NOMINATION), email, template);
          break;

        default:
          throw new UnknownTemplateError(
            "Failed to find a valid contribution resolver function " +
            `for email template ${template.type}`,
          );
      }

      let status: HistoryEntryStatus | null = null;
      for (const sr of template.status) {
        status = sr(doc, history[sub.id] ?? [], email) ?? null;
        if (status !== null) break;
      }

      if (status === null) {
        throw new MissingDataError(
          "Unable to determine the status change that this email represents.",
        );
      }

      change = {
        type: sub.type,
        title: sub.title,
        updates: [{
          timestamp: new Date(email.getFirstHeaderValue("Date")).getTime(),
          verified: true,
          email: email.messageID,
          status,
        }],
      };
      id = sub.id;
    }
  } catch (e) {
    except = e as Error;
    if (e instanceof UnresolvableProcessingError) {
      console.warn(e);
      returnStatus = EmailProcessingResult.AMBIGUOUS;
    } else if (e instanceof EmailParsingError) {
      console.error(e, email);
      returnStatus = EmailProcessingResult.UNSUPPORTED;
    } else {
      console.error(e, email);
      returnStatus = EmailProcessingResult.FAILURE;
    }
    reason = except.message;
  }
  return {
    status: returnStatus,
    reason,
    change,
    id,
    error: except,
  };
};

const processNominationEmail = (
  doc: Document,
  nominations: Nomination[],
  email: WayfarerEmail,
  template: NominationTemplateResolver,
): Nomination  => {
  let url: string | null = null;
  for (const ir of template.image) {
    url = ir(doc, nominations, email) ?? null;
    if (url !== null) {
      const match = url.match(/^https?:\/\/lh3.googleusercontent.com\/(.*)$/);
      if (!match) url = null;
      else url = match[1];
    }
    if (url !== null) break;
  }

  if (url === null) {
    throw new MissingDataError(
      "Could not determine which nomination this email references.",
    );
  }
  const [nom] = nominations.filter(n => n.imageUrl.endsWith(`/${url}`));
  if (!nom) {
    throw new NominationMatchingError(
      "The nomination that this email refers to cannot be found " +
      `on this OPR account (failed to match LH3 URL ${url}).`,
    );
  }
  return nom;
};

const EMAIL_PARSERS: ({ subject: RegExp } & TemplateResolver)[] = [
  //  ---------------------------------------- ENGLISH [en] ----------------------------------------
  {
    // Nomination decided (Wayfarer)
    subject: /^Niantic Wayspot nomination decided for/,
    type: EmailType.NOMINATION_DECIDED,
    status: [
      StatusQuery.wfDecided(
        "has decided to accept your Wayspot nomination.",
        "has decided not to accept your Wayspot nomination.",
      ),
      StatusQuery.wfDecidedNia(
        "Congratulations, our team has decided to accept your Wayspot nomination",
        "did not meet the criteria required to be accepted and has been rejected",
      ),
    ],
    image: [
      ImageQuery.wfDecidedNomination(
        /^Thank you for your Wayspot nomination (?<title>.*) on (?<month>) (?<day>\d+), (?<year>\d+)!$/,
        [MONTHS.ENGLISH],
      ),
      ImageQuery.wfDecidedNomination(
        /^Thank you for taking the time to nominate (?<title>.*) on (?<month>) (?<day>\d+), (?<year>\d+)\./,
        [MONTHS.ENGLISH],
      ),
    ],
  },
  {
    // Nomination decided (Wayfarer, NIA)
    subject: /^Decision on your? Wayfarer Nomination,/,
    type: EmailType.NOMINATION_DECIDED,
    status: [
      StatusQuery.wfDecidedNia(
        undefined, // Accepted - this email template was never used for acceptances
        "did not meet the criteria required to be accepted and has been rejected",
      ),
    ],
    image: [
      ImageQuery.wfDecidedNomination(
        /^Thank you for taking the time to nominate (?<title>.*) on (?<month>) (?<day>\d+), (?<year>\d+)\./,
        [MONTHS.ENGLISH],
      ),
    ],
  },
  {
    // Appeal decided
    subject: /^Your Niantic Wayspot appeal has been decided for/,
    type: EmailType.NOMINATION_APPEAL_DECIDED,
    status: [
      StatusQuery.wfAppealDecided(
        "Niantic has decided that your nomination should be added as a Wayspot",
        "Niantic has decided that your nomination should not be added as a Wayspot",
      ),
    ],
    image: [
      ImageQuery.wfDecidedNomination(
        /^Thank you for your Wayspot nomination appeal for (?<title>.*) on (?<month>) (?<day>\d+), (?<year>\d+).$/,
        [MONTHS.ENGLISH],
      ),
    ],
  },
  {
    // Nomination received (Ingress)
    subject: /^Portal submission confirmation:/,
    type: EmailType.NOMINATION_RECEIVED,
    status: [() => ContributionStatus.NOMINATED],
    image: [
      ImageQuery.imageAlt("Nomination Photo"),
      ImageQuery.ingType1(),
      ImageQuery.ingType6(
        /^Portal submission confirmation: (?<title>.*)$/,
      ),
    ],
  },
  {
    // Nomination decided (Ingress)
    subject: /^Portal review complete:/,
    type: EmailType.NOMINATION_DECIDED,
    status: [
      StatusQuery.ingDecided(
        "Good work, Agent:",
        "Excellent work, Agent.",
        "we have decided not to accept this candidate.",
        "your candidate is a duplicate of an existing Portal.",
        "this candidate is too close to an existing Portal",
        "Your candidate is a duplicate of either an existing Portal",
      ),
    ],
    image: [
      ImageQuery.imageAlt("Nomination Photo"),
      ImageQuery.ingType1(),
      ImageQuery.ingType2(),
      ImageQuery.ingType5(),
      ImageQuery.ingType4(),
    ],
  },
  {
    // Nomination received (Ingress Redacted)
    subject: /^Ingress Portal Submitted:/,
    type: EmailType.NOMINATION_RECEIVED,
    status: [() => ContributionStatus.NOMINATED],
    image: [
      ImageQuery.ingType6(
        /^Ingress Portal Submitted: (?<title>.*)$/,
      ),
    ],
  },
  {
    // Nomination duplicated (Ingress Redacted)
    subject: /^Ingress Portal Duplicate:/,
    type: EmailType.NOMINATION_DECIDED,
    status: [() => ContributionStatus.DUPLICATE],
    image: [
      ImageQuery.ingType3(
        ContributionStatus.DUPLICATE,
        /^Ingress Portal Duplicate: (?<title>.*)$/,
      ),
    ],
  },
  {
    // Nomination accepted (Ingress Redacted)
    subject: /^Ingress Portal Live:/,
    type: EmailType.NOMINATION_DECIDED,
    status: [() => ContributionStatus.ACCEPTED],
    image: [
      ImageQuery.ingType5(),
    ],
  },
  {
    // Nomination rejected (Ingress Redacted)
    subject: /^Ingress Portal Rejected:/,
    type: EmailType.NOMINATION_DECIDED,
    status: [() => ContributionStatus.REJECTED],
    image: [
      ImageQuery.ingType3(
        ContributionStatus.REJECTED,
        /^Ingress Portal Rejected: (?<title>.*)$/,
        "Unfortunately, this Portal is too close to another existing Portal",
      ),
    ],
  },
  {
    // Nomination received (PoGo)
    subject: /^Trainer [^:]+: Thank You for Nominating a PokéStop for Review.$/,
    type: EmailType.NOMINATION_RECEIVED,
    status: [() => ContributionStatus.NOMINATED],
    image: [
      ImageQuery.pgoType1(),
    ],
  },
  {
    // Nomination accepted (PoGo)
    subject: /^Trainer [^:]+: Your PokéStop Nomination Is Eligible!$/,
    type: EmailType.NOMINATION_DECIDED,
    status: [() => ContributionStatus.ACCEPTED],
    image: [
      ImageQuery.pgoType1(),
      ImageQuery.pgoType2(),
    ],
  },
  {
    // Nomination rejected (PoGo)
    subject: /^Trainer [^:]+: Your PokéStop Nomination Is Ineligible$/,
    type: EmailType.NOMINATION_DECIDED,
    status: [() => ContributionStatus.REJECTED],
    image: [
      ImageQuery.pgoType1(),
      ImageQuery.pgoType2(),
    ],
  },
  {
    // Nomination duplicated (PoGo)
    subject: /^Trainer [^:]+: Your PokéStop Nomination Review Is Complete:/,
    type: EmailType.NOMINATION_DECIDED,
    status: [() => ContributionStatus.DUPLICATE],
    image: [
      ImageQuery.pgoType1(),
      ImageQuery.pgoType2(),
    ],
  },

  //  ---------------------------------------- BENGALI [bn] ----------------------------------------
  {
    // Nomination decided (Wayfarer)
    subject: /-এর জন্য Niantic Wayspot মনোনয়নের সিদ্ধান্ত নেওয়া হয়েছে/,
    type: EmailType.NOMINATION_DECIDED,
    status: [
      StatusQuery.wfDecided(
        "অনুসারে আপনার Wayspot মনোনয়ন স্বীকার করতে চানদ",
        "অনুসারে আপনার Wayspot মনোনয়ন স্বীকার করতে স্বীকার করতে চান না",
      ),
      StatusQuery.wfDecidedNia2(
        "অভিনন্দন, আমাদের দল আপনার Wayspot-এর মনোনয়ন গ্রহণ করার সিদ্ধান্ত নিয়েছেন।",
        undefined, //'did not meet the criteria required to be accepted and has been rejected'
      ),
    ],
    image: [
      ImageQuery.wfDecidedNomination(
        /^(?<month>) (?<day>\d+), (?<year>\d+)-এ আপনার Wayspot মনোনয়ন (?<title>.*) করার জন্য আপনাকে ধন্যবাদ জানাই!$/,
        [MONTHS.ENGLISH, MONTHS.BENGALI],
      ),
      ImageQuery.wfDecidedNomination(
        /^(?<title>.*)-কে(?<day>\d+) (?<month>), (?<year>\d+) -তে মনোয়ন করতে সময় দেওয়ার জন্য আপনাকে ধন্যবাদ।/,
        [MONTHS.BENGALI],
      ),
    ],
  },

  //  ---------------------------------------- CZECH [cs] ----------------------------------------
  {
    // Nomination decided (Wayfarer)
    subject: /^Rozhodnutí o nominaci na Niantic Wayspot pro/,
    type: EmailType.NOMINATION_DECIDED,
    status: [
      StatusQuery.wfDecided(
        "se rozhodla přijmout vaši nominaci na Wayspot",
        "se rozhodla nepřijmout vaši nominaci na Wayspot",
      ),
      StatusQuery.wfDecidedNia(
        "Gratulujeme, náš tým se rozhodl vaši nominaci na Wayspot přijmout.",
        undefined, //'did not meet the criteria required to be accepted and has been rejected'
      ),
    ],
    image: [
      ImageQuery.wfDecidedNomination(
        /^děkujeme za vaši nominaci na Wayspot (?<title>.*) ze dne (?<day>\d+)\. ?(?<month>)\. ?(?<year>\d+)!$/,
        [MONTHS.NUMERIC],
      ),
      ImageQuery.wfDecidedNomination(
        /^děkujeme za vaši nominaci (?<title>.*) ze dne (?<day>\d+)\. ?(?<month>)\. ?(?<year>\d+)\./,
        [MONTHS.NUMERIC],
      ),
    ],
  },
  {
    // Appeal decided
    subject: /^Rozhodnutí o odvolání proti nominaci na Niantic Wayspot pro/,
    type: EmailType.NOMINATION_APPEAL_DECIDED,
    status: [
      StatusQuery.wfAppealDecided(
        "Niantic se rozhodla, že vaše nominace ACCEPT by měla/by neměla být přidána jako Wayspot",
        "Niantic se rozhodla, že vaše nominace REJECT by měla/by neměla být přidána jako Wayspot",
      ),
    ],
    image: [
      ImageQuery.wfDecidedNomination(
        /^děkujeme za vaše odvolání proti odmítnutí nominace na Wayspot (?<title>.*) ze dne (?<day>\d+)\. (?<month>)\. (?<year>\d+)\.$/,
        [MONTHS.NUMERIC],
      ),
    ],
  },

  //  ---------------------------------------- GERMAN [de] ----------------------------------------
  {
    // Nomination decided (Wayfarer)
    subject: /^Entscheidung zum Wayspot-Vorschlag/,
    type: EmailType.NOMINATION_DECIDED,
    status: [
      StatusQuery.wfDecided(
        "hat entschieden, deinen Wayspot-Vorschlag zu akzeptieren.",
        "hat entschieden, deinen Wayspot-Vorschlag nicht zu akzeptieren.",
      ),
      StatusQuery.wfDecidedNia2(
        "Glückwunsch, unser Team hat entschieden, deinen Wayspot-Vorschlag zu akzeptieren.",
        undefined, //'did not meet the criteria required to be accepted and has been rejected'
      ),
    ],
    image: [
      ImageQuery.wfDecidedNomination(
        /^danke, dass du den Wayspot-Vorschlag (?<title>.*) am (?<day>\d+)\.(?<month>)\.(?<year>\d+) eingereicht hast\.$/,
        [MONTHS.ZERO_PREFIXED],
      ),
      ImageQuery.wfDecidedNomination(
        /^Danke, dass du dir die Zeit genommen hast, (?<title>.*) am (?<day>\d+)\.(?<month>)\.(?<year>\d+) vorzuschlagen\./,
        [MONTHS.ZERO_PREFIXED],
      ),
    ],
  },
  {
    // Appeal decided
    subject: /^Entscheidung zum Einspruch für den Wayspot/,
    type: EmailType.NOMINATION_APPEAL_DECIDED,
    status: [
      StatusQuery.wfAppealDecided(
        "Niantic hat entschieden, dass dein Vorschlag ein Wayspot werden sollte.",
        "Niantic hat entschieden, dass dein Vorschlag kein Wayspot werden sollte.",
      ),
    ],
    image: [
      ImageQuery.wfDecidedNomination(
        /^danke, dass du am (?<day>\d+)\.(?<month>)\.(?<year>\d+) einen Einspruch für den Wayspot (?<title>.*) eingereicht hast.$/,
        [MONTHS.ZERO_PREFIXED],
      ),
    ],
  },
  {
    // Nomination received (Ingress)
    subject: /^Empfangsbestätigung deines eingereichten Portalvorschlags:/,
    type: EmailType.NOMINATION_RECEIVED,
    status: [() => ContributionStatus.NOMINATED],
    image: [
      ImageQuery.imageAlt("Nomination Photo"),
      ImageQuery.ingType1(),
    ],
  },
  {
    // Nomination decided (Ingress)
    subject: /^Überprüfung des Portals abgeschlossen:/,
    type: EmailType.NOMINATION_DECIDED,
    status: [
      StatusQuery.ingDecided(
        "Gute Arbeit, Agent!",
        "Hervorragende Arbeit, Agent.",
        "konnten wir deinen Vorschlag jedoch nicht annehmen.",
        "Leider ist dieses Portal bereits vorhanden",
        undefined, //'this candidate is too close to an existing Portal.'
      ),
    ],
    image: [
      ImageQuery.imageAlt("Nomination Photo"),
      ImageQuery.ingType1(),
      ImageQuery.ingType2(),
    ],
  },
  {
    // Nomination received (PoGo)
    subject: /^Trainer [^:]+: Danke, dass du einen PokéStop zur Überprüfung vorgeschlagen hast$/,
    type: EmailType.NOMINATION_RECEIVED,
    status: [() => ContributionStatus.NOMINATED],
    image: [
      ImageQuery.pgoType1(),
    ],
  },
  {
    // Nomination accepted (PoGo)
    subject: /^Trainer [^:]+: Dein vorgeschlagener PokéStop ist zulässig!$/,
    type: EmailType.NOMINATION_DECIDED,
    status: [() => ContributionStatus.ACCEPTED],
    image: [
      ImageQuery.pgoType1(),
      ImageQuery.pgoType2(),
    ],
  },
  {
    // Nomination rejected (PoGo)
    subject: /^Trainer [^:]+: Dein vorgeschlagener PokéStop ist nicht zulässig$/,
    type: EmailType.NOMINATION_DECIDED,
    status: [() => ContributionStatus.REJECTED],
    image: [
      ImageQuery.pgoType1(),
      ImageQuery.pgoType2(),
    ],
  },
  {
    // Nomination duplicated (PoGo)
    subject: /^Trainer [^:]+: Die Prüfung deines PokéStop-Vorschlags wurde abgeschlossen:/,
    type: EmailType.NOMINATION_DECIDED,
    status: [() => ContributionStatus.DUPLICATE],
    image: [
      ImageQuery.pgoType1(),
      ImageQuery.pgoType2(),
    ],
  },

  //  ---------------------------------------- SPANISH [es] ----------------------------------------
  {
    // Nomination decided (Wayfarer)
    subject: /^Decisión tomada sobre la propuesta de Wayspot de Niantic/,
    type: EmailType.NOMINATION_DECIDED,
    status: [
      StatusQuery.wfDecided(
        "ha decidido aceptartu propuesta de Wayspot.",
        "ha decidido no aceptar tu propuesta de Wayspot.",
      ),
      StatusQuery.wfDecidedNia2(
        "Enhorabuena, nuestro equipo ha decidido aceptar tu propuesta de Wayspot.",
        undefined, //'did not meet the criteria required to be accepted and has been rejected'
      ),
    ],
    image: [
      ImageQuery.wfDecidedNomination(
        /^¡Gracias por tu propuesta de Wayspot (?<title>.*) enviada el (?<day>\d+)[- ](?<month>)(-|\. )(?<year>\d+)!$/,
        [MONTHS.SPANISH],
      ),
      ImageQuery.wfDecidedNomination(
        /^Gracias por dedicar algo de tiempo para realizar tu propuesta de (?<title>.*) el (?<day>\d+) (?<month>)\. (?<year>\d+)\./,
        [MONTHS.SPANISH],
      ),
    ],
  },

  //  ---------------------------------------- FRENCH [fr] ----------------------------------------
  {
    // Nomination decided (Wayfarer)
    subject: /^Résultat concernant la proposition du Wayspot Niantic/,
    type: EmailType.NOMINATION_DECIDED,
    status: [
      StatusQuery.wfDecided(
        "a décidé d’accepter votre proposition de Wayspot.",
        "a décidé de ne pas accepter votre proposition de Wayspot.",
      ),
      StatusQuery.wfDecidedNia2(
        "Félicitations, notre équipe a décidé d’accepter votre proposition de Wayspot.",
        "Malheureusement, l’équipe a décidé de ne pas accepter votre proposition de Wayspot.",
      ),
    ],
    image: [
      ImageQuery.wfDecidedNomination(
        /^Merci pour votre proposition de Wayspot (?<title>.*) le (?<day>\d+) (?<month>)\.? (?<year>\d+)\u2009!$/,
        [MONTHS.FRENCH],
      ),
      ImageQuery.wfDecidedNomination(
        /^Merci d’avoir pris le temps de nous envoyer votre proposition (?<title>.*) le (?<day>\d+) (?<month>)\. (?<year>\d+)\./,
        [MONTHS.FRENCH],
      ),
    ],
  },

  //  ---------------------------------------- HINDI [hi] ----------------------------------------
  {
    // Nomination decided (Wayfarer)
    subject: /^Niantic Wayspot का नामांकन .* के लिए तय किया गया$/,
    type: EmailType.NOMINATION_DECIDED,
    status: [
      StatusQuery.wfDecided(
        "ने को आपके Wayspot नामांकन को स्वीकार करने का निर्णय लिया है",
        "ने को आपके Wayspot नामांकन को अस्वीकार करने का निर्णय लिया है",
      ),
      StatusQuery.wfDecidedNia2(
        "बधाई हो, हमारी टीम ने आपके Wayspot नामांकन को मंज़ूरी दे दी है.",
        "खेद है कि हमारी टीम ने आपका Wayspot नामांकन नामंज़ूर कर दिया है.",
      ),
    ],
    image: [
      ImageQuery.wfDecidedNomination(
        /^(?<month>) (?<day>\d+), (?<year>\d+) पर Wayspot नामांकन (?<title>.*) के लिए धन्यवाद!$/,
        [MONTHS.ENGLISH, MONTHS.HINDI],
      ),
      ImageQuery.wfDecidedNomination(
        /^(?<day>\d+) (?<month>) (?<year>\d+) पर Wayspot नामांकन (?<title>.*) के लिए धन्यवाद!$/,
        [MONTHS.ENGLISH, MONTHS.HINDI],
      ),
      ImageQuery.wfDecidedNomination(
        /^(?<day>\d+) (?<month>) (?<year>\d+) को (?<title>.*) {2}के नामांकन के लिए आपने समय निकाला, उसके लिए आपका धन्यवाद\./,
        [MONTHS.HINDI],
      ),
    ],
  },

  //  ---------------------------------------- ITALIAN [it] ----------------------------------------
  {
    // Nomination decided (Wayfarer)
    subject: /^Proposta di Niantic Wayspot decisa per/,
    type: EmailType.NOMINATION_DECIDED,
    status: [
      StatusQuery.wfDecided(
        "Congratulazioni, la tua proposta di Wayspot è stata accettata",
        "Sfortunatamente, la tua proposta di Wayspot è stata respinta",
      ),
      StatusQuery.wfDecidedNia2(
        "Congratulazioni, il nostro team ha deciso di accettare la tua proposta di Wayspot.",
        undefined, //'did not meet the criteria required to be accepted and has been rejected'
      ),
    ],
    image: [
      ImageQuery.wfDecidedNomination(
        /^Grazie per la proposta di Wayspot (?<title>.*) in data (?<day>\d+)[ -](?<month>)[ -](?<year>\d+)\.$/,
        [MONTHS.ITALIAN],
      ),
      ImageQuery.wfDecidedNomination(
        /^grazie per aver trovato il tempo di inviare la tua proposta (?<title>.*) in data (?<day>\d+) (?<month>) (?<year>\d+)\./,
        [MONTHS.ITALIAN],
      ),
    ],
  },

  //  ---------------------------------------- JAPANESE [ja] ----------------------------------------
  {
    // Nomination decided (Wayfarer)
    subject: /^Niantic Wayspotの申請「.*」が決定しました。$/,
    type: EmailType.NOMINATION_DECIDED,
    status: [
      StatusQuery.wfDecided(
        "コミュニティはあなたのWayspot候補を承認しました。",
        "不幸にも コミュニティはあなたのWayspot候補を承認しませんでした。",
      ),
      StatusQuery.wfDecidedNia2(
        "チームでの検討の結果、あなたのお送りいただいたWayspot候補が採用されましたので、お知らせいたします。",
        undefined, //'did not meet the criteria required to be accepted and has been rejected'
      ),
    ],
    image: [
      ImageQuery.wfDecidedNomination(
        /^(?<year>\d+)\/(?<month>)\/(?<day>\d+)にWayspot申請「(?<title>.*)」をご提出いただき、ありがとうございました。$/,
        [MONTHS.ZERO_PREFIXED],
      ),
      ImageQuery.wfDecidedNomination(
        /^(?<year>\d+)\/(?<month>)\/(?<day>\d+)に「(?<title>.*)」を候補としてお送りいただき、ありがとうございました。/,
        [MONTHS.ZERO_PREFIXED],
      ),
    ],
  },
  {
    // Appeal decided
    subject: /^Niantic Wayspot「.*」に関する申し立てが決定しました。$/,
    type: EmailType.NOMINATION_APPEAL_DECIDED,
    status: [
      StatusQuery.wfAppealDecided(
        "Nianticはあなたが申請された候補をWayspotに追加する定しました。",
        undefined, // 'Niantic has decided that your nomination should not be added as a Wayspot'
      ),
    ],
    image: [
      ImageQuery.wfDecidedNomination(
        /^(?<year>\d+)\/(?<month>)\/(?<day>\d+)にWayspot「(?<title>.*)」に関する申し立てをご提出いただき、ありがとうございました。$/,
        [MONTHS.ZERO_PREFIXED],
      ),
    ],
  },

  //  ---------------------------------------- KOREAN [ko] ----------------------------------------
  {
    // Nomination decided (Wayfarer)
    subject: /에 대한 Niantic Wayspot 후보 결정이 완료됨$/,
    type: EmailType.NOMINATION_DECIDED,
    status: [
      StatusQuery.wfDecided(
        "제안한 Wayspot 후보를 승인했습니다",
        "제안한 Wayspot 후보를 승인하지않았습니다 .",
      ),
      StatusQuery.wfDecidedNia2(
        "축하합니다, 귀하께서 추천하신 Wayspot 후보가 승인되었습니다.",
        undefined, //'did not meet the criteria required to be accepted and has been rejected'
      ),
    ],
    image: [
      ImageQuery.wfDecidedNomination(
        /^(?<year>\d+)\. (?<month>)\. (?<day>\d+)\.?에 Wayspot 후보 (?<title>.*)을\(를\) 제출해 주셔서 감사드립니다!$/,
        [MONTHS.NUMERIC],
      ),
      ImageQuery.wfDecidedNomination(
        /^(?<year>\d+)\. (?<month>)\. (?<day>\d+)\.?에 시간을 내어 (?<title>.*) \(을\)를 추천해 주셔서 감사합니다\./,
        [MONTHS.NUMERIC],
      ),
    ],
  },

  //  ---------------------------------------- MARATHI [mr] ----------------------------------------
  {
    // Nomination decided (Wayfarer)
    subject: /^Niantic वेस्पॉट नामांकन .* साठी निश्चित केले$/,
    type: EmailType.NOMINATION_DECIDED,
    status: [
      StatusQuery.wfDecided(
        "तुमचे Wayspot नामांकन स्वीकारण्याचा निर्णय घेतला आहे",
        "तुमचे Wayspot नामांकन न स्वीकारण्याचा निर्णय घेतला आहे",
      ),
      StatusQuery.wfDecidedNia2(
        "अभिनंदन, आमच्या टीमने तुमचे Wayspot नामांकन स्वीकारण्याचा निर्णय घेतला आहे.",
        undefined, //'did not meet the criteria required to be accepted and has been rejected'
      ),
    ],
    image: [
      ImageQuery.wfDecidedNomination(
        /^तुमच्या (?<month>) (?<day>\d+), (?<year>\d+) रोजी वेस्पॉट नामांकन (?<title>.*) साठी धन्यवाद!$/,
        [MONTHS.ENGLISH],
      ),
      ImageQuery.wfDecidedNomination(
        /^तुमच्या (?<day>\d+) (?<month>), (?<year>\d+) रोजी वेस्पॉट नामांकन (?<title>.*) साठी धन्यवाद!$/,
        [MONTHS.MARATHI],
      ),
      ImageQuery.wfDecidedNomination(
        /^(?<day>\d+) (?<month>), (?<year>\d+) तारखेला (?<title>.*) {2}वर नामांकन करण्यासाठी वेळ दिल्याबद्दल धन्यवाद\./,
        [MONTHS.MARATHI],
      ),
    ],
  },
  {
    // Appeal decided
    subject: /^तुमचे Niantic वेस्पॉट आवाहन .* साठी निश्चित करण्यात आले आहे$/,
    type: EmailType.NOMINATION_APPEAL_DECIDED,
    status: [
      StatusQuery.wfAppealDecided(
        "Niantic ने ठरवले आहे की तुमचे नामांकन ACCEPT वेस्पॉट म्हणून जोडले जाऊ नये/नसावे",
        "Niantic ने ठरवले आहे की तुमचे नामांकन REJECT वेस्पॉट म्हणून जोडले जाऊ नये/नसावे",
      ),
    ],
    image: [
      ImageQuery.wfDecidedNomination(
        /^(?<month>) (?<day>\d+), (?<year>\d+) रोजी (?<title>.*) साठी तुमच्या वेस्पॉट नामांकन आवाहनाबद्दल धन्यवाद.$/,
        [MONTHS.ENGLISH, MONTHS.MARATHI],
      ),
      ImageQuery.wfDecidedNomination(
        /^(?<day>\d+) (?<month>), (?<year>\d+) रोजी (?<title>.*) साठी तुमच्या वेस्पॉट नामांकन आवाहनाबद्दल धन्यवाद.$/,
        [MONTHS.ENGLISH, MONTHS.MARATHI],
      ),
    ],
  },

  //  ---------------------------------------- DUTCH [nl] ----------------------------------------
  {
    // Nomination decided (Wayfarer)
    subject: /^Besluit over Niantic Wayspot-nominatie voor/,
    type: EmailType.NOMINATION_DECIDED,
    status: [
      StatusQuery.wfDecided(
        "heeft besloten om je Wayspot-nominatie wel te accepteren.",
        "heeft besloten om je Wayspot-nominatie niet te accepteren.",
      ),
      StatusQuery.wfDecidedNia2(
        "Gefeliciteerd, ons team heeft besloten je Wayspot-nominatie te accepteren.",
        undefined, //'did not meet the criteria required to be accepted and has been rejected'
      ),
    ],
    image: [
      ImageQuery.wfDecidedNomination(
        /^Bedankt voor je Wayspot-nominatie (?<title>.*) op (?<day>\d+)[- ](?<month>)(-|\. )(?<year>\d+)!$/,
        [MONTHS.DUTCH],
      ),
      ImageQuery.wfDecidedNomination(
        /^Bedankt dat je de tijd hebt genomen om (?<title>.*) te nomineren op (?<day>\d+) (?<month>)\. (?<year>\d+)\./,
        [MONTHS.DUTCH],
      ),
    ],
  },

  //  ---------------------------------------- NORWEGIAN [no] ----------------------------------------
  {
    // Nomination decided (Wayfarer)
    subject: /^En avgjørelse er tatt for Niantic Wayspot-nominasjonen for/,
    type: EmailType.NOMINATION_DECIDED,
    status: [
      StatusQuery.wfDecided(
        "har valgt å godta Wayspot-nominasjonen din.",
        "har valgt å avvise Wayspot-nominasjonen din.",
      ),
    ],
    image: [
      ImageQuery.wfDecidedNomination(
        /^Takk for Wayspot-nominasjonen (?<title>.*), som du sendte inn (?<day>\d+)\.(?<month>)\.(?<year>\d+)!$/,
        [MONTHS.NORWEGIAN],
      ),
    ],
  },
  {
    // Appeal decided
    subject: /^En avgjørelse er tatt for Niantic Wayspot-klagen for/,
    type: EmailType.NOMINATION_APPEAL_DECIDED,
    status: [
      StatusQuery.wfAppealDecided(
        "Niantic har valgt å legge til nominasjonen som en Wayspot",
        "Niantic har valgt ikke legge til nominasjonen som en Wayspot",
      ),
    ],
    image: [
      ImageQuery.wfDecidedNomination(
        /^Takk for klagen i forbindelse med Wayspot-nominasjonen (?<title>.*), som du sendte inn (?<day>\d+)\.(?<month>)\.(?<year>\d+).$/,
        [MONTHS.NORWEGIAN],
      ),
    ],
  },

  //  ---------------------------------------- POLISH [pl] ----------------------------------------
  {
    // Nomination decided (Wayfarer)
    subject: /^Podjęto decyzję na temat nominacji Wayspotu/,
    type: EmailType.NOMINATION_DECIDED,
    status: [
      StatusQuery.wfDecided(
        "zdecydowała zaakceptować nominacji Wayspotu.",
        "zdecydowała nie przyjąć nominacji Wayspotu.",
      ),
      StatusQuery.wfDecidedNia2(
        "Gratulację, nasz zespół zaakceptował Twoją nominację Punktu trasy.",
        undefined, //'did not meet the criteria required to be accepted and has been rejected'
      ),
    ],
    image: [
      ImageQuery.wfDecidedNomination(
        /^Dziękujemy za nominowanie Wayspotu „(?<title>.*)” (?<year>\d+)-(?<month>)-(?<day>\d+).$/,
        [MONTHS.ZERO_PREFIXED, MONTHS.POLISH],
      ),
      ImageQuery.wfDecidedNomination(
        /^Dziękujemy za nominowanie Wayspotu „(?<title>.*)” (?<day>\d+) (?<month>) (?<year>\d+).$/,
        [MONTHS.POLISH],
      ),
      ImageQuery.wfDecidedNomination(
        /^Dziękujemy za poświęcenie czasu na przesłanie nominacji (?<title>.*) {2}(?<day>\d+) (?<month>) (?<year>\d+)\./,
        [MONTHS.POLISH],
      ),
    ],
  },

  //  ---------------------------------------- PORTUGUESE [pt] ----------------------------------------
  {
    // Nomination decided (Wayfarer)
    subject: /^Decisão sobre a indicação do Niantic Wayspot/,
    type: EmailType.NOMINATION_DECIDED,
    status: [
      StatusQuery.wfDecided(
        "a comunidade decidiu aceitar a sua indicação de Wayspot.",
        "a comunidade decidiu recusar a sua indicação de Wayspot.",
      ),
      StatusQuery.wfDecidedNia2(
        "Parabéns! Nossa equipe aceitou sua indicação de Wayspot.",
        undefined, //'did not meet the criteria required to be accepted and has been rejected'
      ),
    ],
    image: [
      ImageQuery.wfDecidedNomination(
        /^Agradecemos a sua indicação do Wayspot (?<title>.*) em (?<day>\d+)(\/| de )(?<month>)(\/| de )(?<year>\d+).$/,
        [MONTHS.PORTUGUESE],
      ),
      ImageQuery.wfDecidedNomination(
        /^Agradecemos por indicar (?<title>.*) em (?<day>\d+) de (?<month>) de (?<year>\d+)\./,
        [MONTHS.PORTUGUESE],
      ),
    ],
  },

  //  ---------------------------------------- RUSSIAN [ru] ----------------------------------------
  {
    // Nomination decided (Wayfarer)
    subject: /^Вынесено решение по номинации Niantic Wayspot для/,
    type: EmailType.NOMINATION_DECIDED,
    status: [
      StatusQuery.wfDecided(
        "решило принять вашу номинацию Wayspot.",
        "решило отклонить вашу номинацию Wayspot.",
      ),
      StatusQuery.wfDecidedNia2(
        "Поздравляем, наша команда решила принять вашу номинацию Wayspot.",
        undefined, //'did not meet the criteria required to be accepted and has been rejected'
      ),
    ],
    image: [
      ImageQuery.wfDecidedNomination(
        /^Благодарим за то, что отправили номинацию Wayfarer (?<title>.*) (?<day>\d+)[. ](?<month>)[. ](?<year>\d+)( г)?!$/,
        [MONTHS.ZERO_PREFIXED, MONTHS.RUSSIAN],
      ),
      ImageQuery.wfDecidedNomination(
        /^Благодарим вас за то, что нашли время выдвинуть номинацию (?<title>.*) {2}(?<day>\d+) (?<month>) (?<year>\d+) г\./,
        [MONTHS.RUSSIAN],
      ),
    ],
  },

  //  ---------------------------------------- SWEDISH [sv] ----------------------------------------
  {
    // Nomination decided (Wayfarer)
    subject: /^Niantic Wayspot-nominering har beslutats om för/,
    type: EmailType.NOMINATION_DECIDED,
    status: [
      StatusQuery.wfDecided(
        "har beslutat att accepteradin Wayspot-nominering.",
        "har beslutat att inte acceptera din Wayspot-nominering.",
      ),
      StatusQuery.wfDecidedNia2(
        "Grattis, vårt team har beslutat att acceptera din Wayspot-nominering.",
        undefined, //'did not meet the criteria required to be accepted and has been rejected'
      ),
    ],
    image: [
      ImageQuery.wfDecidedNomination(
        /^Tack för din Wayspot-nominering (?<title>.*) den (?<year>\d+)-(?<month>)-(?<day>\d+)!$/,
        [MONTHS.SWEDISH],
      ),
      ImageQuery.wfDecidedNomination(
        /^Tack för din Wayspot-nominering (?<title>.*) den (?<day>\d+) (?<month>)\. (?<year>\d+)!$/,
        [MONTHS.SWEDISH],
      ),
      ImageQuery.wfDecidedNomination(
        /^Tack för att du tog dig tiden att nominera (?<title>.*) den (?<day>\d+) (?<month>)\. (?<year>\d+)\./,
        [MONTHS.SWEDISH],
      ),
    ],
  },
  {
    // Appeal decided
    subject: /^Din Niantic Wayspot-överklagan har beslutats om för/,
    type: EmailType.NOMINATION_APPEAL_DECIDED,
    status: [
      StatusQuery.wfAppealDecided(
        "Niantic har beslutat att din nominering ACCEPT ska/inte ska läggas till som en Wayspot",
        "Niantic har beslutat att din nominering REJECT ska/inte ska läggas till som en Wayspot",
      ),
    ],
    image: [
      ImageQuery.wfDecidedNomination(
        /^Tack för överklagan för din Wayspot-nominering för (?<title>.*) den (?<year>\d+)-(?<month>)-(?<day>\d+)\.$/,
        [MONTHS.SWEDISH],
      ),
      ImageQuery.wfDecidedNomination(
        /^Tack för överklagan för din Wayspot-nominering för (?<title>.*) den (?<day>\d+) (?<month>)\. (?<year>\d+)\.$/,
        [MONTHS.SWEDISH],
      ),
    ],
  },

  //  ---------------------------------------- TAMIL [ta] ----------------------------------------
  {
    // Nomination decided (Wayfarer)
    subject: /-க்கான Niantic Wayspot பணிந்துரை பரிசீலிக்கப்பட்டது.$/,
    type: EmailType.NOMINATION_DECIDED,
    status: [
      StatusQuery.wfDecided(
        "உங்கள் Wayspot பரிந்துரையை ஏற்றுக்கொள்வதாக முடிவு செய்திருக்கிறது",
        "உங்கள் Wayspot பரிந்துரையை நிராகரிப்பதாக முடிவு செய்திருக்கிறது",
      ),
      StatusQuery.wfDecidedNia(
        "did not meet the criteria required to be accepted and has been rejected", // Actually acceptance, bugged template
        undefined, //'did not meet the criteria required to be accepted and has been rejected'
      ),
    ],
    image: [
      ImageQuery.wfDecidedNomination(
        /^நாளது தேதியில் (?<month>) (?<day>\d+), (?<year>\d+), (?<title>.*) -க்கான Wayspot பரிந்துரைக்கு நன்றி!$/,
        [MONTHS.ENGLISH],
      ),
      ImageQuery.wfDecidedNomination(
        /^நாளது தேதியில் (?<day>\d+) (?<month>), (?<year>\d+), (?<title>.*) -க்கான Wayspot பரிந்துரைக்கு நன்றி!$/,
        [MONTHS.TAMIL],
      ),
      ImageQuery.wfDecidedNomination(
        /^Thank you for taking the time to nominate (?<title>.*) on (?<day>\d+) (?<month>), (?<year>\d+)\./,
        [MONTHS.TAMIL],
      ),
    ],
  },

  //  ---------------------------------------- TELUGU [te] ----------------------------------------
  {
    // Nomination decided (Wayfarer)
    subject: /కొరకు Niantic వేస్పాట్ నామినేషన్‌‌పై నిర్ణయం$/,
    type: EmailType.NOMINATION_DECIDED,
    status: [
      StatusQuery.wfDecided(
        "మీ వేస్పాట్ నామినేషన్‌ను అంగీకరించడానికి ఉండటానికి",
        undefined, //'has decided not to accept your Wayspot nomination.',
      ),
      StatusQuery.wfDecidedNia2(
        "శుభాకాంక్షలు, మీ Wayspot నామినేషన్‌ ఆమోదించాలని మా టీమ్ నిర్ణయించింది",
        undefined, //'did not meet the criteria required to be accepted and has been rejected'
      ),
    ],
    image: [
      ImageQuery.wfDecidedNomination(
        /^(?<month>) (?<day>\d+), (?<year>\d+) తేదీన మీరు అందించిన వేస్పాట్ నామినేషన్ (?<title>.*) ను బట్టి ధన్యవాదాలు!$/,
        [MONTHS.ENGLISH],
      ),
      ImageQuery.wfDecidedNomination(
        /^(?<day>\d+) (?<month>), (?<year>\d+) తేదీన మీరు అందించిన వేస్పాట్ నామినేషన్ (?<title>.*) ను బట్టి ధన్యవాదాలు!$/,
        [MONTHS.TELUGU],
      ),
      ImageQuery.wfDecidedNomination(
        /^నామినేట్ చేయడానికి సమయం వెచ్చించినందుకు ధన్యవాదాలు (?<title>.*) on (?<day>\d+) (?<month>), (?<year>\d+)\./,
        [MONTHS.TELUGU],
      ),
    ],
  },

  //  ---------------------------------------- THAI [th] ----------------------------------------
  {
    // Nomination decided (Wayfarer)
    subject: /^ผลการตัดสินการเสนอสถานที่ Niantic Wayspot สำหรับ/,
    type: EmailType.NOMINATION_DECIDED,
    status: [
      StatusQuery.wfDecided(
        "ชุมชนได้ตัดสินใจ ยอมรับ Wayspot ของคุณ",
        "ชุมชนได้ตัดสินใจ ไม่ยอมรับการ Wayspot ของคุณ",
      ),
      StatusQuery.wfDecidedNia2(
        "ขอแสดงความยินดีด้วย ทีมงานของเราได้ตัดสินใจยอมรับการเสนอ Wayspot ของคุณแล้ว",
        "ขออภัย ทีมงานของเราได้ตัดสินใจที่จะไม่ยอมรับการเสนอ Wayspot ของคุณ",
      ),
    ],
    image: [
      ImageQuery.wfDecidedNomination(
        /^ขอบคุณสำหรับการเสนอสถานที่ Wayspot ของคุณ เรื่อง (?<title>.*) เมื่อวันที่ (?<day>\d+) (?<month>) (?<year>\d+)!$/,
        [MONTHS.THAI],
      ),
      ImageQuery.wfDecidedNomination(
        /^ขอบคุณที่สละเวลาเสนอ (?<title>.*) ในวันที่ (?<day>\d+) (?<month>) (?<year>\d+)/,
        [MONTHS.THAI],
      ),
    ],
  },

  //  ---------------------------------------- CHINESE [zh] ----------------------------------------
  {
    // Nomination decided (Wayfarer)
    subject: /^社群已對 Niantic Wayspot 候選 .* 做出決定$/,
    type: EmailType.NOMINATION_DECIDED,
    status: [
      StatusQuery.wfDecided(
        "社群已決定 接受 Wayspot 候選地。",
        "社群已決定 不接受你的 Wayspot 候選地。",
      ),
      StatusQuery.wfDecidedNia2(
        "您的Wayspot提名地點已通過團隊審查，在此誠摯恭喜您！",
        undefined, //'did not meet the criteria required to be accepted and has been rejected'
      ),
    ],
    image: [
      ImageQuery.wfDecidedNomination(
        /^感謝你在 (?<year>\d+)-(?<month>)-(?<day>\d+) 提交 Wayspot 候選 (?<title>.*)！$/,
        [MONTHS.NUMERIC],
      ),
      ImageQuery.wfDecidedNomination(
        /^感謝你在 (?<year>\d+)年(?<month>)月(?<day>\d+)日 提交 Wayspot 候選 (?<title>.*)！$/,
        [MONTHS.NUMERIC],
      ),
      ImageQuery.wfDecidedNomination(
        /^感謝您於(?<year>\d+)年(?<month>)月(?<day>\d+)日提交提名地點：(?<title>.*)。 為了構築獨一無二的AR世界地圖，並且打造所有人都能身歷其境的冒險體驗，像您這樣的探索者是不可或缺的關鍵之一。/,
        [MONTHS.NUMERIC],
      ),
    ],
  },
];
