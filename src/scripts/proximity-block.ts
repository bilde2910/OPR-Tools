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
import { makeChildNode } from "src/utils";
import { AnyContribution, ContributionStatus, ContributionType, Nomination, SubmissionsResult } from "src/types";
import { AppSubmissionsListItemElement } from "src/unsafe";

import "./proximity-block.css";

import { S2 } from "s2-geometry";

export default () => {
  register()({
    id: "proximity-block",
    name: "Proximity Block",
    authors: ["bilde2910"],
    description: "Find other nearby nominations that are blocking, or would be blocked by, each nomination",
    defaultConfig: {},
    sessionData: {},
    initialize: (toolbox, _logger, _config) => {
      let nominations: Nomination[] = [];

      const handleNominations = async (result: SubmissionsResult) => {
        nominations = result.submissions.filter(s => s.type === ContributionType.NOMINATION);
      };

      const formatItem = (item: AppSubmissionsListItemElement) => {
        const data = item.__ngContext__[22];
        updateRejectionLabels(item, data);
        item.addEventListener("click", () => interceptDetailsPane(data));
      };

      const getConflictingS2L17Cells = (lat: number, lng: number) => {
        const center = S2.S2Cell.FromLatLng(S2.L.LatLng(lat, lng), 17);
        const neighbors = center.getNeighbors();
        const conflicting = [center, ...neighbors];
        for (const neighbor of neighbors) {
          const possibleCorners = neighbor.getNeighbors()
            .filter(c => !conflicting.some(n => n.toString() === c.toString()));
          for (const cand of possibleCorners) {
            const cornerNeighbors = cand.getNeighbors().filter(c => neighbors.some(n => n.toString() === c.toString())).length;
            // A candidate is a corner if two of the corner's neighbors are also neighbors of the center cell
            if (cornerNeighbors === 2) conflicting.push(cand);
          }
        }
        return conflicting;
      };

      const proximityBlockingFor = (nom: Nomination) => {
        const conflicting = getConflictingS2L17Cells(nom.lat, nom.lng).map(c => c.toString());
        const blockingNoms = nominations
          .filter(n =>
            n.status === ContributionStatus.NOMINATED ||
            n.status === ContributionStatus.VOTING ||
            n.status === ContributionStatus.HELD,
          )
          .filter(n => n.id !== nom.id)
          .filter(n => conflicting.includes(S2.S2Cell.FromLatLng(n, 17).toString()));
        return blockingNoms;
      };

      const updateRejectionLabels = (item: AppSubmissionsListItemElement, nom: AnyContribution) => {
        // Remove oprtpb-blocked class if already present
        const blockedTags = item.querySelectorAll(".oprtpb-blocked-tag");
        for (let i = blockedTags.length - 1; i >= 0; i--) blockedTags[i].remove();
        const hiddenTags = item.querySelectorAll(".oprtpb-blocked-hidden");
        for (let i = hiddenTags.length - 1; i >= 0; i--) hiddenTags[i].classList.remove("oprtpb-blocked-hidden");

        if (nom.type !== ContributionType.NOMINATION) return;
        if (nom.status !== ContributionStatus.NOMINATED) return;

        // If the current Wayspot data is blocked by another in-voting nomination, mark it as "proximity blocked".
        const blockers = proximityBlockingFor(nom).filter(n => n.status === ContributionStatus.VOTING);
        if (blockers.length > 0) {
          const nominationTagSet = item.querySelector("app-submission-tag-set");
          if (nominationTagSet) {
            // Hide existing tag
            const existingTags = nominationTagSet.querySelectorAll("app-submission-tag");
            if (existingTags.length === 1) {
              existingTags[0].classList.add("oprtpb-blocked-hidden");
            }
            // Create new tag
            const newTag = makeChildNode(nominationTagSet, "app-submission-tag");
            newTag.classList.add("mr-1", "oprtpb-blocked-tag");
            const newTagContent = makeChildNode(newTag, "div");
            newTagContent.classList.add("submission-tag", "ng-star-inserted");
            const newSpan = makeChildNode(newTagContent, "span", "Proximity Blocked");
            newSpan.classList.add("submission-tag--queue");
          }
        }
      };

      const makeTable = (title: string, nominations: Nomination[]) => {
        const container = document.createElement("div");
        container.classList.add("oprtpb-container");
        const header = makeChildNode(container, "div", title);
        header.classList.add("oprtpb-header");
        const table = makeChildNode(container, "table") as HTMLTableElement;
        table.classList.add("oprtpb-table");

        // Sort nominations by date in descending order (most recent to oldest)
        nominations.sort((a, b) => b.order - a.order);
        // Populate table with nomination data
        for (const nom of nominations) {
          const row = table.insertRow();
          makeChildNode(row, "td", nom.day);
          makeChildNode(row, "td", nom.title);
          const cell3 = makeChildNode(row, "td");
          cell3.appendChild(generateNominationTag(nom));
        }

        return container;
      };

      const generateNominationTag = (data: Nomination) => {
        const tagText = (() => {
          switch (data.status) {
            case ContributionStatus.NOMINATED: return "In Queue";
            case ContributionStatus.VOTING: return "In Voting";
            case ContributionStatus.HELD: return "On Hold";
            default: return "Unknown";
          }
        })();
        const asTag = document.createElement("app-submission-tag");
        const subTag = makeChildNode(asTag, "div");
        subTag.classList.add("submission-tag");
        makeChildNode(subTag, "span", tagText).classList.add("submission-tag--queue");
        return asTag;
      };

      const interceptDetailsPane = (data: AnyContribution) => {
        const containers = document.querySelectorAll(".oprtpb-container");
        for (let i = containers.length - 1; i >= 0; i--) containers[i].remove();
        if (data.type !== ContributionType.NOMINATION) return;
        const blocking = proximityBlockingFor(data);
        if (blocking.length === 0) return;
        const ref = document.querySelector("app-details-pane img");

        const blockedBy: Nomination[] = [];
        const willBlock: Nomination[] = [];
        for (const other of blocking) {
          if (other.status === ContributionStatus.VOTING) {
            blockedBy.push(other);
          } else {
            willBlock.push(other);
          }
        }

        if (blockedBy.length && data.status !== ContributionStatus.VOTING) {
          const header = `Currently proximity blocked by (${blockedBy.length})`;
          ref!.parentElement!.insertBefore(makeTable(header, blockedBy), ref);
        }
        if (willBlock.length) {
          const header = data.status === ContributionStatus.VOTING
            ? `Currently proximity blocking (${willBlock.length})`
            : `Will proximity block or be blocked by (${willBlock.length})`;
          ref!.parentElement!.insertBefore(makeTable(header, willBlock), ref);
        }
      };

      toolbox.interceptOpenJson("GET", "/api/v1/vault/manage", handleNominations);
      toolbox.observeAddedNodes("APP-SUBMISSIONS-LIST-ITEM", formatItem);
    },
  });
};
