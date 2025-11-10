import { register } from "src/core";
import { awaitElement } from "src/utils";
import { Contribution, ContributionStatus, ContributionType, SubmissionsResult } from "src/types";

import "./nomination-stats.css";

export default () => {
  register({
    id: "nomination-stats",
    defaultConfig: {},
    initialize: (toolbox, config) => {
      toolbox.interceptJson("GET", "/api/v1/vault/manage", parseContributions);
    }
  });
};

const parseContributions = (data: SubmissionsResult) => {
  if (!data.submissions) return;
  addNominationDetails(data.submissions);
};

const addNominationDetails = async (subs: Contribution[]) => {
  const ref = await awaitElement(() => document.querySelector("app-submissions-list"));
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
