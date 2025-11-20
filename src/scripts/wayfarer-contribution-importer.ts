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

import { register, UnixTimestampDateOnlyEditor } from "src/core";
import { filterObject, iterKeys, readFile } from "src/utils";
import { AnyContribution, ContributionStatus, ContributionType, Nomination, OriginalPoiState, SubmissionsResult, SubmitAppeal } from "src/types";

import WayfarerLogo from "../../assets/wayfarer-logo.png";

import "./wayfarer-contribution-importer.css";

interface IdbStores {
  contributions: any,
}

let cache: AnyContribution[] = [];
let oprOriginatingIDs: Set<string> | null = null;

export default () => {
  register<IdbStores, void>()({
    id: "wayfarer-contribution-importer",
    name: "Wayfarer Contribution Importer",
    authors: ["bilde2910"],
    description: "Allows importing contributions exported from Wayfarer, adding them back into the contributions list in OPR",
    defaultConfig: {
      submittedBeforeDate: 1747958400000, // 2025-05-23
    },
    sessionData: {},
    initialize: (toolbox, logger, config) => {
      config.setUserEditable("submittedBeforeDate", {
        label: "Ignore any contributions after",
        help: "Set this option to not inject Wayfarer contributions submitted after this date. The default date is 2025-05-23, which is the date of the last sync before the Niantic/Scopely split.",
        editor: new UnixTimestampDateOnlyEditor(),
      });

      const importWayfarerContributions = async () => {
        const file = await readFile("application/json", "*.json");
        const importedSubs = JSON.parse(await file.text());
        if (!Array.isArray(importedSubs)) {
          alert("Import failed: Not a list of contributions!");
          return;
        }
        {
          using idb = await toolbox.openIDB("contributions", "readwrite");
          await idb.clear();
          for (const sub of importedSubs) {
            if (typeof sub["id"] === "string") {
              idb.put(sub);
            } else {
              logger.error("Cannot import contribution because it has no valid ID", sub);
            }
          }
          idb.commit();
        }
        cache = transformWfSubs(importedSubs);
        alert(`Successfully imported ${cache.length} contributions!`);
      };

      const populateCache = async () => {
        using idb = await toolbox.openIDB("contributions", "readonly");
        cache = transformWfSubs(await idb.getAll());
      };

      const migrateWfToOpr = (sub: any) => {
        // Wayfarer has migrated to multiple supporting URLs
        if (!("supportingImageUrl" in sub) && "supportingImageUrls" in sub) {
          sub.supportingImageUrl = sub.supportingImageUrls[0] ?? "";
        }
        return sub;
      };

      const validateObject = (ref: any, val: any, k?: string) => {
        if (typeof val !== typeof ref) {
          logger.error(
            `Incompatible types on property ${k}; ` +
            `expected ${typeof ref}, ` +
            `found ${typeof val}`,
          );
          return false;
        }
        if (typeof val === "object") {
          if (Array.isArray(val) !== Array.isArray(ref)) {
            logger.error(
              `Incompatible object type on property ${k}, ` +
              `expected ${Array.isArray(ref) ? "array" : "object"}, ` +
              `found ${Array.isArray(val) ? "array" : "object"}`,
            );
            return false;
          }
          if (Array.isArray(val)) {
            for (let i = 0; i < val.length; i++) {
              if (!validateObject(ref[0], val[i], `${k ?? ""}[${i}]`)) return false;
            }
          } else {
            for (const kRef of iterKeys(ref)) {
              if (!(kRef in val) || typeof val[kRef] === "undefined") {
                logger.error(`Missing property ${kRef} on object`);
                return false;
              }
            }
            for (const kVal of iterKeys(val)) {
              if (!(kVal in ref) || typeof ref[kVal] === "undefined") {
                logger.error(`Extraneous property ${kVal} on object`);
                return false;
              }
            }
            for (const vk of iterKeys(val)) {
              if (!validateObject(ref[vk], val[vk], k ? `${k}.${vk}` : vk)) return false;
            }
          }
        }
        return true;
      };

      const validateAsOprCompatible = (sub: any): AnyContribution | undefined => {
        if (!("type" in sub) || !(sub.type in MODEL)) {
          logger.error("Invalid contribution (invalid type)", sub);
          return;
        }
        const model = MODEL[sub.type as keyof typeof MODEL];
        const f = filterObject(sub, iterKeys(model));
        if (!validateObject(model, f)) return;
        return f;
      };

      const flagAsUneditable = (sub: AnyContribution) => {
        sub.canAppeal = false;
        sub.canHold = false;
        sub.canReleaseHold = false;
        sub.isMutable = false;
        return sub;
      };

      const transformWfSubs = (subs: any[]) =>
        subs
          .map(sub => migrateWfToOpr(sub))
          .map(sub => validateAsOprCompatible(sub))
          .filter(sub => typeof sub !== "undefined")
          .map(sub => flagAsUneditable(sub));
        /*.filter(sub => [
            ContributionStatus.ACCEPTED,
            ContributionStatus.REJECTED,
            ContributionStatus.DUPLICATE,
            ContributionStatus.WITHDRAWN,
          ].includes(sub.status));*/

      const mergeContributions = (orig: AnyContribution[], insert: AnyContribution[]) => {
        orig.sort((a, b) => a.order - b.order);
        insert.sort((a, b) => a.order - b.order);
        let order = 0;
        const merged: AnyContribution[] = [];
        let i = 0;
        let j = 0;
        while (i < orig.length) {
          while (j < insert.length && insert[j].id !== orig[i].id && new Date(insert[j].day) <= new Date(orig[i].day)) {
            if (new Date(insert[j].day).getTime() <= config.get("submittedBeforeDate")) {
              merged.push({
                ...insert[j++],
                order: order++,
              });
            } else {
              j++;
            }
          }
          if (j < insert.length && insert[j].id === orig[i].id) j++;
          merged.push({
            ...orig[i++],
            order: order++,
          });
        }
        while (j < insert.length) {
          if (new Date(insert[j].day).getTime() <= config.get("submittedBeforeDate")) {
            merged.push({
              ...insert[j++],
              order: order++,
            });
          } else {
            j++;
          }
        }
        return merged;
      };

      const handleContributions = (fromOpr: SubmissionsResult) => {
        oprOriginatingIDs = new Set(fromOpr.submissions.map(v => v.id));
        return {
          submissions: mergeContributions(fromOpr.submissions, cache),
        };
      };

      const filterActions = (sent: { id: string }) => {
        return oprOriginatingIDs !== null && oprOriginatingIDs.has(sent.id);
      };

      void populateCache();

      toolbox.addImporter({
        title: "Import Wayfarer contributions",
        description: "Import a nominations.json file exported from Wayfarer Tools",
        callback: importWayfarerContributions,
        icon: WayfarerLogo,
      });

      toolbox.manipulateOpenJson("GET", "/api/v1/vault/manage", handleContributions);
      toolbox.filterSendJson("POST", "/api/v1/vault/manage/appeal", filterActions);
      toolbox.filterSendJson("POST", "/api/v1/vault/manage/edit", filterActions);
      toolbox.filterSendJson("POST", "/api/v1/vault/manage/hold", filterActions);
      toolbox.filterSendJson("POST", "/api/v1/vault/manage/releasehold", filterActions);
      toolbox.filterSendJson("POST", "/api/v1/vault/manage/detail", filterActions);
    },
  });
};

const NOMINATION_MODEL: Nomination = {
  type: ContributionType.NOMINATION,
  poiData: [],
  id: "",
  title: "",
  description: "",
  lat: 0,
  lng: 0,
  city: "",
  state: "",
  day: "",
  order: 0,
  imageUrl: "",
  upgraded: false,
  status: ContributionStatus.ACCEPTED,
  isMutable: false,
  isNianticControlled: false,
  statement: "",
  supportingImageUrl: "",
  rejectReasons: [{
    reason: "",
  }],
  canAppeal: false,
  appealResolved: false,
  isClosed: false,
  appealNotes: "",
  userAppealNotes: "",
  canHold: false,
  canReleaseHold: false,
};

const EDIT_MODEL = {
  poiData: {
    id: "",
    imageUrl: "",
    title: "",
    description: "",
    lat: 0,
    lng: 0,
    city: "",
    state: OriginalPoiState.LIVE,
    lastUpdateDate: "",
  },
  id: "",
  title: "",
  description: "",
  lat: 0,
  lng: 0,
  city: "",
  state: "",
  day: "",
  order: 0,
  imageUrl: "",
  upgraded: false,
  status: ContributionStatus.ACCEPTED,
  isMutable: false,
  isNianticControlled: false,
  statement: "",
  supportingImageUrl: "",
  rejectReasons: [{
    reason: "",
  }],
  canAppeal: false,
  appealResolved: false,
  isClosed: false,
  appealNotes: "",
  userAppealNotes: "",
  canHold: false,
  canReleaseHold: false,
};

const EDIT_LOCATION_MODEL =
  Object.assign(
    {...EDIT_MODEL},
    <{type: ContributionType.EDIT_LOCATION}>
     {type: ContributionType.EDIT_LOCATION},
  );

const EDIT_TITLE_MODEL =
  Object.assign(
    {...EDIT_MODEL},
    <{type: ContributionType.EDIT_TITLE}>
     {type: ContributionType.EDIT_TITLE},
  );

const EDIT_DESCRIPTION_MODEL =
  Object.assign(
    {...EDIT_MODEL},
    <{type: ContributionType.EDIT_DESCRIPTION}>
     {type: ContributionType.EDIT_DESCRIPTION},
  );

const PHOTO_MODEL =
  Object.assign(
    {...EDIT_MODEL},
    <{type: ContributionType.PHOTO}>
     {type: ContributionType.PHOTO},
  );

type ContributionModel = {
  [P in ContributionType]: { type: P } & AnyContribution
};

const MODEL: ContributionModel = {
  [ContributionType.NOMINATION]: NOMINATION_MODEL,
  [ContributionType.EDIT_LOCATION]: EDIT_LOCATION_MODEL,
  [ContributionType.EDIT_DESCRIPTION]: EDIT_DESCRIPTION_MODEL,
  [ContributionType.EDIT_TITLE]: EDIT_TITLE_MODEL,
  [ContributionType.PHOTO]: PHOTO_MODEL,
};
