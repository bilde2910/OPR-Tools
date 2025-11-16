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
import { filterObject, iterObject, unilTruthy, indexToMap, makeChildNode, toUtcIsoDate } from "src/utils";
import { AnyContribution, ContributionStatus, ContributionType, OriginalPoiData, SubmissionsResult } from "src/types";

import "./nomination-status-history.css";

const FILTER_COLUMNS = ["id", "type", "day", "upgraded", "status", "isNianticControlled", "canAppeal", "isClosed", "canHold", "canReleaseHold"] as const;

// If this changes, also update the CSS declaration
const CONTRIB_DATE_SELECTOR = "app-submissions app-details-pane app-submission-tag-set + span";

// Right triangle needs a VS15 variant selector (U+FE0E) to avoid being rendered as an emoji
// https://en.wikipedia.org/wiki/Geometric_Shapes_(Unicode_block)#Emoji
const RIGHT_TRIANGLE = "\uFE0E\u25B6";
const DOWN_TRIANGLE = "\u25BC";

type HistoryEntryStatus = ContributionStatus | "UPGRADE"

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

type StatusHistoryEntry = {
  timestamp: number,
  status: HistoryEntryStatus,
  verified?: boolean,
}

type FilteredContribution = Pick<AnyContribution, typeof FILTER_COLUMNS[number]>
type StoredContribution = FilteredContribution & {
  poiData?: OriginalPoiData,
  statusHistory: StatusHistoryEntry[],
}

interface IdbStores {
  history: StoredContribution,
}

export default () => {
  register<IdbStores>()({
    id: "nomination-status-history",
    name: "Nomination Status History",
    authors: ["tehstone", "bilde2910", "Tntnnbltn"],
    description: "Track changes to contribution status, and receive alerts when a contribution has changed status.",
    defaultConfig: {},
    sessionData: {},
    initialize: (toolbox, _config) => {
      let ready = false;

      const handleNominations = async (result: SubmissionsResult) => {
        await checkNominationChanges(result.submissions);
        // TODO: Email API
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
              const idb = await toolbox.openIDB("history", "readonly");
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

        // TODO: Email API
        // if email:
        // else:
        line.appendChild(document.createTextNode(statusText));
        // endif
        if (current.verified) line.classList.add("oprnsh-verified");
        const expandedBox = box.querySelector(".oprnsh-expanded")!;
        expandedBox.appendChild(line);
      };

      const checkNominationChanges = async (submissions: AnyContribution[]) => {
        const start = Date.now();
        const idb = await toolbox.openIDB("history", "readwrite");
        idb.on("complete", () => {
          console.log(`Contribution changes processed in ${Date.now() - start} msec.`);
          ready = true;
        });
        const saved = await idb.getAll();
        const savedMap = indexToMap(saved, "id");
        if (submissions.length < saved.length) {
          toolbox.notify({
            color: "red",
            message: `${saved.length - submissions.length} of ${saved.length} contributions are missing!`
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
                  icon: createNotificationIcon(nom.type)
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
        const idb = await toolbox.openIDB("history", "readwrite");
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
    }
  });
};
