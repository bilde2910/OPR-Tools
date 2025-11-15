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
import { awaitElement, downloadAsFile, filterObject, haversine, isDarkMode, makeChildNode, readFile } from "src/utils";
import { AnyReview, AnySubmittedReview, EditReview, NewReview, PhotoReview, SubmittedEditReview, SubmittedNewReview, SubmittedPhotoReview } from "src/types";

import agGrid from "ag-grid-community";

import "./review-history.css";

const REJECTION_MAP: Record<string, string> = {
  PHOTO_BAD_BLURRY: "Blurry Photo",
  PHOTO_FACE: "Face or body parts",
  PHOTO_PLATE: "License plate",
  PHOTO_DIR: "Orientation",
  PHOTO_TAG: "Submitter identifiable",
  PHOTO_3P: "Third party photo",
  PHOTO_WATERMARK: "Watermark",
  PHOTO_BAD: "Low quality or inaccurate photo",
  EMOJI_TITLE: "Emoji or emoticon",
  MARKUP_TITLE: "URL or markup",
  TEXT_BAD_TITLE: "Low quality or inaccurate title",
  EMOJI_DESCRIPTION: "Emoji or emoticon in description",
  MARKUP_DESCRIPTION: "URL or markup in description",
  TEXT_BAD_DESCRIPTION: "Low quality or inaccurate description",
  ACCURACY_FAKE: "Fake nomination",
  ACCURACY_EXPLICIT: "Explicit Content",
  ACCURACY_PERSONAL: "Influencing Reviewers",
  ACCURACY_OFFENSIVE: "Offensive",
  ACCURACY_ABUSE: "Other abuse-related reasons",
  MISMATCH: "Inaccurate Location",
  PRIVATE: "Private property",
  INAPPROPRIATE: "Adult location",
  SCHOOL: "Schools",
  SENSITIVE: "Sensitive location",
  EMERGENCY: "Obstructs emergency operations",
  GENERIC: "Generic business",
  "": "(Blank)"
};

const FLOW_CHANGE_TIME = 1698674400000;

const BASE_COLUMNS = ["type", "id", "title", "description", "lat", "lng"] as const;
const NEW_COLUMNS = [...BASE_COLUMNS, "imageUrl", "statement", "supportingImageUrl"] as const;
const EDIT_COLUMNS = [...BASE_COLUMNS, "descriptionEdits", "titleEdits", "locationEdits"] as const;
const PHOTO_COLUMNS = [...BASE_COLUMNS, "newPhotos"] as const;

type FilteredNewReview = Pick<NewReview, typeof NEW_COLUMNS[number]>
type StoredNewReview = FilteredNewReview &
  { review: SubmittedNewReview | null, ts: number }

type FilteredEditReview = Pick<EditReview, typeof EDIT_COLUMNS[number]>
type StoredEditReview = FilteredEditReview &
  { review: SubmittedEditReview | null, ts: number }

type FilteredPhotoReview = Pick<PhotoReview, typeof PHOTO_COLUMNS[number]>
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
        renderReviewHistory();
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

      const renderReviewHistory = async () => {
        const rhNew: StoredNewReview[] = [];
        const rhEdits: StoredEditReview[] = [];
        const rhPhotos: StoredPhotoReview[] = [];

        const idb = await toolbox.openIDB("history", "readonly");
        const reviews = await idb.getAll();
        for (const review of reviews) {
          if (review.type === "NEW") rhNew.push(review);
          else if (review.type === "EDIT") rhEdits.push(review);
          else if (review.type === "PHOTO") rhPhotos.push(review);
        }

        const ratingNarRef = await awaitElement(() => document.querySelector("wf-rating-bar"));
        const parent = ratingNarRef.parentNode!.parentNode!;
        const searchBox = document.createElement("input");
        searchBox.classList.add("oprtcore-fix", "oprtcore-ui-large-input");
        searchBox.placeholder = "Search...";
        const tables = [
          {
            label: "Nomination Reviews",
            table: renderNewTable(searchBox, rhNew)
          }, {
            label: "Edit Reviews",
            table: renderEditsTable(searchBox, rhEdits),
          }, {
            label: "Photo Reviews",
            table: renderPhotosTable(searchBox, rhPhotos),
          }
        ];
        const selector = renderTableSelector(searchBox, tables);
        parent.appendChild(selector);
        for (const table of tables) {
          parent.appendChild(table.table);
        }
      };

      const renderTableSelector = (searchBox: HTMLInputElement, tables: { label: string, table: HTMLElement}[]) => {
        const container = document.createElement("div");
        const btns: HTMLElement[] = [];
        for (const { label, table } of tables) {
          const btn = makeChildNode(container, "button", label);
          btn.addEventListener("click", () => toggleTableDisplay(table, tables.map(t => t.table)));
          btn.classList.add("oprtcore-ui-button");
          btns.push(btn);
        }
        for (const btn of btns) {
          btn.addEventListener("click", (ev) => {
            for (const b of btns) b.classList.remove("oprtcore-ui-button-active");
            const e = ev.target as any;
            e.classList.add("oprtcore-ui-button-active");
          });
        }
        container.appendChild(searchBox);
        return container;
      };

      const toggleTableDisplay = (table: HTMLElement, hide: HTMLElement[]) => {
        for (const other of hide) other.style.display = "none";
        table.style.display = "block";
      };
      
      interface RendererParams<T> { value: T }

      const locationRenderer = (params: RendererParams<{ lat: number, lng: number }>) => `
          <a href="https://intel.ingress.com/?ll=${parseFloat(params.value.lat.toString())},${parseFloat(params.value.lng.toString())}&z=16" target="_blank">
            ${parseFloat(params.value.lat.toString()).toFixed(6)}, ${parseFloat(params.value.lng.toString()).toFixed(6)}
          </a>`;

      const renderNewTable = (searchBox: HTMLInputElement, data: StoredNewReview[]) => {
        const l10n = toolbox.l10n;
        return makeDataTable(searchBox, {
          rowData: data.map(review => {
            const rText = (() => {
              if (review.review !== null && typeof review.review !== "undefined") {
                if (review.ts < FLOW_CHANGE_TIME) {
                  const oldType = review.review as {
                    quality?: number,
                    rejectReason?: string,
                    duplicate?: boolean,
                  };
                  if (typeof oldType.quality !== "undefined") {
                    return oldType.quality.toString();
                  } else if (typeof oldType.rejectReason !== "undefined") {
                    return l10n[`reject.reason.${oldType.rejectReason.toLowerCase()}.short`];
                  } else if ("duplicate" in oldType) {
                    return "Duplicate";
                  } else {
                    toolbox.warn("Unknown old-type review", review.review);
                  }
                } else {
                  if ("quality" in review.review) {
                    return "Accepted";
                  } else if ("rejectReasons" in review.review) {
                    const rejections: string[] = [];
                    for (const r of review.review.rejectReasons) {
                      const rjText = l10n[`reject.reason.${r.toLowerCase()}.short`];
                      rejections.push(rjText || REJECTION_MAP[r] || r);
                    }
                    return rejections.join(", ");
                  } else if ("duplicate" in review.review) {
                    return "Duplicate";
                  } else {
                    toolbox.warn("Unknown new-type review", review.review);
                  }
                }
              } else {
                return "Skipped/Timed Out";
              }
            })();
            return {
              ...review,
              date: new Date(review.ts),
              review: rText,
              location: {
                lat: review.lat,
                lng: review.lng,
              },
            };
          }),
          columnDefs: [
            { field: "date", headerName: "Date" },
            { field: "title", headerName: "Title" },
            { field: "description", headerName: "Description" },
            { field: "review", headerName: "Review" },
            { field: "location", headerName: "Location", cellRenderer: locationRenderer },
          ],
        });
      };

      const renderEditsTable = (searchBox: HTMLInputElement, data: StoredEditReview[]) => {
        return makeDataTable(searchBox, {
          rowData: data.map(review => {
            const editType = (() => {
              const types: string[] = [];
              if (review.locationEdits.length > 1) types.push("Location");
              if (review.descriptionEdits.length > 0) types.push("Description");
              if (review.titleEdits.length > 0) types.push("Title");
              return types.join(", ");
            })();
            return {
              ...review,
              date: new Date(review.ts),
              title: review.titleEdits.length > 0 ? review.titleEdits.map(t => t.value).join(" / ") : review.title,
              editType,
              location: {
                lat: review.lat,
                lng: review.lng,
              },
            };
          }),
          columnDefs: [
            { field: "date", headerName: "Date" },
            { field: "title", headerName: "Title" },
            { field: "editType", headerName: "Type" },
            { field: "location", headerName: "Location", cellRenderer: locationRenderer },
          ],
        });
      };

      const renderPhotosTable = (searchBox: HTMLInputElement, data: StoredPhotoReview[]) => {
        return makeDataTable(searchBox, {
          rowData: data.map(review => {
            return {
              ...review,
              date: new Date(review.ts),
              photoCount: review.newPhotos.length,
              accepted: review.review === null ? "N/A" : `${review.review.acceptPhotos.length} / ${review.newPhotos.length}`,
              location: {
                lat: review.lat,
                lng: review.lng,
              },
            };
          }),
          columnDefs: [
            { field: "date", headerName: "Date" },
            { field: "title", headerName: "Title" },
            { field: "photoCount", headerName: "Photo Count" },
            { field: "accepted", headerName: "Accepted" },
            { field: "location", headerName: "Location", cellRenderer: locationRenderer },
          ],
        });
      };

      const makeDataTable = <T>(searchBox: HTMLInputElement, gridOptions: agGrid.GridOptions<T>) => {
        console.log(gridOptions);
        const container = document.createElement("div");
        container.classList.add("oprrh-table");
        const api = agGrid.createGrid(container, {
          ...gridOptions,
          theme: agGrid.themeQuartz.withPart(isDarkMode() ? agGrid.colorSchemeDark : agGrid.colorSchemeLight),
          pagination: true,
        });
        searchBox.addEventListener("input", () => {
          api.setGridOption("quickFilterText", searchBox.value);
        });
        return container;
      };

      toolbox.interceptOpenJson("GET", "/api/v1/vault/review", handleIncomingReview);
      toolbox.interceptOpenJson("GET", "/api/v1/vault/profile", handleProfile);
      toolbox.interceptSendJson("/api/v1/vault/review", handleSubmittedReview);
    }
  });
};
