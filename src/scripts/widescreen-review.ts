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

import "./widescreen-review.css";

export default () => {
  register()({
    id: "widescreen-review",
    name: "Widescreen Review",
    authors: ["bilde2910"],
    description: "Improves the review interface to be more comfortable on desktop by switching to a three-column layout",
    defaultConfig: {},
    sessionData: {},
    initialize: (toolbox, logger, _config) => {
      const updateView = (ref: Element) => {
        ref.closest("mat-sidenav-content > .max-w-7xl")?.classList.remove("max-w-7xl");
        ref.classList.add("oprwsr-root-new");
        logger.info("ref", ref);
        console.log(ref.querySelectorAll("div"));
        const columns = [...ref.children].filter(node => node.tagName === "DIV").map(node => node);
        logger.info(columns);
        columns.push(makeChildNode(ref, "div"));

        const [ c1, c2, c3 ] = columns;
        for (const col of columns) {
          for (let i = col.children.length - 1; i >= 0; i--) {
            if (["P", "H4"].includes(col.children[i].tagName)) {
              col.children[i].remove();
            }
          }
        }

        c1.classList.add("flex", "gap-3");
        c2.classList.remove("review-questions");
        c3.classList.add("flex", "flex-col", "gap-3", "review-questions");

        const supportingBox = document.createElement("div");
        c2.insertAdjacentElement("afterbegin", supportingBox);
        c2.insertAdjacentElement("afterbegin", c1.querySelector("app-title-and-description-b")!);

        const supportingCard = makeChildNode(supportingBox, "wf-review-card");
        supportingCard.classList.add("wf-review-card", "card");
        supportingCard.appendChild(c1.querySelector("app-supporting-info-b .wf-review-card__header")!.cloneNode(true));
        const cardBody = makeChildNode(supportingCard, "div");
        cardBody.classList.add("wf-review-card__body");
        cardBody.appendChild(c1.querySelector("app-supporting-info-b .wf-review-card__body .wf-image-modal + div")!);

        for (const question of c2.querySelectorAll("app-question-card")) {
          c3.appendChild(question);
          const thumbsRow = document.createElement("div");
          thumbsRow.classList.add("oprwsr-thumbs-row");
          question.querySelector(".action-buttons-row")!.insertAdjacentElement("afterbegin", thumbsRow);
          for (const thumb of question.querySelectorAll(".thumbs-button")) {
            thumbsRow.appendChild(thumb);
          }
          const title = question.querySelector(".question-title")!;
          //const helpText = question.querySelector(".title-and-subtitle-row > div")!;
          const tooltip = question.querySelector(".question-subtitle-tooltip");
          if (tooltip) title.appendChild(tooltip);
          /*
          const container = title.closest(".main-section-container")!;
          container.parentElement!.insertAdjacentElement("afterbegin", helpText);*/
        }
        c3.appendChild(c2.querySelector("app-review-categorization-b")!);
      };

      toolbox.observeAddedNodes<Element>("APP-REVIEW-NEW-B", (node) => updateView(node.children[0]));
    },
  });
};
