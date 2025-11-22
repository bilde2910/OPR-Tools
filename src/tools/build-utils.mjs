import { exec } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import pkg from "../../package.json" with { type: "json" };

/**
 * "development" or "production" - similar to NODE_ENV
 * @type {"development" | "production"}
 */
export const mode = getCliArg("mode", "development");

/**
 * Where the userscript will be hosted
 * @type {"dev" | "github" | "varden"}
 */
const host = getCliArg("host", "dev");

/**
 * The branch on GitHub to use for various URLs
 * @type {"main"}
 */
const branch = getCliArg("branch", (mode === "production" ? "main" : "develop"));

/**
 * Optional prefix to add between the script name and the file extension
 * @type {string}
 */
const suffix = getCliArg("suffix", "");

/**
 * Path to the GitHub repo in the format "User/Repo"
 */
const repo = "bilde2910/OPR-Tools";

/**
 * Name of the emitted userscript file
 */
export const userscriptDistFile = `${pkg.name}${suffix}.user.js`;
export const userscriptMetaFile = `${pkg.name}${suffix}.meta.js`;

const resourcesFile = "./assets/resources.json";
const requiresFile = "./assets/require.json";

//

/** URL that links directly to the file to update the userscript from */
export const baseUrl = (() => {
  switch(host) {
  case "github":
    return `https://raw.githubusercontent.com/${repo}/${branch}/dist`;
  case "varden":
    return "https://static.varden.info/opr-tools/dist";
  case "dev":
  default:
    return "http://localhost:8710";
  }
})();

const scriptUrl = `${baseUrl}/${userscriptDistFile}`;
const metaUrl = `${baseUrl}/${userscriptMetaFile}`;
const assetBaseUrl = `${baseUrl}/assets`;

/**
 * Used as a kind of "build number", though note it is always behind by at least one commit,
 * as the act of putting this number in the userscript and committing it changes the hash again, indefinitely
 * @returns {Promise<string>}
 */
export function getLastCommitSha() {
  return new Promise((res, rej) => {
    exec("git rev-parse --short HEAD", (err, stdout, stderr) => {
      if(err) {
        console.error("\x1b[31mError while checking for last Git commit. Do you have Git installed?\x1b[0m\n", stderr);
        return rej(err);
      }
      return res(String(stdout).replace(/\r?\n/gm, "").trim());
    });
  });
}

/**
 * Returns the value of a CLI argument (in the format `--arg=<value>`) or the value of `defaultVal` if it doesn't exist
 * @param {string} name
 * @param {string} defaultVal
 */
function getCliArg(name, defaultVal) {
  const arg = process.argv.find((v) => v.trim().match(new RegExp(`^(--)?${name}=.+$`, "i")));
  const val = arg?.split("=")?.[1];
  return (val && val.length > 0 ? val : defaultVal)?.trim();
}

/**
 * Returns a string of resource directives, as defined in `assets/resources.json` or undefined if the file doesn't exist or is invalid
 * @param {string} buildNbr
 * @returns {string}
 */
async function getResourceDirectives(buildNbr) {
  try {
    /** @type {string[]} */
    const directives = [];
    /** @type {Record<string, string>} */
    const resources = JSON.parse(String(await readFile(resourcesFile)));

    let longestName = 0;
    for(const name of Object.keys(resources))
      longestName = Math.max(longestName, name.length);

    for(const [name, path] of Object.entries(resources)) {
      const bufferSpace = " ".repeat(longestName - name.length);
      directives.push(`// @resource          ${name}${bufferSpace} ${
        path.match(/^https?:\/\//)
          ? path
          : getResourceUrl(path, buildNbr)
      }`);
    }

    return directives.join("\n");
  }
  catch(err) {
    console.warn("No resource directives found:", err);
  }
}

/**
 * Returns a string of require directives, as defined in `assets/require.json` or undefined if there are no entries
 */
async function getRequireDirectives() {
  /** @type {string[]} */
  const directives = [];
  const requireFile = String(await readFile(requiresFile));
  /** @type {import("./build-types").RequireObj[]} */
  const require = JSON.parse(requireFile);

  for (const entry of require) {
    if ("link" in entry && entry.link === true) continue;
    if ("pkgName" in entry) directives.push(getRequireEntry(entry));
    if ("url" in entry) directives.push(`// @require           ${entry.url}`);
  }

  return directives.length > 0 ? directives.join("\n") : undefined;
}

/**
 * @param {import("./build-types").RequireObjPkg} entry 
 * @returns 
 */
function getRequireEntry(entry) {
  const baseUrl = entry.baseUrl ?? "https://cdn.jsdelivr.net/npm/";

  /** @type {string} */
  let version;
  const deps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  if (entry.pkgName in deps) {
    version = deps[entry.pkgName].replace(/[^0-9.]/g, "");
  } else {
    throw new Error(`Library '${entry.pkgName}', referenced in 'assets/require.json' not found in dependencies or devDependencies. Make sure to install it with 'npm i ${entry.pkgName}'!`);
  }

  return `// @require           ${baseUrl}${entry.pkgName}@${version}${entry.path ? `${entry.path.startsWith("/") ? "" : "/"}${entry.path}` : ""}`;
}

/**
 * Returns the full URL for a given resource path, based on the current mode and branch
 * @param {string} path
 * @param {string | undefined} buildToken
 */
function getResourceUrl(path, buildToken) {
  return `${assetBaseUrl}/${path}?b=${buildToken ?? pkg.version}`;
}

export async function makeUserscriptHeader() {
  // Use random UUID to force the browser and userscript extension to refresh resources
  const buildNbr = mode === "development" ? randomUUID() : await getLastCommitSha();
  const buildVer = await getVersion();

  const resourcesDirectives = await getResourceDirectives(buildNbr);
  const requireDirectives = await getRequireDirectives();

  return `// ==UserScript==
// @name              ${pkg.userscriptName}
// @namespace         ${pkg.homepage}
// @version           ${buildVer}
// @description       ${pkg.description}
// @homepageURL       ${pkg.homepage}#readme
// @supportURL        ${pkg.bugs.url}
// @license           ${pkg.license}
// @author            ${pkg.author.name}
// @copyright         ${pkg.author.name} (${pkg.author.url})
// @icon              ${getResourceUrl("images/logo_48.png", buildNbr)}
// @match             https://opr.ingress.com/*
// @downloadURL       ${scriptUrl}
// @updateURL         ${metaUrl}
// @grant             GM.getResourceUrl
// @grant             GM.xmlHttpRequest
// @grant             GM.openInTab
// @noframes\
${resourcesDirectives ? "\n" + resourcesDirectives : ""}\
${requireDirectives ? "\n" + requireDirectives : ""}
// ==/UserScript==

`.split("\n").join("\r\n");
};

function getVersion() {
  return new Promise((res, rej) => {
    exec("git describe --long --tags | sed 's/^v//;s/\\([^-]*-g\\)/r\\1/;s/-/./g'", (err, stdout, stderr) => {
      if(err) {
        console.error("\x1b[31mError while checking for last Git tag. Do you have Git installed?\x1b[0m\n", stderr);
        return rej(err);
      }
      return res(String(stdout).replace(/\r?\n/gm, "").trim());
    });
  });
}
