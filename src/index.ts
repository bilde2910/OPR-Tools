import { buildNumber, scriptInfo } from "./constants";
import { _setUserHash, addStyle, cyrb53, domLoaded, interceptJson } from "./utils";
import { UserProperties } from "./types";

import nominationStats from "./scripts/nomination-stats";
import nominationMap from "./scripts/nomination-map";

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

    interceptJson("GET", "/api/v1/vault/properties", (props: UserProperties) => {
      const userHash = props.socialProfile?.email ? cyrb53(props.socialProfile.email) : 0;
      _setUserHash(userHash);
      console.log(`Initializing OPR Tools for user hash ${userHash}`);
      // TODO: Allow users to toggle which scripts are active using a settings pane
      nominationStats();
      nominationMap();
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
