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

import { register, UnixTimestampDateOnlyEditor } from "src/core";
import { awaitElement, downloadAsFile, filterObject, haversine, makeChildNode, readFile } from "src/utils";
import { AnyReview, AnySubmittedReview, EditReview, NewReview, PhotoReview, SubmittedEditReview, SubmittedNewReview, SubmittedPhotoReview } from "src/types";

import "./review-history.css";

type BaseColumns = "type" | "id" | "title" | "description" | "lat" | "lng"
type NewColumns = BaseColumns | "imageUrl" | "statement" | "supportingImageUrl"
type EditColumns = BaseColumns | "descriptionEdits" | "titleEdits" | "locationEdits"
type PhotoColumns = BaseColumns | "newPhotos"

const BASE_COLUMNS: BaseColumns[] = ["type", "id", "title", "description", "lat", "lng"];
const NEW_COLUMNS: NewColumns[] = [...BASE_COLUMNS, "imageUrl", "statement", "supportingImageUrl"];
const EDIT_COLUMNS: EditColumns[] = [...BASE_COLUMNS, "descriptionEdits", "titleEdits", "locationEdits"];
const PHOTO_COLUMNS: PhotoColumns[] = [...BASE_COLUMNS, "newPhotos"];

type FilteredNewReview = Pick<NewReview, NewColumns>
type StoredNewReview = FilteredNewReview &
  { review: SubmittedNewReview | null, ts: number }

type FilteredEditReview = Pick<EditReview, EditColumns>
type StoredEditReview = FilteredEditReview &
  { review: SubmittedEditReview | null, ts: number }

type FilteredPhotoReview = Pick<PhotoReview, PhotoColumns>
type StoredPhotoReview = FilteredPhotoReview &
  { review: SubmittedPhotoReview | null, ts: number }

type FilteredReview = FilteredNewReview | FilteredEditReview | FilteredPhotoReview
type StoredReview = StoredNewReview | StoredEditReview | StoredPhotoReview

const DEFAULT_CONFIG = {
  importAfter: 0,
  importAround: { // TODO: Configurable
    lat: 0,
    lng: 0,
  },
  importWithin: 0,
};

interface IdbStores {
  history: StoredReview,
}

export default () => {
  register<typeof DEFAULT_CONFIG, IdbStores>({
    id: "review-history",
    name: "Review History",
    authors: ["tehstone", "bilde2910"],
    description: "Add local review history storage to OPR",
    defaultConfig: DEFAULT_CONFIG,
    initialize: (toolbox, config) => {
      config.setUserEditable("importAfter", {
        label: "Import after date",
        help: "Any reviews in the import file prior to the selected date will not be imported.",
        editor: new UnixTimestampDateOnlyEditor(),
      });

      const handleIncomingReview = async (review: AnyReview) => {
        toolbox.log("handleIncomingReview");
        let filtered: FilteredReview | null = null;
        switch (review.type) {
          case "NEW":
            filtered = filterObject(review, NEW_COLUMNS);
            break;
          case "EDIT":
            filtered = filterObject(review, EDIT_COLUMNS);
            break;
          case "PHOTO":
            filtered = filterObject(review, PHOTO_COLUMNS);
            break;
        }
        if (filtered !== null) {
          const saveData: StoredReview = { ...filtered, ts: Date.now(), review: null };
          const idb = await toolbox.openIDB("history", "readwrite");
          idb.put(saveData);
          idb.commit();
        } else {
          toolbox.error("Unknown review type: " + review.type);
        }
      };

      const handleSubmittedReview = async (review: AnySubmittedReview, result: string) => {
        toolbox.log("handleSubmittedReview");
        if (result === "api.review.post.accepted" && !!review.id) {
          const idb = await toolbox.openIDB("history", "readwrite");
          const assigned = await idb.get(review.id);
          if (assigned.type === "NEW" && review.type === "NEW") {
            idb.put({ ...assigned, review });
          } else if (assigned.type === "EDIT" && review.type === "EDIT") {
            idb.put({ ...assigned, review });
          } else if (assigned.type === "PHOTO" && review.type === "PHOTO") {
            idb.put({ ...assigned, review });
          } else {
            idb.commit();
            const msg = `Attempted to submit a ${review.type} review for a ${assigned.type} assignment`;
            toolbox.warn();
            toolbox.warn("Submitted review:", review);
            toolbox.warn("Assigned review:", assigned);
            alert(`${msg}. This should not be possbile. Please see the developer console for more details.`);
            return;
          }
          idb.commit();
        }
      };

      const handleProfile = () => {
        addRHButtons();
      };

      const addRHButtons = async () => {
        const ref = await awaitElement(() => document.querySelector("wf-rating-bar"));
        const outer = makeChildNode(ref.parentElement!, "div");
        outer.classList.add("oprrh-idb");

        makeChildNode(outer, "p", "Review history:");
        makeChildNode(outer, "button", "Export")
          .addEventListener("click", async () => {
            const idb = await toolbox.openIDB("history", "readonly");
            const result = await idb.getAll();
            downloadAsFile(
              JSON.stringify(result),
              "application/json",
              `reviewHistory-${toolbox.userHash}.json`
            );
          });

        makeChildNode(outer, "button", "Import")
          .addEventListener("click", async () => {
            if (!confirm(
              "Importing will overwrite all currently stored data, " +
              "are you sure you want to clear your currently saved review history?"
            )) return;
            const contents = await readFile(".json", "application/json");
            if (typeof contents !== "string") {
              throw new Error("Invalid file type.");
            }
            const jsonData = JSON.parse(contents);
            const toStore: StoredReview[] = [];

            let imported = 0, failed = 0, filtered = 0;
            try {
              for (const review of jsonData) {
                let found = false;
                if (!("id" in review)) {
                  if ("review" in review) {
                    if (review.review !== false && review.review != "skipped") {
                      if ("id" in review.review) {
                        review.id = review.review.id;
                        found = true;
                        if (applyFilters(review)) {
                          toStore.push(review);
                          imported++;
                        } else {
                          filtered++;
                        }
                      }
                    }
                  }
                } else {
                  found = true;
                  if (applyFilters(review)) {
                    toStore.push(review);
                    imported++;
                  } else {
                    filtered++;
                  }
                }
                if (!found) {
                  failed++;
                }
              }
              const idb = await toolbox.openIDB("history", "readwrite");
              idb.clear();
              idb.put(...toStore);
              idb.commit();
            } catch (error) {
              alert(`Failed to import data with error:\n${error}`);
              location.reload();
              return;
            }

            let alertText = `Cleared all saved review history.\nImported ${imported} review history item(s).`;
            if (filtered > 0) alertText += `\nFiltered ${filtered} item(s) from import.`;
            if (failed > 0) alertText += `\nFailed to import ${failed} item(s).`;
            alert(alertText);
            location.reload();
          });

        makeChildNode(outer, "button", "Clear")
          .addEventListener("click", async () => {
            if (confirm("Are you sure you want to clear your review history?")) {
              const idb = await toolbox.openIDB("history", "readwrite");
              await idb.clear();
              alert("Cleared all saved review history.");
              location.reload();
            }
          });
      };

      const applyFilters = (review: any) => {
        const dateAfter = config.get("importAfter");
        if (dateAfter !== 0 && review.ts < dateAfter) {
          return false;
        }

        const { lat, lng } = config.get("importAround");
        const range = config.get("importWithin");
        if (!(lat === 0 && lng === 0) && range !== 0) {
          const reviewDistance = haversine(lat, lng, review["lat"], review["lng"]);
          if (reviewDistance > range * 1000) {
            return false;
          }
        }

        return true;
      };

      toolbox.interceptOpenJson("GET", "/api/v1/vault/review", handleIncomingReview);
      toolbox.interceptOpenJson("GET", "/api/v1/vault/profile", handleProfile);
      toolbox.interceptSendJson("/api/v1/vault/review", handleSubmittedReview);
    }
  });
};
