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

import { register, TextInputEditor } from "src/core";
import { sleep } from "src/utils";
import { ContributionStatus, ContributionType, SubmissionsResult } from "src/types";

import "./auto-hold.css";

import LoadingWheel from "../../assets/loading.svg";

const TIMEOUT = 2500;

export default () => {
  register()({
    id: "auto-hold",
    name: "Auto Hold",
    authors: ["AlterTobi", "bilde2910"],
    description: "Put nomination on hold automatically when supporting statement contains a given text",
    defaultConfig: {
      autoHoldText: "#hold",
    },
    sessionData: {},
    initialize: (toolbox, logger, config) => {
      config.setUserEditable("autoHoldText", {
        label: "Search text (case-insensitve)",
        help: "If this text is found in the supporting statement, automatically hold the nomination",
        editor: new TextInputEditor(),
      });

      const handleNominations = async (result: SubmissionsResult) => {
        const searchFor = config.get("autoHoldText").toLowerCase();
        const toHold = result.submissions
          .filter(n => n.type === ContributionType.NOMINATION)
          .filter(n => n.status === ContributionStatus.NOMINATED)
          .filter(n => n.statement.toLowerCase().includes(searchFor));
        if (toHold.length > 0) {
          const notification = await toolbox.notify({
            color: "dark-gray",
            message: "AutoHold: Processing nominations...",
            icon: LoadingWheel,
            dismissable: false,
          });
          try {
            for (let i = 0; i < toHold.length; i++) {
              logger.info(`Holding "${toHold[i].title}"`);
              notification.updateContents(`AutoHold: Holding ${i + 1} of ${toHold.length} nomination(s)...`);
              await sleep(TIMEOUT);
              await toolbox.makeRequest("POST", "/api/v1/vault/manage/hold", {
                id: toHold[i].id,
              });
            }
            await toolbox.notify({
              color: "green",
              message: "AutoHold: All nominations processed! Please reload the page now.",
            });
          } catch (ex) {
            logger.error(ex);
            if (ex instanceof Error) {
              await toolbox.notify({
                color: "red",
                message: `AutoHold: Failed to hold nominations: ${ex.message}`,
              });
            }
          } finally {
            notification.dismiss();
          }
        }
      };

      toolbox.interceptOpenJson("GET", "/api/v1/vault/manage", handleNominations);
    },
  });
};


