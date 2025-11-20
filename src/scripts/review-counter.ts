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

import { register } from "src/core";
import { unilTruthy, makeChildNode } from "src/utils";
import { AnySubmittedReview } from "src/types";

import "./review-counter.css";

export default () => {
  register()({
    id: "review-counter",
    name: "Review Counter",
    authors: ["tehstone", "bilde2910"],
    description: "Add review conuter to OPR",
    defaultConfig: {},
    sessionData: {
      reviews: 0,
    },
    initialize: (toolbox, _logger, _config) => {
      const injectCounter = async () => {
        const container = await unilTruthy(() => document.querySelector("wf-logo")?.parentElement?.parentElement);
        if (document.getElementById("oprrct-counter") === null) {
          const div = makeChildNode(container, "div");
          div.classList.add("oprrct-outer");
          const countLabel = makeChildNode(div, "p", "Review count:");
          const counter = makeChildNode(div, "p", toolbox.session.get("reviews").toString());
          counter.id = "oprrct-counter";
          const confirmReset = () => {
            if (confirm("Reset review count?")) {
              toolbox.session.clear("reviews");
              counter.textContent = "0";
            }
          };
          countLabel.addEventListener("click", confirmReset);
          counter.addEventListener("click", confirmReset);
        }
      };

      const incrementCounter = async (_review: AnySubmittedReview, result: string) => {
        if (result === "api.review.post.accepted") {
          const count = toolbox.session.get("reviews") + 1;
          toolbox.session.set("reviews", count);
          const counter = document.getElementById("oprrct-counter");
          if (counter !== null) {
            counter.textContent = count.toString();
          }
        }
      };

      toolbox.interceptOpenJson("GET", "/api/v1/vault/home", injectCounter);
      toolbox.interceptOpenJson("GET", "/api/v1/vault/review", injectCounter);
      toolbox.interceptSendJson("/api/v1/vault/review", incrementCounter);
    },
  });
};
