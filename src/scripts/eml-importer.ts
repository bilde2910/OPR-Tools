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
import { makeChildNode, readFiles } from "src/utils";

import EmlImportIcon from "../../assets/eml-import.svg";
import "./eml-importer.css";

export default () => {
  register()({
    id: "eml-importer",
    name: "EML Email Importer",
    authors: ["tehstone", "bilde2910"],
    description: "Adds the capability to import emails to OPR to enrich other plugins, such as Nomination Status History",
    defaultConfig: {},
    sessionData: {},
    initialize: (toolbox, _logger, _config) => {
      const createEmailLoader = async (title: string, body: string) => {
        const modal = await toolbox.createModal("opremli-modal");
        const header = makeChildNode(modal.container, "h2", title);
        const status = makeChildNode(modal.container, "p", body);
        return {
          setTitle: (text: string) => header.textContent = text,
          setStatus: (text: string) => status.textContent = text,
          destroy: () => modal.dismiss(),
        };
      };

      const importEmails = async () => {
        const emailAPI = await toolbox.getAddonAPI("opr-tools-core")!.email();
        const files = await readFiles("message/rfc822", "*.eml");
        const loader = await createEmailLoader("Importing...", "Please wait");
        const iterator = async function*() {
          for (const file of files) {
            yield {
              filename: file.name,
              contents: await file.text(),
            };
          }
        };
        let count = 1;
        await emailAPI.import(iterator(), () => {
          loader.setStatus(`Processing email ${count} of ${files.length}`);
          count++;
        });
        loader.destroy();
      };

      toolbox.addImporter({
        title: "Import *.eml files",
        description: "Import email files saved and exported from an email client, such as Thunderbird",
        callback: importEmails,
        icon: EmlImportIcon,
      });
    },
  });
};
