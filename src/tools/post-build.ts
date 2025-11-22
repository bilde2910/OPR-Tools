import { access, readFile, writeFile, constants as fsconst } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { outputDir as rollupCfgOutputDir, outputFile as rollupCfgOutputFile } from "../../rollup.config.mjs";
import { baseUrl, getLastCommitSha, mode, userscriptDistFile, userscriptMetaFile } from "./build-utils.mjs";

//#MARKER settings:

type BuildStats = {
  sizeKiB: number;
  mode: string;
  timestamp: number;
};

const buildTs = Date.now();

const { env, exit } = process;

const envPort = Number(env.DEV_SERVER_PORT);
/** HTTP port of the dev server */
const devServerPort = isNaN(envPort) || envPort === 0 ? 8710 : envPort;
const devServerUserscriptUrl = `http://localhost:${devServerPort}/${rollupCfgOutputFile.replace(/\s/g, "%20")}`;

const distFolderPath = `./${rollupCfgOutputDir}/`;

/** Whether to trigger the bell sound in some terminals when the code has finished compiling */
const ringBell = Boolean(env.RING_BELL && (env.RING_BELL.length > 0 && env.RING_BELL.trim().toLowerCase() === "true"));

void (async () => {
  // Binary encoding of geofence data
  // Disabled because apparently this is VERY SLOW on browsers
  // await convertGeofences();

  const buildNbr = await getLastCommitSha();

  try {
    const rootPath = join(dirname(fileURLToPath(import.meta.url)), "../../");
    const scriptPath = join(rootPath, distFolderPath, userscriptDistFile);
    const metaPath = join(rootPath, distFolderPath, userscriptMetaFile);
    const globalStylePath = join(rootPath, distFolderPath, "global.css");

    // Read userscript
    let globalStyle = String(await readFile(globalStylePath));
    let userscript = String(await readFile(scriptPath));

    // Remove BOM from stylesheet
    if (globalStyle?.startsWith("\uFEFF")) globalStyle = globalStyle.substring(1);
    // Inject stylesheet into footer IIFE
    userscript = userscript.replace(/"(\/\*)?#{{GLOBAL_STYLE}}(\*\/)?"/gm, `\`${globalStyle}\``);
    // Sourcemap URL must be fixed
    userscript = userscript.replace(/sourceMappingURL=/gm, `sourceMappingURL=${baseUrl}/`);
    // Add trailing newline
    userscript += "\n";

    const readHeader = userscript.substring(0, userscript.indexOf("\r\n\r\n")) + "\r\n";
    await writeFile(scriptPath, userscript);
    await writeFile(metaPath, readHeader);

    const envText = `${mode === "production" ? "\x1b[32m" : "\x1b[33m"}${mode}`;
    const sizeKiB = Number((Buffer.byteLength(userscript, "utf8") / 1024).toFixed(2));

    let buildStats: Partial<BuildStats> = {};
    if (await exists(".build.json")) {
      try {
        buildStats = JSON.parse(String(await readFile(".build.json"))) as BuildStats;
      } catch(e) { void e; }
    }

    let sizeIndicator = "";
    if (buildStats.sizeKiB) {
      const sizeDiff = sizeKiB - buildStats.sizeKiB;
      sizeIndicator = " \x1b[2m[\x1b[0m\x1b[1m" + (sizeDiff > 0 ? "\x1b[33m↑↑↑" : (sizeDiff !== 0 ? "\x1b[32m↓↓↓" : "\x1b[32m===")) + "\x1b[0m\x1b[2m]\x1b[0m";
    }

    console.info();
    console.info(`Successfully built for ${envText}\x1b[0m - build number (last commit SHA): ${buildNbr}`);
    console.info(`Outputted file '${relative("./", scriptPath)}' with a size of \x1b[32m${sizeKiB} KiB\x1b[0m${sizeIndicator}`);
    console.info(`Userscript URL: \x1b[34m\x1b[4m${devServerUserscriptUrl}\x1b[0m`);
    console.info();

    if (ringBell) process.stdout.write("\u0007");

    const buildStatsNew: BuildStats = {
      sizeKiB,
      mode,
      timestamp: buildTs,
    };
    await writeFile(".build.json", JSON.stringify(buildStatsNew));

    // schedule exit after I/O finishes
    setImmediate(() => exit(0));
  }
  catch(err) {
    console.error("\x1b[31mError while adding userscript header:\x1b[0m");
    console.error(err);

    // schedule exit after I/O finishes
    setImmediate(() => exit(1));
  }
})();

/*async function convertGeofences() {
  console.log("Compressing geofence data...");
  const rootPath = join(dirname(fileURLToPath(import.meta.url)), "../../");
  const inPath = join(rootPath, assetFolderPath, "geofences.json");
  const outPath = join(rootPath, assetFolderPath, "geofences.bin.gz");
  const fences = JSON.parse(String(await readFile(inPath))) as GeofenceMap;
  const binData: ArrayBuffer[] = [];
  for (const [zone, points] of Object.entries(fences)) {
    const zBytes = new TextEncoder().encode(zone);
    const zLength = new Uint8Array([zBytes.length]);
    const pLength = new Uint32Array([points.length]);
    binData.push(zLength.buffer, zBytes.buffer, pLength.buffer);
    for (const [lat, lng] of points) {
      binData.push(new Float32Array([lat, lng]).buffer);
    }
  }
  const blob = new Blob(binData, { type: "application/octet-stream" });
  const buffer = Buffer.from(await blob.arrayBuffer());
  // Brotli brings it down to 490 kB vs 723 kB for gzip, but we can't
  // use it because it's non-standard and not supported in browsers.
  // const compress = zlib.createBrotliCompress();
  const compress = zlib.createGzip();
  const writeStream = createWriteStream(outPath);
  const stream = Readable.from(buffer).pipe(compress).pipe(writeStream);
  await new Promise<void>((resolve) => stream.on("finish", resolve));
  console.log("Compression done.");
}*/

/** Checks whether the given path exists and has read and write permissions (by default) */
async function exists(path: string, mode = fsconst.R_OK | fsconst.W_OK) {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}
