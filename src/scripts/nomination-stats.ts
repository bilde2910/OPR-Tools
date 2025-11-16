// Copyright 2025 tehstone, Tntnnbltn, bilde2910
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
import { unilTruthy, downloadAsFile, iterKeys, iterObject, makeChildNode } from "src/utils";
import { AnyContribution, ContributionStatus, ContributionType, EditContribution, SubmissionsResult } from "src/types";

import "./nomination-stats.css";

export default () => {
  register()({
    id: "nomination-stats",
    name: "Nomination Stats",
    authors: ["tehstone", "Thtnnbltn", "bilde2910"],
    description: "Add extended OPR Profile stats",
    defaultConfig: {},
    sessionData: {},
    initialize: (toolbox, _config) => {
      toolbox.interceptOpenJson("GET", "/api/v1/vault/manage", parseContributions);
    }
  });
};

const parseContributions = (data: SubmissionsResult) => {
  if (!data.submissions) return;
  addNominationDetails(data.submissions);
  addExportButtons(data.submissions);
};

const addNominationDetails = async (subs: AnyContribution[]) => {
  const ref = await unilTruthy(() => document.querySelector("app-submissions-list"));
  const counts = <Record<string, Record<string, number>>>{
    "EDIT": {},
    "TOTAL": {},
  };

  const decidedStatuses = [
    ContributionStatus.ACCEPTED,
    ContributionStatus.REJECTED,
    ContributionStatus.DUPLICATE,
  ];

  const submittedStatuses = [
    ...decidedStatuses,
    ContributionStatus.VOTING,
    ContributionStatus.NOMINATED,
    ContributionStatus.NIANTIC_REVIEW,
    ContributionStatus.APPEALED,
    ContributionStatus.WITHDRAWN,
    ContributionStatus.HELD,
  ];

  for (let i = 0; i < subs.length; i++) {
    const { type, status, upgraded } = subs[i];
    if (!counts[type]) counts[type] = {};
    if (!counts[type][status]) counts[type][status] = 0;
    counts[type][status]++;

    if (status === ContributionStatus.NOMINATED && upgraded) {
      counts[type]["NOMINATION_UPGRADED"] = (counts[type]["NOMINATION_UPGRADED"] || 0) + 1;
    } else if (status === ContributionStatus.VOTING && upgraded) {
      counts[type]["VOTING_UPGRADED"] = (counts[type]["VOTING_UPGRADED"] || 0) + 1;
    }

    if (decidedStatuses.includes(status)) {
      counts[type]["DECIDED"] = (counts[type]["DECIDED"] || 0) + 1;
    }
    if (submittedStatuses.includes(status)) {
      counts[type]["SUBMITTED"] = (counts[type]["SUBMITTED"] || 0) + 1;
    }
  }

  // Sum the stats for the different types of edits
  const statusTypes = ["SUBMITTED", "DECIDED", ...submittedStatuses];
  for (const typ of statusTypes) {
    counts["EDIT"][typ] = 0;
    for (const editType of [
      ContributionType.EDIT_TITLE,
      ContributionType.EDIT_DESCRIPTION,
      ContributionType.EDIT_LOCATION,
    ]) {
      counts["EDIT"][typ] += counts[editType][typ] ?? 0;
    }
  }

  // Sum the total stats
  for (const typ of statusTypes) {
    counts["TOTAL"][typ] = 0;
    for (const editType of [
      "EDIT",
      ContributionType.NOMINATION,
      ContributionType.PHOTO
    ]) {
      counts["TOTAL"][typ] += counts[editType][typ] ?? 0;
    }
  }

  let html = "<table class='oprns-stats-table'>";
  html += "<colgroup>";
  html += "<col style='width: 20%;'>".repeat(4);
  html += "</colgroup>";
  html += "<tr><th></th><th>Nominations</th><th>Edits</th><th>Photos</th><th>Total</th></tr>";

  const statusLabels = ["Submitted", "Decided", "Accepted", "Rejected", "Duplicates", "In Voting", "In Queue", "NIA Review", "Appealed", "Withdrawn", "On Hold"];
  const columnTypes = ["NOMINATION", "EDIT", "PHOTO", "TOTAL"];

  for (let i = 0; i < statusLabels.length; i++) {
    const status = statusTypes[i];
    html += "<tr><td>" + statusLabels[i] + "</td>";
    for (let j = 0; j < columnTypes.length; j++) {
      const columnType = columnTypes[j];
      let count = 0;
      const decidedCount = counts[columnType]["DECIDED"] || 0;

      count += counts[columnType][status] || 0;
      if ([...submittedStatuses, "ACCEPTED"].includes(status)) {
        const finePercentage = Math.round((count / decidedCount) * 10000) / 100;
        const percentage = Math.round((count / decidedCount) * 100);
        const fineLabel = isNaN(finePercentage) ? "—%" : `${finePercentage}%`;
        const label = isNaN(percentage) ? "—%" : `${percentage}%`;
        html += "<td id='" + columnType + "-" + status.replace(/ /g, "-") + "'>";
        html += count + "&nbsp;<span title='" + fineLabel + "' style='font-size: smaller'>(" + label + ")</span></td>";
      } else {
        html += "<td id='" + columnType + "-" + status.replace(/ /g, "-") + "'>" + count + "</td>";
      }
    }
    html += "</tr>";
  }
  html += "</table>";

  const statsContainer = document.createElement("div");
  statsContainer.setAttribute("class", "oprtns-wrap-collabsible");
  statsContainer.id = "nomStats";

  const collapsibleInput = document.createElement("input");
  collapsibleInput.id = "oprtns-collapsed-stats";
  collapsibleInput.setAttribute("class", "oprtns-toggle");
  collapsibleInput.type = "checkbox";

  const collapsibleLabel = document.createElement("label");
  collapsibleLabel.setAttribute("class", "oprtns-lbl-toggle-ns");
  collapsibleLabel.innerText = "View Nomination Stats";
  collapsibleLabel.setAttribute("for", "oprtns-collapsed-stats");

  const collapsibleContent = document.createElement("div");
  collapsibleContent.setAttribute("class", "oprtns-collapsible-content");
  collapsibleContent.innerHTML = html;

  statsContainer.appendChild(collapsibleInput);
  statsContainer.appendChild(collapsibleLabel);
  statsContainer.appendChild(collapsibleContent);

  const container = ref.parentNode!;
  container.appendChild(statsContainer);
};

const addExportButtons = async (subs: AnyContribution[]) => {
  const ref = await unilTruthy(() => document.querySelector("wf-logo"));
  if (document.getElementById("oprtns-export") !== null) return;
  const div = makeChildNode(ref.parentElement!.parentElement!, "div");
  div.id = "oprtns-export";
  const exportButton = makeChildNode(div, "button", "Export JSON");
  exportButton.addEventListener("click", () => exportNominationsJson(subs));
  exportButton.classList.add("oprtcore-ui-button");
  const exportCsvButton = makeChildNode(div, "button", "Export CSV");
  exportCsvButton.addEventListener("click", () => exportNominationsCsv(subs));
  exportCsvButton.classList.add("oprtcore-ui-button");
};

const exportNominationsJson = (subs: AnyContribution[]) => {
  const dataStr = JSON.stringify(subs);
  downloadAsFile(dataStr, "applications/json", "contributions.json");
};

const exportNominationsCsv = (subs: AnyContribution[]) => {
  const separator = ".";
  const headers = [] as string[];
  for (const item of subs) {
    for (const [k, v] of iterObject(item)) {
      if (Array.isArray(v)) {
        if (k === "rejectReasons") {
          if (!headers.includes(k)) headers.push(k);
          for (const reject of v) {
            const reasonKey =  k + separator + reject.reason;
            if (!headers.includes(reasonKey)) headers.push(reasonKey);
          }
        }
      } else if (k === "poiData") {
        if (item.type !== ContributionType.NOMINATION) {
          for (const poiKey of iterKeys(v)) {
            const pdKey = k + separator + poiKey;
            if (!headers.includes(pdKey)) headers.push(pdKey);
          }
        }
      } else {
        if (!headers.includes(k)) headers.push(k);
      }
    }
  }

  // Generate CSV headers dynamically from headers
  let csv = headers.join(",") + "\r\n";

  for (const item of subs) {
    let row = "";
    for (const header of headers) {
      const sep = header.indexOf(separator);
      if (sep >= 0) {
        const itemKey = header.substring(0, sep) as keyof AnyContribution;
        const subKey = header.substring(sep + 1);
        if (itemKey === "poiData" && item.type !== ContributionType.NOMINATION) {
          const tsKey = subKey as keyof EditContribution["poiData"];
          row += `"${String(item.poiData[tsKey] ?? "").replace(/"/g, "\"\"")}",`;
        } else if (Array.isArray(item[itemKey]) && itemKey === "rejectReasons") {
          row += item[itemKey].map(r => r.reason).includes(subKey) ? "1," : "0,";
        } else {
          row += ",";
        }
      } else {
        const tHdr = header as keyof AnyContribution;
        if (tHdr === "rejectReasons") {
          row += `"${(item[tHdr] ?? []).map(r => r.reason).join(",").replace(/"/g, "\"\"")}",`;
        } else {
          row += `"${String(item[tHdr] ?? "").replace(/"/g, "\"\"")}",`;
        }
      }
    }
    // Remove trailing comma
    csv += row.slice(0, -1) + "\r\n";
  }
  downloadAsFile(csv, "text/csv; charset=utf-8", "contributions.csv");
};
