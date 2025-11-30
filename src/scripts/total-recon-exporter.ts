// Copyright 2025 bilde2910
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

import { register, SelectBoxEditor, TextInputEditor } from "src/core";
import { deepEquals, filterObject, haversine, iterObject, sleep } from "src/utils";
import { AnyContribution, ContributionStatus, ContributionType, EditContribution, Nomination, SubmissionsResult } from "src/types";

import "./total-recon-exporter.css";

import LoadingWheel from "../../assets/loading.svg";

const COLUMNS = [
  "id",
  "title",
  "description",
  "lat",
  "lng",
  "status",
  "nickname",
  "submitteddate",
  "responsedate",
  "candidateimageurl",
] as const;

type RawTotalReconEntry = Record<typeof COLUMNS[number], string>;
interface ParsedTotalReconEntry extends Omit<RawTotalReconEntry, "lat" | "lng"> {
  lat: number,
  lng: number,
}

const NOMINATION_STATUS_MAP: Record<ContributionStatus, string> = {
  [ContributionStatus.ACCEPTED]: "accepted",
  [ContributionStatus.APPEALED]: "appealed",
  [ContributionStatus.DUPLICATE]: "rejected",
  [ContributionStatus.HELD]: "held",
  [ContributionStatus.NIANTIC_REVIEW]: "voting",
  [ContributionStatus.NOMINATED]: "submitted",
  [ContributionStatus.REJECTED]: "rejected",
  [ContributionStatus.VOTING]: "voting",
  [ContributionStatus.WITHDRAWN]: "rejected",
};

interface EntryUpdate {
  entry: ParsedTotalReconEntry,
  contribution: AnyContribution,
  update: boolean,
}

export default () => {
  register()({
    id: "total-recon-exporter",
    name: "Total Recon Exporter",
    authors: ["bilde2910"],
    description: "Automatically send and update data stored in a Total Recon spreadsheet",
    defaultConfig: {
      totalReconUrl: "",
      acceptedStatus: "accepted" as "accepted" | "delete",
    },
    sessionData: {},
    initialize: (toolbox, logger, config) => {
      config.setUserEditable("totalReconUrl", {
        label: "Apps Script URL",
        help: "The Total Recon script execution URL that you also use in IITC",
        editor: new TextInputEditor({
          placeholder: "https://script.google.com/macros/s/.../exec",
        }),
      });

      config.setUserEditable("acceptedStatus", {
        label: "When a contribution is accepted",
        editor: new SelectBoxEditor({
          "accepted": "Mark it as accepted",
          "delete": "Delete it (requires Total Recon v2/WayFarer Planner)",
        }),
      });

      const handleNominations = async (result: SubmissionsResult) => {
        NOMINATION_STATUS_MAP[ContributionStatus.ACCEPTED] = config.get("acceptedStatus");
        const url = config.get("totalReconUrl");
        if (url === "") {
          toolbox.notify({
            color: "red",
            message:
              "Total Recon Exporter is not configured and will not work yet. " +
              "Please enter your script URL in the settings page to enable the exporter.",
          });
        } else {
          const notification = toolbox.notify({
            color: "dark-gray",
            message: "Synchronizing Total Recon data...",
            icon: LoadingWheel,
            dismissable: false,
          });
          const start = Date.now();
          try {
            const trData = await getSheetData(url);
            const updates = checkUpdates(result.submissions, trData);
            if (updates.length > 0) {
              let successes = 0;
              for (let i = 0; i < updates.length; i++) {
                logger.info(
                  `Sending entry ${updates[i].entry.id} ` +
                  `(${updates[i].update ? "updated" : "new"} entry matching ` +
                  `${updates[i].contribution.title} to ${updates[i].entry.title})...`,
                  updates[i],
                );
                notification.updateContents(`Sending ${i + 1}/${updates.length} updates to Total Recon...`);
                successes += await sendSheetData(url, updates[i].entry) ? 1 : 0;
              }
              const stop = Date.now();
              toolbox.notify({
                color: "green",
                message: `Successfully sent ${successes} of ${updates.length} updates to Total Recon in ${(stop - start) / 1000} seconds!`,
              });
            }
          } catch (ex) {
            logger.error(ex);
            if (ex instanceof Error) {
              toolbox.notify({
                color: "red",
                message: `Error occurred when processing Total Recon data: ${ex.message}`,
              });
            }
          } finally {
            notification.dismiss();
          }
        }
      };

      const getSheetData = async (url: string) => {
        const resp = await fetch(url);
        const data = await resp.json();
        if (Array.isArray(data)) {
          return data.map(e => (<ParsedTotalReconEntry>{
            ...filterObject(e, COLUMNS),
            lat: parseFloat(e.lat),
            lng: parseFloat(e.lng),
          }));
        } else {
          throw new Error(JSON.stringify(data));
        }
      };

      const sendSheetData = async (url: string, entry: ParsedTotalReconEntry, retries = 3): Promise<boolean> => {
        // Expects FormData, not JSON, ref.:
        // https://github.com/Wintervorst/iitc/blob/master/plugins/totalrecon/totalrecon.user.js#L453
        const data = new FormData();
        for (const [k, v] of iterObject(entry)) {
          data.append(k, v.toString());
        }
        try {
          const resp = await fetch(url, {
            method: "POST",
            body: data,
          });
          if (!resp.ok) {
            throw Error(`Response status: ${resp.status}`);
          }
          return true;
        } catch (ex) {
          retries--;
          if (retries > 0) {
            logger.warn(`Failed to send entry ${entry.id}, retrying ${retries} more time(s)...`, ex);
            await sleep(30000);
            return await sendSheetData(url, entry, retries);
          } else {
            logger.error(`Failed to send entry ${entry.id}, giving up.`);
            return false;
          }
        }
      };

      const checkUpdates = (oprData: AnyContribution[], trData: ParsedTotalReconEntry[]) => {
        const updates: EntryUpdate[] = [];
        const nominations = oprData.filter(n => n.type === ContributionType.NOMINATION);
        for (const nomination of nominations) {
          let entry = findExactMatch(nomination, trData);
          if (typeof entry !== "undefined") {
            // Exact match - update status
            const expected = buildEntry(nomination, entry);
            if (!deepEquals(entry, expected)) {
              updates.push({
                entry: expected,
                contribution: nomination,
                update: true,
              });
            }
          } else if (!hasResolved(nomination)) {
            entry = findNearbyMatch(nomination, trData);
            // Nearby match - add new entry
            const newEntry = buildEntry(nomination, entry);
            updates.push({
              entry: newEntry,
              contribution: nomination,
              update: false,
            });
          }
        }
        return updates;
      };

      const buildEntry = (nomination: Nomination, extend?: ParsedTotalReconEntry): ParsedTotalReconEntry => ({
        id: extend?.id ?? nomination.id,
        title: nomination.title,
        description: nomination.description,
        lat: nomination.lat,
        lng: nomination.lng,
        status: NOMINATION_STATUS_MAP[nomination.status],
        nickname: toolbox.username,
        submitteddate: nomination.day,
        responsedate: extend?.responsedate ?? "",
        candidateimageurl: nomination.imageUrl,
      });

      const findExactMatch = (nom: Nomination | EditContribution<ContributionType.EDIT_LOCATION>, trData: ParsedTotalReconEntry[]) => {
        if (nom.type === ContributionType.NOMINATION) {
          for (const trEntry of trData) {
            if (trEntry.candidateimageurl === nom.imageUrl) {
              return trEntry;
            }
          }
        }
      };

      const findNearbyMatch = (nom: Nomination | EditContribution<ContributionType.EDIT_LOCATION>, trData: ParsedTotalReconEntry[]) => {
        let relevant = trData
          // Remove already matched entries
          .filter(n => n.candidateimageurl.trim().length === 0)
          // Remove wayspots not within a ballpark distance (~1km lat, lng varies)
          .filter(n => Math.abs(nom.lat - n.lat) < 0.01 && Math.abs(nom.lng - n.lng) < 0.01);

        // Filter away mismatching entry types
        if (nom.type === ContributionType.NOMINATION) {
          relevant = relevant.filter(n => n.status !== "potentialedit" && n.status !== "sentedit");
        } else if (nom.type === ContributionType.EDIT_LOCATION) {
          relevant = relevant.filter(n => n.status === "potentialedit" || n.status === "sentedit");
        }
        // Sort by shortest distance
        relevant.sort((a, b) => haversine(nom.lat, nom.lng, a.lat, a.lng) - haversine(nom.lat, nom.lng, b.lat, b.lng));
        // Grab the closest one if it's within 20 meter
        if (relevant.length > 0) {
          const cand = relevant[0];
          if (haversine(nom.lat, nom.lng, cand.lat, cand.lng) <= 20) {
            return cand;
          }
        }
      };

      toolbox.interceptOpenJson("GET", "/api/v1/vault/manage", handleNominations);
    },
  });
};

const hasResolved = (contribution: AnyContribution) =>
  [
    ContributionStatus.ACCEPTED,
    ContributionStatus.REJECTED,
    ContributionStatus.DUPLICATE,
    ContributionStatus.WITHDRAWN,
  ].includes(contribution.status);
