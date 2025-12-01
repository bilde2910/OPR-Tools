import { scriptInfo } from "./constants";
import { initializeAllAddons, initializeUserHash } from "./core";
import { domLoaded, Logger } from "./utils";

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
import wayfarerContributionImporter from "./scripts/wayfarer-contribution-importer";
import gmailGasImporter from "./scripts/gmail-gas-importer";
import appealTimer from "./scripts/appeal-timer";
import contributionManagementLayout from "./scripts/contribution-management-layout";
import totalReconExporter from "./scripts/total-recon-exporter";
import autoHold from "./scripts/auto-hold";
import dynamicMapsEverywhere from "./scripts/dynamic-maps-everywhere";
import widescreenReview from "./scripts/widescreen-review";
import betterDiff from "./scripts/better-diff";

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
  gmailGasImporter,
  appealTimer,
  contributionManagementLayout,
  totalReconExporter,
  autoHold,
  dynamicMapsEverywhere,
  widescreenReview,
  betterDiff,
  // Uses filterSend, must be loaded last
  wayfarerContributionImporter,
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
    logger.info(`Initializing ${scriptInfo.name} v${scriptInfo.version}...`);
    initializeUserHash().then((userHash: number) => {
      logger.info(`Initializing OPR Tools for user hash ${userHash}`);
      for (const addon of availableAddons) addon();
      logger.info("Addons registered.");
      initializeAllAddons();
    }).catch(logger.error);
  }
  catch(err) {
    logger.error("Fatal error:", err);
    return;
  }
}

init();
