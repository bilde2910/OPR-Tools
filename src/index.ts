import { buildNumber, scriptInfo } from "./constants";
import { initializeAllAddons, initializeUserHash } from "./core";
import { addStyle, domLoaded } from "./utils";

import oprToolsCore from "./scripts/opr-tools-core";
import nominationStats from "./scripts/nomination-stats";
import nominationMap from "./scripts/nomination-map";

const availableAddons = [
  oprToolsCore,
  nominationStats,
  nominationMap,
];

/** Runs when the userscript is loaded initially */
async function init() {
  if(domLoaded)
    run();
  else
    document.addEventListener("DOMContentLoaded", run);
}

/** Runs after the DOM is available */
async function run() {
  try {
    console.log(`Initializing ${scriptInfo.name} v${scriptInfo.version} (#${buildNumber})...`);
    initializeUserHash().then((userHash: number) => {
      console.log(`Initializing OPR Tools for user hash ${userHash}`);
      for (const addon of availableAddons) addon();
      console.log("Addons registered.");
      initializeAllAddons();
    });

    // post-build these double quotes are replaced by backticks (because if backticks are used here, the bundler converts them to double quotes)
    addStyle("#{{GLOBAL_STYLE}}");
  }
  catch(err) {
    console.error("Fatal error:", err);
    return;
  }
}

init();
