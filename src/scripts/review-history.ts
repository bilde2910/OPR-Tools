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
// <https://github.com/tehstone/wayfarer-addons/blob/main/LICENSE>
// If not, see <https://www.gnu.org/licenses/>.

import { register, UnixTimestampDateOnlyEditor } from "src/core";
import { awaitElement, downloadAsFile, filterObject, haversine, makeChildNode, readFile } from "src/utils";
import { AnyReview, AnySubmittedReview, BaseReview, EditReview, NewReview, PhotoReview } from "src/types";

import "./review-history.css";

export default () => {
  register({
    id: "review-history",
    name: "Review History IDB",
    authors: ["tehstone", "bilde2910"],
    description: "Add local review history storage to OPR",
    defaultConfig: {
      importAfter: 0,
      importAround: { // TODO: Configurable
        lat: 0,
        lng: 0,
      },
      importWithin: 0,
    },
    initialize: (toolbox, config) => {
      config.setUserEditable("importAfter", {
        label: "Import after date",
        help: "Any reviews in the import file prior to the selected date will not be imported.",
        editor: new UnixTimestampDateOnlyEditor(),
      });

      const handleIncomingReview = (review: AnyReview) => new Promise<void>((resolve, reject) => {
        toolbox.log("handleIncomingReview");
        let saveColumns = <(
          keyof NewReview | keyof EditReview | keyof PhotoReview
        )[]>[];
        const common = <(keyof BaseReview)[]>["type", "id", "title", "description", "lat", "lng"];
        switch (review.type) {
          case "NEW":
            saveColumns = <(keyof NewReview)[]>[...common, "imageUrl", "statement", "supportingImageUrl"];
            break;
          case "EDIT":
            saveColumns = <(keyof EditReview)[]>[...common, "descriptionEdits", "titleEdits", "locationEdits"];
            break;
          case "PHOTO":
            saveColumns = <(keyof PhotoReview)[]>[...common, "newPhotos"];
            break;
        }
        if (saveColumns.length > 0) {
          const saveData = { ...filterObject(review, saveColumns), ts: Date.now(), review: null };
          toolbox.usingIDB("history").then(({ db, transaction, getStore }) => {
            const tx = transaction("readwrite");
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = reject;
            const objectStore = getStore(tx);
            objectStore.put(saveData);
            tx.commit();
          }).catch(reject);
        } else {
          reject("Unknown review type: " + review.type);
        }
      });

      const handleSubmittedReview = (review: AnySubmittedReview, result: string) => new Promise<void>((resolve, reject) => {
        toolbox.log("handleSubmittedReview");
        if (result === "api.review.post.accepted" && !!review.id) {
          toolbox.usingIDB("history").then(({ db, transaction, getStore }) => {
            const tx = transaction("readwrite");
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = reject;
            const objectStore = getStore(tx);
            const getReview = objectStore.get(review.id);
            getReview.onsuccess = () => {
              const { result } = getReview;
              objectStore.put({ ...result, review });
              tx.commit();
            };
            getReview.onerror = reject;
          }).catch(reject);
        }
      });

      const addRHButtons = async () => {
        const ref = await awaitElement(() => document.querySelector("wf-rating-bar"));
        const outer = makeChildNode(ref.parentElement!, "div");
        outer.classList.add("oprrh-idb");

        makeChildNode(outer, "p", "Review history:");
        makeChildNode(outer, "button", "Export")
          .addEventListener("click", async () => {
            const { db, transaction, getStore } = await toolbox.usingIDB("history");
            const tx = transaction("readonly");
            tx.oncomplete = () => db.close();
            const objectStore = getStore(tx);
            const getAllReviews = objectStore.getAll();
            getAllReviews.onsuccess = () => {
              const { result } = getAllReviews;
              downloadAsFile(
                JSON.stringify(result),
                "application/json",
                `reviewHistory-${toolbox.userHash}.json`
              );
            };
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
            const { db, transaction, getStore } = await toolbox.usingIDB("history");
            const tx = transaction("readwrite");
            const objectStore = getStore(tx);
            objectStore.clear();
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
                          objectStore.put(review);
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
                    objectStore.put(review);
                    imported++;
                  } else {
                    filtered++;
                  }
                }
                if (!found) {
                  failed++;
                }
              }
            } catch (error) {
              tx.abort();
              db.close();
              alert(`Failed to import data with error:\n${error}`);
              location.reload();
              return;
            }

            tx.commit();
            let alertText = `Cleared all saved review history.\nImported ${imported} review history item(s).`;
            if (filtered > 0) alertText += `\nFiltered ${filtered} item(s) from import.`;
            if (failed > 0) alertText += `\nFailed to import ${failed} item(s).`;
            db.close();
            alert(alertText);
            location.reload();
          });

        makeChildNode(outer, "button", "Clear")
          .addEventListener("click", async () => {
            if (confirm("Are you sure you want to clear your review history?")) {
              const { db, transaction, getStore } = await toolbox.usingIDB("history");
              const tx = transaction("readwrite");
              tx.oncomplete = () => db.close();
              const objectStore = getStore(tx);
              const clearReviewHistory = objectStore.clear();
              clearReviewHistory.onsuccess = () => {
                alert("Cleared all saved review history.");
                location.reload();
              };
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
      toolbox.interceptOpenJson("GET", "/api/v1/vault/profile", addRHButtons);
      toolbox.interceptSendJson("/api/v1/vault/review", handleSubmittedReview);
    }
  });
};
