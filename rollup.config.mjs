import pluginTypeScript from "@rollup/plugin-typescript";
import pluginNodeResolve from "@rollup/plugin-node-resolve";
import pluginJson from "@rollup/plugin-json";
import pluginScss from "rollup-plugin-scss";
import pluginExecute from "rollup-plugin-execute";
import pluginUrl from "@rollup/plugin-url";
import typescript from "typescript";

import pkg from "./package.json" with { type: "json" };
import requireJson from "./assets/require.json" with { type: "json" };
import { makeUserscriptHeader } from "./src/tools/build-utils.mjs";

const globalPkgs = requireJson.reduce((acc, pkg) => {
  acc[pkg.pkgName] = pkg.global;
  return acc;
}, {});

const externalPkgs = requireJson.map(pkg => pkg.pkgName);

const outputDir = "dist";
const outputFile = getOutputFileName();

/** @param {string} [suffix] */
function getOutputFileName(suffix) {
  return `${pkg.name}${suffix ?? ""}.user.js`;
}

export default (/**@type {import("./src/types").RollupArgs}*/ args) => (async () => {
  /** @type {import("./src/types").RollupArgs} */
  const passCliArgs = {
    mode: args["config-mode"] ?? (process.env.NODE_ENV === "production" ? "production" : "development"),
    host: args["config-host"] ?? "github",
    assetSource: args["config-assetSource"] ?? "github",
    suffix: args["config-suffix"] ?? "",
  };
  const passCliArgsStr = Object.entries(passCliArgs).map(([key, value]) => `--${key}=${value}`).join(" ");

  const { suffix } = passCliArgs;

  const linkedPkgs = requireJson.filter((pkg) => pkg.link === true);

  // Make style injection a separate IIFE in the output footer.
  // The GLOBAL_STYLE is inserted into the script by post-build.ts, and having it be part of the
  // normal userscript body would mess up sourcemaps, as post-build.ts is not sourcemap-aware.
  const footerIIFE = `
(() => {
  const addStyle = () => {
    const elem = document.createElement("style");
    elem.innerHTML = ("#{{GLOBAL_STYLE}}");
    document.querySelector("head")?.appendChild(elem);
    return elem;
  };
  if (document.readyState === "complete" || document.readyState === "interactive") addStyle();
  else document.addEventListener("DOMContentLoaded", addStyle);
})();
  `;

  /** @type {import("rollup").RollupOptions} */
  const config = {
    input: "src/index.ts",
    plugins: [
      pluginNodeResolve({
        extensions: [".ts", ".mts", ".json"],
      }),
      pluginTypeScript({
        typescript,
        sourceMap: true,
        compilerOptions: {
          outDir: outputDir,
        },
      }),
      pluginUrl({
        include: ["assets/**/*"],
      }),
      pluginJson(),
      pluginScss({
        fileName: "global.css",
        outputStyle: "compressed",
      }),
      pluginExecute([
        `npm run --silent post-build -- ${passCliArgsStr}`,
        // #MARKER run own commands after build:
        // ...(mode === "development" ? ["npm run --silent invisible -- \"echo 'dev-only command'\""] : []),
      ]),
    ],
    output: {
      file: `${outputDir}/${getOutputFileName(suffix)}`,
      format: "iife",
      sourcemap: true,
      compact: true,
      banner: await makeUserscriptHeader(),
      footer: footerIIFE,
      globals: linkedPkgs.length > 0 ? Object.fromEntries(
        Object.entries(globalPkgs).filter(([key]) => !linkedPkgs.some((pkg) => pkg.pkgName === key))
      ) : globalPkgs,
    },
    onwarn(warning) {
      // ignore circular dependency warnings
      if(warning.code !== "CIRCULAR_DEPENDENCY") {
        const { message, ...rest } = warning;
        console.error(`\x1b[33m(!)\x1b[0m ${message}\n`, rest);
      }
    },
    external: linkedPkgs.length > 0 ? externalPkgs.filter(p => !linkedPkgs.map(lp => lp.pkgName).includes(p)) : externalPkgs,
  };

  return config;
})();

export { outputDir, outputFile };
