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
import { untilTruthy, makeChildNode } from "src/utils";
import { SubmissionsResult, SubmitAppeal } from "src/types";

import "./appeal-timer.css";

const MAX_APPEALS = 2;
const APPEAL_COUNTDOWN_MSEC = 15 * 86400 * 1000;

type StoredAppeal = Partial<SubmitAppeal> & {
  id: string,
  ts: number,
};

interface IdbStores {
  appeals: StoredAppeal
}

const AVAILABLE_LABEL = "Appeals available:";
const UNAVAILABLE_LABEL = "Next appeal in:";

export default () => {
  register<IdbStores, void>()({
    id: "appeal-timer",
    name: "Appeal Timer",
    authors: ["tehstone", "bilde2910"],
    description: "Save when appeals are done, and add a timer that counts down to the next available appeal.",
    defaultConfig: {},
    sessionData: {},
    initialize: (toolbox, logger, _config) => {
      const updateTimer = async (result?: SubmissionsResult) => {
        const container = await untilTruthy(() => document.querySelector("wf-logo")?.parentElement?.parentElement);
        const now = Date.now();
        let counter = document.getElementById("oprtat-counter");
        let label = document.getElementById("oprtat-label");
        if (counter === null) {
          const div = makeChildNode(container, "div");
          div.classList.add("oprtat-outer");
          label = makeChildNode(div, "p", result?.canAppeal ? AVAILABLE_LABEL : UNAVAILABLE_LABEL);
          label.id = "oprtat-label";
          counter = makeChildNode(div, "p", "Loading…");
          counter.id = "oprtat-counter";
        }
        {
          using idb = await toolbox.openIDB("appeals", "readonly");
          const appeals = await idb.getAll();
          const recent = appeals
            .filter(a => a.ts >= now - APPEAL_COUNTDOWN_MSEC)
            .sort((a, b) => a.ts - b.ts);
          if (recent.length >= MAX_APPEALS || !result?.canAppeal) {
            const ttl = ((recent[0].ts + APPEAL_COUNTDOWN_MSEC) - now) / 1000;
            if (ttl / 86400 >= 1) {
              counter.textContent = `~${Math.round(ttl / 86400)} days`;
            } else if (ttl / 3600 >= 1) {
              counter.textContent = `~${Math.round(ttl / 3600)} hours`;
            } else if (ttl >= 0) {
              counter.textContent = `~${Math.round(ttl / 60)} minutes`;
            } else {
              counter.textContent = "Unknown";
            }
            label!.textContent = UNAVAILABLE_LABEL;
          } else if (typeof result !== "undefined" && !result.canAppeal) {
            counter.textContent = "Unknown";
            label!.textContent = UNAVAILABLE_LABEL;
          } else {
            counter.textContent = (MAX_APPEALS - recent.length).toString();
            label!.textContent = AVAILABLE_LABEL;
          }
        }
      };

      const handleSubmittedAppeal = async (sent: SubmitAppeal, received: string) => {
        logger.info("Appeal submitted with status", received);
        if (received === "DONE") {
          logger.info("Storing appeal");
          {
            using idb = await toolbox.openIDB("appeals", "readwrite");
            idb.put({ ...sent, ts: Date.now() });
            idb.commit();
          }
          void updateTimer();
        }
      };
      
      toolbox.interceptOpenJson("GET", "/api/v1/vault/manage", updateTimer);
      toolbox.interceptSendJson("/api/v1/vault/manage/appeal", handleSubmittedAppeal);
    },
  });
};
