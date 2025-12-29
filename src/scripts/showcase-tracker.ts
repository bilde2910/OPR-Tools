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

import { register } from "src/core";
import { deepEquals, makeChildNode, toUtcIsoDate, untilTruthy } from "src/utils";
import { ContributionType, Showcase, ShowcasedPortal } from "src/types";

import "./showcase-tracker.css";

import { S2 } from "s2-geometry";
import { AppSubmissionsListItemElement } from "src/unsafe";

interface StoredShowcase {
  id: number,
  storedAt: number,
  showcase: ShowcasedPortal[]
};

interface IdbStores {
  showcases: StoredShowcase
};

interface LookupResult {
  matchedShowcase: StoredShowcase | null,
  latestKey: number,
}

type StoredShowcasedPortal = ShowcasedPortal & {
  _scId: number,
  _scAt: number,
};

export default () => {
  register<IdbStores, void>()({
    id: "showcase-tracker",
    name: "Showcase Tracker",
    authors: ["bilde2910"],
    description: "Tracks history of showcased nominations, and highlights showcased nominations on the Contributions page.",
    defaultConfig: {},
    sessionData: {},
    initialize: (toolbox, logger, _config) => {
      const getLatestStoredShowcase = async (): Promise<LookupResult> => {
        using idb = await toolbox.openIDB("showcases", "readonly");
        const keys = (await idb.keys()).sort((a, b) => b - a);
        for (const k of keys) {
          const sc = await idb.get(k);
          return {
            matchedShowcase: sc,
            latestKey: keys[0] ?? -1,
          };
        }
        return {
          matchedShowcase: null,
          latestKey: keys[0] ?? -1,
        };
      };

      const storeShowcase = async (id: number, showcase: ShowcasedPortal[]) => {
        using idb = await toolbox.openIDB("showcases", "readwrite");
        idb.put({
          id,
          storedAt: Date.now(),
          showcase,
        });
        idb.commit();
      };

      const handleShowcase = async (sc: Showcase) => {
        const s2cell = getShowcaseS2Cell(sc.showcase);
        const result = await getLatestStoredShowcase();
        if (result.matchedShowcase !== null) {
          const guid1 = sc.showcase.map(n => n.guid);
          const guid2 = result.matchedShowcase.showcase.map(n => n.guid);
          if (deepEquals(guid1, guid2)) return;
        }
        logger.info("Found new showcase for S2 cell", s2cell);
        await storeShowcase(result.latestKey + 1, sc.showcase);
      };

      const detectAppListItems = async () => {
        // Build dataset
        const allShowcasedPortals: StoredShowcasedPortal[] = [];
        {
          using idb = await toolbox.openIDB("showcases", "readonly");
          const showcases = await idb.getAll();
          for (const sc of showcases) {
            for (const n of sc.showcase) {
              allShowcasedPortals.push({
                ...n,
                _scId: sc.id,
                _scAt: sc.storedAt,
              });
            }
          }
        }
        // Wait for element
        const parentContainer = await untilTruthy(() => document.querySelector(".submissions"));
        // Scan existing elements
        const existingItems = parentContainer.querySelectorAll<AppSubmissionsListItemElement>("app-submissions-list-item");
        for (const item of existingItems) formatItem(item, allShowcasedPortals);
        // Set up MutationObserver for new elements
        const observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
              if (node.nodeName === "APP-SUBMISSIONS-LIST-ITEM") {
                formatItem(node as AppSubmissionsListItemElement, allShowcasedPortals);
              }
            }
          }
        });
        observer.observe(parentContainer, {
          childList: true,
          subtree: true,
        });
      };

      const formatItem = (item: AppSubmissionsListItemElement, allShowcasedPortals: StoredShowcasedPortal[]) => {
        renderShowcaseLabel(item);
        const data = item.__ngContext__[22];
        if (data.type !== ContributionType.NOMINATION) return;
        const filtered = allShowcasedPortals.filter(n => n.imageUrl === data.imageUrl);
        if (filtered.length > 0) {
          renderShowcaseLabel(item, filtered[0]);
          //item.addEventListener("click", () => interceptDetailsPane(data));
        }
      };

      const renderShowcaseLabel = (item: AppSubmissionsListItemElement, showcase?: StoredShowcasedPortal) => {
        // Remove oprsct-star class if already present
        const starTags = item.querySelectorAll(".oprsct-star");
        for (let i = starTags.length - 1; i >= 0; i--) starTags[i].remove();
        if (typeof showcase === "undefined") return;
        // Add a new star
        const nominationTagSet = item.querySelector("app-submission-tag-set");
        if (nominationTagSet) {
          const newTag = makeChildNode(nominationTagSet, "app-submission-tag");
          newTag.classList.add("mr-1", "oprsct-star");
          newTag.title = `Seen on showcase on ${toUtcIsoDate(new Date(showcase._scAt))}`;
          const newTagContent = makeChildNode(newTag, "div", "\u2b50");
          newTagContent.classList.add("submission-tag", "ng-star-inserted");
        }
      };

      toolbox.interceptOpenJson("GET", "/api/v1/vault/home", handleShowcase);
      toolbox.interceptOpenJson("GET", "/api/v1/vault/manage", detectAppListItems);
    },
  });
};

const getShowcaseS2Cell = (showcase: ShowcasedPortal[]) => {
  const cellSet = new Set<string>();
  for (const n of showcase) {
    const cell = S2.S2Cell.FromLatLng(S2.L.LatLng(n.lat, n.lng), 6).toString();
    cellSet.add(cell);
  }
  return cellSet;
};
