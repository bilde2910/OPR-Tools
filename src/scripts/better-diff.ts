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

import { NumericInputEditor, register } from "src/core";
import { makeChildNode } from "src/utils";
import { AnyReview, EditReview, TextEditOption } from "src/types";
import { diffChars } from "diff";

import "./better-diff.css";

interface ComputedDiffNode {
  contents: string,
  differs: boolean,
}

export default () => {
  register()({
    id: "better-diff",
    name: "Better Diffs",
    authors: ["bilde2910"],
    description: "Improves the text difference display for text edits",
    defaultConfig: {
      threshold: 85,
    },
    sessionData: {},
    initialize: (toolbox, logger, config) => {
      config.setUserEditable("threshold", {
        label: "Similarity threshold (0-100%)",
        help: "How similar edits must be to each other before diffs are shown",
        editor: new NumericInputEditor({ min: 0, max: 100, step: 0.1 }),
      });

      let review: EditReview | null = null;

      const handleReview = (result: AnyReview) => {
        if (result.type === "EDIT") review = result;
      };

      const updateDiff = (node: Element) => {
        const radio = node.closest("mat-radio-button")?.querySelector<HTMLInputElement>("input[type=\"radio\"]");
        if (!review || !radio) {
          logger.warn("No edit review and/or radio button found for diff node", node);
          return;
        }

        const hash = radio.value;
        let options: TextEditOption[] = [];
        if (review.titleEdits.some(v => v.hash === hash)) options = review.titleEdits;
        else if (review.descriptionEdits.some(v => v.hash === hash)) options = review.descriptionEdits;
        if (options.length === 0) {
          logger.warn("No text candidates found in the current review for diff item", hash, node);
          return;
        }

        const analysis = analyzeOptions(options, config.get("threshold") / 100);
        logger.info("Calculated diff analysis", analysis);
        if (typeof analysis[hash] === "undefined") {
          logger.warn("Cannot find analysis entry for hash", hash, review);
          return;
        }

        node.querySelector("fragment")?.remove();
        const display = makeChildNode(node, "span");
        for (const part of analysis[hash]) {
          const span = makeChildNode(display, "span", part.contents);
          if (part.differs) span.classList.add("oprtbdiff-differs");
        }
      };

      toolbox.observeAddedNodes("APP-REVIEW-TEXT-DIFF", updateDiff);
      toolbox.interceptOpenJson("GET", "/api/v1/vault/review", handleReview);
    },
  });
};

const analyzeOptions = (opts: TextEditOption[], threshold: number) => {
  const l = opts.length;

  const grid = matrix<number>(l);
  for (let i = 0; i < l; i++) {
    const opt_i = opts[i].value;
    for (let j = i + 1; j < l; j++) {
      const opt_j = opts[j].value;
      const maxLen = Math.max(opt_i.length, opt_j.length);
      const dist = maxLen > 0 ? levDist(opt_i, opt_j) / maxLen : 0;
      const sim = 1 - dist;
      grid[i][j] = sim;
    }
  }

  const pooled: number[] = [];
  const pools = [];
  for (let i = 0; i < l; i++) {
    if (pooled.includes(i)) continue;
    const visited = [];
    const queue = [i];
    const pool = [i];
    while (queue.length) {
      const cur = queue.pop()!;
      visited.push(cur);
      for (let j = cur + 1; j < l; j++) {
        if (grid[cur][j] > threshold) {
          if (!pool.includes(j)) pool.push(j);
          if (!pooled.includes(j)) pooled.push(j);
          if (!visited.includes(j)) queue.push(j);
        }
      }
    }
    if (pool.length > 1) {
      pools.push(pool);
    }
  }

  const results: Record<string, ComputedDiffNode[]> = {};
  for (let i = 0; i < pools.length; i++) {
    let base = opts[pools[i][0]].value;
    for (let j = 1; j < pools[i].length; j++) {
      const diff = diffChars(base, opts[pools[i][j]].value);
      base = "";
      for (let k = 0; k < diff.length; k++) {
        if (diff[k].added || diff[k].removed) continue;
        base += diff[k].value;
      }
    }
    for (let j = 0; j < pools[i].length; j++) {
      results[opts[pools[i][j]].hash] = [];
      let add = false;
      const diff = diffChars(base, opts[pools[i][j]].value);
      for (let k = 0; k < diff.length; k++) {
        if (diff[k].added) {
          add = true;
        } else if (!diff[k].removed) {
          add = false;
        }
        results[opts[pools[i][j]].hash].push({
          contents: diff[k].value,
          differs: add,
        });
      }
    }
  }

  return results;
};

// The following function is sourced from James Westgate on Stack Overflow:
// https://stackoverflow.com/a/11958496/1955334
const levDist = (s: string, t: string) => {
  const d: number[][] = []; //2d matrix

  // Step 1
  const n = s.length;
  const m = t.length;
  if (n == 0) return m;
  if (m == 0) return n;

  // Create an array of arrays in javascript (a descending loop is quicker)
  for (let i = n; i >= 0; i--) d[i] = [];

  // Step 2
  for (let i = n; i >= 0; i--) d[i][0] = i;
  for (let j = m; j >= 0; j--) d[0][j] = j;

  // Step 3
  for (let i = 1; i <= n; i++) {
    const s_i = s.charAt(i - 1);

    // Step 4
    for (let j = 1; j <= m; j++) {

      // Check the jagged ld total so far
      if (i == j && d[i][j] > 4) return n;

      const t_j = t.charAt(j - 1);
      const cost = (s_i == t_j) ? 0 : 1; // Step 5

      // Calculate the minimum
      let mi = d[i - 1][j] + 1;
      const b = d[i][j - 1] + 1;
      const c = d[i - 1][j - 1] + cost;

      if (b < mi) mi = b;
      if (c < mi) mi = c;

      d[i][j] = mi; // Step 6

      // Damerau transposition
      if (i > 1 && j > 1 && s_i == t.charAt(j - 2) && s.charAt(i - 2) == t_j) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
      }
    }
  }

  // Step 7
  return d[n][m];
};

const matrix = <T>(size: number): T[][] => {
  const m = [];
  for (let i = size; i >= 0; i--) m[i - 1] = <T[]>[];
  return m;
};
