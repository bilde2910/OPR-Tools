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
import { awaitElement, insertAfter, makeChildNode } from "src/utils";
import { Profile } from "src/types";

import "./extended-stats.css";

export default () => {
  register({
    id: "extended-stats",
    name: "Extended Stats",
    authors: ["tehstone", "bilde2910"],
    description: "Add extended OPR Profile stats",
    defaultConfig: {
      bonusUpgrades: 0,
      offsetAgreements: 0,
    },
    initialize: (toolbox, config) => {
      const parseStats = async (profile: Profile) => {
        const parentRef = await awaitElement(() => document.querySelector(".wf-profile-stats__section-title"));

        const allAgreements = getTotalAgreementCount(profile) || profile.accepted + profile.rejected + profile.duplicated;
        const percent = ((allAgreements / profile.finished) * 100).toFixed(1);
        const otherAgreements = allAgreements - profile.accepted - profile.rejected - profile.duplicated;

        const totalParent = document.createElement("div");
        totalParent.classList.add("oprtes-parent");
        makeChildNode(totalParent, "div", "Processed & Agreement").classList.add("oprtes-text");
        makeChildNode(totalParent, "div", `${allAgreements} (${percent}%)`).classList.add("oprtes-count");
        insertAfter(parentRef, totalParent);

        const otherParent = document.createElement("div");
        otherParent.classList.add("oprtes-parent");
        makeChildNode(otherParent, "div", "Other Agreements").classList.add("oprtes-text");
        makeChildNode(otherParent, "div", otherAgreements.toString()).classList.add("oprtes-count");
        insertAfter(parentRef.parentElement!.lastChild!, otherParent);
      };

      const getTotalAgreementCount = (stats: Profile) =>
        (stats.total + stats.available - config.get("bonusUpgrades")) * 100
        + stats.progress + config.get("offsetAgreements");

      toolbox.interceptOpenJson("GET", "/api/v1/vault/profile", parseStats);
    }
  });
};


