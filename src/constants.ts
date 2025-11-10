const modeRaw = "#{{MODE}}";
const branchRaw = "#{{BRANCH}}";
const hostRaw = "#{{HOST}}";
const buildNumberRaw  = "#{{BUILD_NUMBER}}";

/** The mode in which the script was built (production or development) */
export const mode = (modeRaw.match(/^#{{.+}}$/) ? "production" : modeRaw) as "production" | "development";
/** The branch to use in various URLs that point to the GitHub repo */
export const branch = (branchRaw.match(/^#{{.+}}$/) ? "main" : branchRaw) as "main" | "develop";
/** Path to the GitHub repo in the format "User/Repo" */
export const repo = "bilde2910/OPR-Tools";
/** Which host the userscript was installed from */
export const host = (hostRaw.match(/^#{{.+}}$/) ? "github" : hostRaw) as "github" | "dev";
/** The build number of the userscript */
export const buildNumber = (buildNumberRaw.match(/^#{{.+}}$/) ? "BUILD_ERROR!" : buildNumberRaw) as string; // asserted as generic string instead of literal

/** Names of platforms by value of {@linkcode host} */
export const platformNames: Record<typeof host, string> = {
  github: "GitHub",
  dev: "Local development",
};

/** Info about the userscript, parsed from the userscript header (tools/post-build.js) */
export const scriptInfo = {
  name: GM.info.script.name,
  version: GM.info.script.version,
  namespace: GM.info.script.namespace,
} as const;
