import { buildNumber, scriptInfo } from "./constants";
import { initializeAllAddons, initializeUserHash } from "./core";
import { addStyle, domLoaded, Logger } from "./utils";

import oprToolsCore from "./scripts/opr-tools-core";
import nominationStats from "./scripts/nomination-stats";
import nominationMap from "./scripts/nomination-map";
import reviewHistory from "./scripts/review-history";
import keyboardReview from "./scripts/keyboard-review";
import openIn from "./scripts/open-in";
import reviewTimer from "./scripts/review-timer";
import extendedStats from "./scripts/extended-stats";
import nominationStatusHistory from "./scripts/nomination-status-history";
import reviewMapMods from "./scripts/review-map-mods";
import reviewCounter from "./scripts/review-counter";
import emlImporter from "./scripts/eml-importer";

const availableAddons = [
  oprToolsCore,
  nominationStats,
  nominationMap,
  reviewHistory,
  keyboardReview,
  openIn,
  reviewTimer,
  extendedStats,
  nominationStatusHistory,
  reviewMapMods,
  reviewCounter,
  emlImporter,
];

/** Runs when the userscript is loaded initially */
function init() {
  if (domLoaded) run();
  else document.addEventListener("DOMContentLoaded", run);
}

/** Runs after the DOM is available */
function run() {
  const logger = new Logger("setup");
  try {
    logger.info(`Initializing ${scriptInfo.name} v${scriptInfo.version} (#${buildNumber})...`);
    initializeUserHash().then((userHash: number) => {
      logger.info(`Initializing OPR Tools for user hash ${userHash}`);
      for (const addon of availableAddons) addon();
      logger.info("Addons registered.");
      initializeAllAddons();
    }).catch(logger.error);

    // post-build these double quotes are replaced by backticks (because if backticks are used here, the bundler converts them to double quotes)
    addStyle("#{{GLOBAL_STYLE}}");
  }
  catch(err) {
    logger.error("Fatal error:", err);
    return;
  }
}

init();
