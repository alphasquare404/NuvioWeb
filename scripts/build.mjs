import { remuxLibraryPolicy } from "./remuxLibraryPolicy.mjs";
import { cp, mkdir, readFile, rm, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import coreJsCompat from "core-js-compat";
import postcssGlobalData from "@csstools/postcss-global-data";
import postcss from "postcss";
import cssnano from "cssnano";
import autoprefixer from "autoprefixer";
import { readAppMetadata, syncVersionFiles } from "./appMetadata.mjs";
import { browserCompatibilityPolicy } from "./browserCompatibilityPolicy.mjs";
import { readEnvProperties, writeRuntimeEnvScriptFile } from "./envProperties.mjs";
import { buildServiceWorkerCacheId } from "./serviceWorkerCacheId.mjs";
import { assetBuildId, versionAssetUrls } from "./assetVersions.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
let remuxAssetId = "dev";
let pluginWorkerPath = "";
const requireConfiguredRuntimeEnv = /^(1|true|yes|on)$/i.test(
  String(process.env.NUVIO_REQUIRE_LOCAL_PROPERTIES || "")
);
const debugBundle = /^(1|true|yes|on)$/i.test(String(process.env.NUVIO_DEBUG_BUNDLE || ""));
if (process.argv.slice(2).some((arg) => String(arg || "").startsWith("--target="))) {
  throw new Error("NuvioWeb builds browser/PWA artifacts only.");
}
const browserViewport = {
  width: 1920,
  height: 1080,
  remPx: 20
};
const rgbVariableFallbacks = {
  "--bg-color-rgb": "13 13 13",
  "--bg-elevated-rgb": "26 26 26",
  "--card-bg-rgb": "34 34 34",
  "--secondary-color-rgb": "245 245 245",
  "--focus-color-rgb": "255 255 255"
};

function splitTopLevelSpaces(value) {
  const parts = [];
  let current = "";
  let depth = 0;

  for (const char of value) {
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    }

    if (/\s/.test(char) && depth === 0) {
      if (current.trim()) {
        parts.push(current.trim());
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function splitFunctionArgs(value) {
  const args = [];
  let current = "";
  let depth = 0;

  for (const char of value) {
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    }

    if (char === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    args.push(current.trim());
  }

  return args;
}

function toLegacyLengthValue(value) {
  let result = value.trim();
  let changed = true;

  while (changed) {
    changed = false;
    result = result.replace(
      /\b(min|max|clamp)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g,
      (match, fn, argsText) => {
        const args = splitFunctionArgs(argsText).map(toLegacyLengthValue);
        const computed = computeLegacyMathValue(fn, args);
        const replacement =
          computed ||
          (fn === "clamp" ? args[2] || args[1] || args[0] : chooseStaticMathFallback(fn, args));
        changed = true;
        return replacement || match;
      }
    );
  }

  return result;
}

function parseLengthToPx(value) {
  const match = String(value || "")
    .trim()
    .match(/^(-?\d*\.?\d+)(px|vw|vh|rem)$/i);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(amount)) {
    return null;
  }
  if (unit === "px") {
    return amount;
  }
  if (unit === "vw") {
    return (amount * browserViewport.width) / 100;
  }
  if (unit === "vh") {
    return (amount * browserViewport.height) / 100;
  }
  if (unit === "rem") {
    return amount * browserViewport.remPx;
  }
  return null;
}

function formatPx(value) {
  const rounded = Math.round(value * 1000) / 1000;
  return `${String(rounded)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1")}px`;
}

function computeLegacyMathValue(fn, args) {
  const values = args.map(parseLengthToPx);
  if (values.some((value) => value === null)) {
    return "";
  }

  if (fn === "min") {
    return formatPx(Math.min(...values));
  }
  if (fn === "max") {
    return formatPx(Math.max(...values));
  }
  if (fn === "clamp") {
    const min = values[0];
    const preferred = values[1] ?? min;
    const max = values[2] ?? preferred;
    return formatPx(Math.max(min, Math.min(max, preferred)));
  }
  return "";
}

function chooseStaticMathFallback(fn, args) {
  const parseable = args
    .map((value) => ({ value, px: parseLengthToPx(value) }))
    .filter((entry) => entry.px !== null);
  if (!parseable.length) {
    return args[args.length - 1] || "";
  }
  if (fn === "max") {
    return parseable.reduce((max, entry) => (entry.px > max.px ? entry : max), parseable[0]).value;
  }
  if (fn === "min") {
    return parseable.reduce((min, entry) => (entry.px < min.px ? entry : min), parseable[0]).value;
  }
  return args[2] || args[1] || args[0] || "";
}

function splitRgbChannels(channels) {
  const parts = String(channels || "")
    .trim()
    .split(/\s+/)
    .map((part) => Number(part));
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  return parts.slice(0, 3);
}

function toLegacyColorValue(value) {
  let result = String(value || "");

  result = result.replace(
    /\brgba?\(\s*var\((--[\w-]+)\)\s*\/\s*([^)]+?)\s*\)/g,
    (match, variableName, alpha) => {
      const channels = splitRgbChannels(rgbVariableFallbacks[variableName]);
      if (!channels) {
        return match;
      }
      return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha.trim()})`;
    }
  );

  result = result.replace(
    /\brgba?\(\s*(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s*\/\s*([^)]+?)\s*\)/g,
    (_match, red, green, blue, alpha) => `rgba(${red}, ${green}, ${blue}, ${alpha.trim()})`
  );

  return result;
}

function insertInsetFallbacks(decl) {
  if (decl.prop.toLowerCase() !== "inset") {
    return;
  }

  const values = splitTopLevelSpaces(decl.value);
  if (!values.length || values.length > 4) {
    return;
  }

  const top = values[0];
  const right = values[1] || top;
  const bottom = values[2] || top;
  const left = values[3] || right;
  const fallbacks = [
    ["top", top],
    ["right", right],
    ["bottom", bottom],
    ["left", left]
  ];

  for (const [prop, value] of fallbacks) {
    decl.cloneBefore({ prop, value });
  }
}

function legacyDeclarationFallbackPlugin() {
  return {
    postcssPlugin: "nuvio-legacy-declaration-fallbacks",
    Declaration(decl) {
      insertInsetFallbacks(decl);

      const legacyValue = toLegacyColorValue(toLegacyLengthValue(decl.value));
      if (legacyValue && legacyValue !== decl.value) {
        const previous = decl.prev();
        if (
          !previous ||
          previous.type !== "decl" ||
          previous.prop !== decl.prop ||
          previous.value !== legacyValue
        ) {
          decl.cloneBefore({ value: legacyValue });
        }
      }
    }
  };
}

legacyDeclarationFallbackPlugin.postcss = true;

function unsupportedSelectorFallbackPlugin() {
  return {
    postcssPlugin: "nuvio-unsupported-selector-fallbacks",
    Rule(rule) {
      if (!rule.selector || !rule.selectors?.length) {
        return;
      }

      const safeSelectors = rule.selectors.filter(
        (selector) => !selector.includes(":focus-visible") && !selector.includes(":has(")
      );
      if (!safeSelectors.length || safeSelectors.length === rule.selectors.length) {
        return;
      }

      const fallback = rule.clone({ selectors: safeSelectors });
      rule.before(fallback);
    }
  };
}

unsupportedSelectorFallbackPlugin.postcss = true;

function flexGapFallbackPlugin() {
  return {
    postcssPlugin: "nuvio-flex-gap-fallback",
    Rule(rule) {
      if (
        !rule.selector ||
        (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name))
      ) {
        return;
      }

      let displayFlex = false;
      let rowGap = null;
      let columnGap = null;
      let flexDirection = "row";
      let flexWrap = "nowrap";

      rule.walkDecls((decl) => {
        const prop = decl.prop.toLowerCase();
        if (prop === "display" && /\b(?:inline-)?flex\b/.test(decl.value)) {
          displayFlex = true;
          return;
        }

        if (prop === "flex-direction") {
          flexDirection = decl.value.toLowerCase();
          return;
        }

        if (prop === "flex-wrap") {
          flexWrap = decl.value.toLowerCase();
          return;
        }

        if (prop === "flex-flow") {
          const value = decl.value.toLowerCase();
          if (value.includes("column")) {
            flexDirection = "column";
          }
          if (value.includes("wrap")) {
            flexWrap = "wrap";
          }
          return;
        }

        if (prop === "gap") {
          const values = splitTopLevelSpaces(decl.value).map(toLegacyLengthValue);
          rowGap = values[0] || "0";
          columnGap = values[1] || rowGap;
          return;
        }

        if (prop === "row-gap") {
          rowGap = toLegacyLengthValue(decl.value);
          return;
        }

        if (prop === "column-gap") {
          columnGap = toLegacyLengthValue(decl.value);
        }
      });

      if (!displayFlex || (!rowGap && !columnGap)) {
        return;
      }

      rowGap ||= "0";
      columnGap ||= "0";

      const scopedSelectors = rule.selectors.map((selector) => `html.no-flex-gap ${selector}`);
      const isColumnDirection = flexDirection.includes("column");
      const wraps = flexWrap.includes("wrap") && !flexWrap.includes("nowrap");
      const childFallback = postcss.rule({
        selectors: scopedSelectors.map((selector) => `${selector} > * + *`)
      });

      if (isColumnDirection) {
        childFallback.append({ prop: "margin-top", value: rowGap });
      } else if (wraps) {
        childFallback.selectors = scopedSelectors.map((selector) => `${selector} > *`);
        childFallback.append({ prop: "margin-right", value: columnGap });
        childFallback.append({ prop: "margin-bottom", value: rowGap });
      } else {
        childFallback.append({ prop: "margin-left", value: columnGap });
      }

      rule.after(childFallback);
    }
  };
}

flexGapFallbackPlugin.postcss = true;

async function buildCSS() {
  console.log("processing CSS with PostCSS (legacy support)...");
  const cssDir = path.join(rootDir, "css");
  const files = await readdir(cssDir);
  const cssFiles = files.filter((f) => f.endsWith(".css"));

  for (const file of cssFiles) {
    const cssPath = path.join(cssDir, file);
    const outPath = path.join(distDir, "css", file);

    const css = await readFile(cssPath, "utf8");
    const result = await postcss([
      postcssGlobalData({ files: [path.join(cssDir, "base.css")] }),
      autoprefixer({
        overrideBrowserslist: [`Chrome ${browserCompatibilityPolicy.chromiumVersion}`],
        grid: "autoplace"
      }),
      legacyDeclarationFallbackPlugin(),
      unsupportedSelectorFallbackPlugin(),
      flexGapFallbackPlugin(),
      cssnano()
    ]).process(css, { from: cssPath, to: outPath });

    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, result.css);
  }
}

async function buildCoreJsBundle() {
  console.log("building core-js bundle...");
  const { list: requiredModules } = coreJsCompat({
    modules: ["core-js/stable"],
    targets: { chrome: String(browserCompatibilityPolicy.chromiumVersion) }
  });
  if (requiredModules.length === 0) {
    throw new Error("Core-js compatibility query returned no required modules.");
  }
  await build({
    stdin: {
      contents: requiredModules
        .map((moduleName) => `import "core-js/modules/${moduleName}.js";`)
        .join("\n"),
      resolveDir: rootDir,
      sourcefile: "core-js-entry.js"
    },
    outfile: path.join(distDir, "core-js.bundle.js"),
    bundle: true,
    format: "iife",
    minify: !debugBundle,
    target: [`chrome${browserCompatibilityPolicy.chromiumVersion}`],
    legalComments: "none"
  });
}

async function buildPluginWorker() {
  const dependencies = path.join(rootDir, "node_modules");
  const quickJsPath = path.join(dependencies, "quickjs-emscripten", "dist", "index.global.js");
  const quickJs = await readFile(quickJsPath);
  const cryptoJs = await readFile(path.join(dependencies, "crypto-js", "crypto-js.js"), "utf8");
  const result = await build({
    entryPoints: [path.join(rootDir, "js", "core", "player", "pluginWorker.js")],
    bundle: true,
    platform: "browser",
    format: "iife",
    write: false,
    minify: !debugBundle,
    target: [`chrome${browserCompatibilityPolicy.chromiumVersion}`],
    define: { __NUVIO_CRYPTO_JS_SOURCE__: JSON.stringify(cryptoJs) }
  });
  const worker = result.outputFiles[0].contents;
  const assetId = assetBuildId(Buffer.concat([worker, quickJs]));
  const directory = `assets/plugins/${assetId}`;
  pluginWorkerPath = `${directory}/runtime/plugin-worker.js`;
  const libs = path.join(distDir, directory, "libs");
  await mkdir(path.join(distDir, directory, "runtime"), { recursive: true });
  await mkdir(libs, { recursive: true });
  await Promise.all([
    writeFile(path.join(distDir, pluginWorkerPath), worker),
    writeFile(path.join(libs, "quickjs-emscripten.global.js"), quickJs),
    cp(
      path.join(dependencies, "quickjs-emscripten", "LICENSE"),
      path.join(libs, "quickjs-emscripten.LICENSE")
    ),
    cp(path.join(dependencies, "crypto-js", "LICENSE"), path.join(libs, "crypto-js.LICENSE"))
  ]);
}

async function buildBundle() {
  const { version, identity } = await readAppMetadata();
  // The same values nuvio.env.js will carry, baked in as a fallback. That file
  // is served no-store and fetched separately, so anything that stops it
  // executing -- offline at the wrong moment, a cache miss, an insecure origin
  // where no service worker can stand in -- used to leave every config value
  // empty. An empty SUPABASE_URL then turns each cloud call into a relative
  // path that the page's own host answers with a 404, for the life of that
  // page, with no way back. The runtime file still wins whenever it loads, so
  // a redeployed container keeps overriding what was built in.
  const { env: buildEnv } = await readEnvProperties({ rootDir });

  console.log("starting bundle build...");
  const result = await build({
    entryPoints: [path.join(rootDir, "js/app.js")],
    outfile: path.join(distDir, "app.bundle.js"),
    bundle: true,
    minify: !debugBundle,
    format: "iife",
    sourcemap: debugBundle,
    target: [`chrome${browserCompatibilityPolicy.chromiumVersion}`],
    metafile: true,
    define: {
      "process.env.NODE_ENV": '"production"',
      __NUVIO_REMUX_ASSET_ID__: JSON.stringify(remuxAssetId),
      __NUVIO_PLUGIN_WORKER_PATH__: JSON.stringify(pluginWorkerPath),
      __NUVIO_APP_VERSION__: JSON.stringify(version),
      __NUVIO_APP_IDENTITY__: JSON.stringify(identity),
      __NUVIO_BUILD_ENV__: JSON.stringify(buildEnv),
      // Which build produced a log. The service worker serves a cached bundle
      // until it decides to update, so a device can be running an older build
      // than the one on the server -- and a log read without knowing which is
      // a log that proves nothing.
      __NUVIO_BUILD_STAMP__: JSON.stringify(new Date().toISOString())
    }
  });
  if (
    Object.keys(result.metafile.inputs).some((input) => input.includes("node_modules/core-js/"))
  ) {
    throw new Error("Application bundle must not contain core-js modules.");
  }
  console.log("bundle build complete");
}

async function collectLocaleAssets(directory, relativeDirectory = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const assets = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      assets.push(...(await collectLocaleAssets(absolutePath, relativePath)));
    } else if (entry.isFile() && /^(?:strings|string)\.xml$/i.test(entry.name)) {
      assets.push(`./res/${relativePath}`);
    }
  }
  return assets;
}

async function buildBrowserServiceWorker() {
  const { version } = await readAppMetadata();
  const source = await readFile(path.join(rootDir, "sw.js"), "utf8");
  const localeAssets = await collectLocaleAssets(path.join(rootDir, "res"));
  const substituted = source.replace("__NUVIO_LOCALE_ASSETS__", JSON.stringify(localeAssets));
  const cacheId = await buildServiceWorkerCacheId(substituted, version, (relative) =>
    readFile(path.join(distDir, relative)).catch(() => null)
  );
  await writeFile(
    path.join(distDir, "sw.js"),
    substituted.replaceAll("__NUVIO_APP_VERSION__", cacheId)
  );
  console.log(`service worker cache: nuvio-app-shell-${cacheId}`);
}

async function runBuild() {
  try {
    console.log("cleaning dist directory...");
    await rm(distDir, { recursive: true, force: true });
    await mkdir(distDir, { recursive: true });

    console.log("building version files...");
    await syncVersionFiles();
    await buildCSS();

    console.log("copying static assets...");
    await Promise.all([
      cp(path.join(rootDir, "assets"), path.join(distDir, "assets"), { recursive: true }),
      cp(path.join(rootDir, "res"), path.join(distDir, "res"), { recursive: true }),
      cp(path.join(rootDir, "boot-guard.js"), path.join(distDir, "boot-guard.js")),
      cp(
        path.join(rootDir, "docs", "youtube-proxy.html"),
        path.join(distDir, "youtube-proxy.html")
      ),
      cp(path.join(rootDir, "manifest.webmanifest"), path.join(distDir, "manifest.webmanifest"))
    ]);
    await buildCoreJsBundle();
    await Promise.all([
      cp(
        path.join(rootDir, "node_modules", "hls.js", "dist", "hls.min.js"),
        path.join(distDir, "assets", "libs", "hls.min.js")
      ),
      cp(
        path.join(rootDir, "node_modules", "hls.js", "LICENSE"),
        path.join(distDir, "assets", "libs", "hls.js.LICENSE")
      ),
      cp(
        path.join(rootDir, "node_modules", "dashjs", "dist", "dash.all.min.js"),
        path.join(distDir, "assets", "libs", "dash.all.min.js")
      ),
      cp(
        path.join(rootDir, "node_modules", "dashjs", "LICENSE.md"),
        path.join(distDir, "assets", "libs", "dashjs.LICENSE.md")
      )
    ]);
    await cp(
      path.join(rootDir, "node_modules", "libbitsub", "pkg", "libbitsub_bg.wasm"),
      path.join(distDir, "assets", "libs", "libbitsub_bg.wasm")
    );
    await cp(
      path.join(rootDir, "node_modules", "libbitsub", "LICENSE"),
      path.join(distDir, "assets", "libs", "libbitsub.LICENSE")
    );

    // Lazy client probe assets: never add the 31 MiB core to app-shell precache.
    const probeAssetDir = path.join(distDir, "assets", "libs", "ffprobe");
    await mkdir(probeAssetDir, { recursive: true });
    await Promise.all([
      cp(
        path.join(rootDir, "node_modules", "@ffmpeg", "core", "dist", "umd", "ffmpeg-core.js"),
        path.join(probeAssetDir, "ffmpeg-core.js")
      ),
      cp(
        path.join(rootDir, "node_modules", "@ffmpeg", "core", "dist", "umd", "ffmpeg-core.wasm"),
        path.join(probeAssetDir, "ffmpeg-core.wasm")
      ),
      cp(
        path.join(rootDir, "docs", "ffprobe-wasm-NOTICE.txt"),
        path.join(probeAssetDir, "NOTICE.txt")
      ),
      cp(
        path.join(rootDir, "docs", "ffprobe-wasm-COPYING.txt"),
        path.join(probeAssetDir, "COPYING.txt")
      ),
      build({
        entryPoints: [path.join(rootDir, "js", "core", "player", "ffprobeClientWorker.js")],
        outfile: path.join(probeAssetDir, "ffprobe-worker.js"),
        bundle: true,
        format: "iife",
        minify: true,
        target: ["safari15", "chrome80"]
      })
    ]);

    // Immutable directory binds the lazy runtime and both workers to one build.
    const remuxSourceDir = path.join(rootDir, "js/core/player/clientRemux");
    const remuxSources = (await readdir(remuxSourceDir))
      .filter((name) => name.endsWith(".mjs") && !name.endsWith(".test.mjs"))
      .sort();
    const softwareVideoDir = path.join(rootDir, "vendor/browser-video-decoder");
    const softwareVideoAssets = ["software-video.js", "software-video.wasm"];
    const remuxContents = await Promise.all(
      remuxSources.map((name) => readFile(path.join(remuxSourceDir, name)))
    );
    remuxAssetId = assetBuildId(
      Buffer.concat([
        ...remuxContents,
        ...(await Promise.all(
          softwareVideoAssets.map((name) => readFile(path.join(softwareVideoDir, name)))
        )),
        await readFile(path.join(rootDir, "scripts/remuxLibraryPolicy.mjs")),
        await readFile(path.join(rootDir, "package-lock.json"))
      ])
    );
    const remuxDir = path.join(distDir, "assets/libs/remux", remuxAssetId);
    await mkdir(remuxDir, { recursive: true });
    for (const [entry, outfile, format] of [
      ["clientRuntime.mjs", "client-runtime.js", "esm"],
      ["cacheWorker.mjs", "cache-worker.js", "esm"],
      ["subtitleWorker.mjs", "subtitle-worker.js", "iife"]
    ]) {
      await build({
        entryPoints: [path.join(remuxSourceDir, entry)],
        entryNames: outfile.replace(/\.js$/, ""),
        outdir: remuxDir,
        bundle: true,
        minify: true,
        format,
        splitting: entry === "cacheWorker.mjs",
        target: ["safari15", "chrome80"],
        define: { __NUVIO_REMUX_ASSET_ID__: JSON.stringify(remuxAssetId) },
        plugins: [
          remuxLibraryPolicy({
            onModifiedSource: (contents) =>
              writeFile(path.join(remuxDir, "mediabunny-matroska-demuxer.source.js"), contents)
          })
        ]
      });
    }
    await cp(
      path.join(rootDir, "node_modules/mediabunny/LICENSE"),
      path.join(remuxDir, "mediabunny.LICENSE")
    );

    for (const extension of ["ac3", "dts", "truehd", "aac-encoder", "prores"]) {
      for (const [file, suffix] of [
        ["LICENSE", "LICENSE"],
        ["README.md", "NOTICE.md"]
      ]) {
        await cp(
          path.join(rootDir, "node_modules/@mediabunny", extension, file),
          path.join(remuxDir, "mediabunny-" + extension + "." + suffix)
        );
      }
    }

    for (const name of [...softwareVideoAssets, "FFmpeg.LICENSE", "dav1d.LICENSE", "README.md"]) {
      await cp(
        path.join(softwareVideoDir, name),
        path.join(remuxDir, name === "README.md" ? "software-video.NOTICE.md" : name)
      );
    }
    const softwareVideoSources = path.join(remuxDir, "software-video-source");
    await mkdir(softwareVideoSources);
    for (const name of ["decoder.c", "build.sh", "emscripten.ini"]) {
      await cp(path.join(softwareVideoDir, name), path.join(softwareVideoSources, name));
    }
    const libavAudio = path.join(rootDir, "node_modules/@libav.js/variant-obsolete/dist");
    await Promise.all([
      cp(
        path.join(rootDir, "docs/browser-audio-wasm-NOTICE.txt"),
        path.join(remuxDir, "browser-audio-wasm-NOTICE.txt")
      ),
      cp(
        path.join(rootDir, "docs/browser-audio-wasm-LGPL-2.1.txt"),
        path.join(remuxDir, "browser-audio-wasm-LGPL-2.1.txt")
      ),
      cp(
        path.join(rootDir, "docs/ffprobe-wasm-COPYING.txt"),
        path.join(remuxDir, "browser-audio-wasm-GPL-2.0.txt")
      ),
      cp(
        path.join(libavAudio, "libav-6.10.9.0-obsolete.wasm.mjs"),
        path.join(remuxDir, "libav-audio-factory.js")
      ),
      cp(
        path.join(libavAudio, "libav-6.10.9.0-obsolete.wasm.wasm"),
        path.join(remuxDir, "libav-audio.wasm")
      ),
      cp(
        path.join(rootDir, "node_modules/@wasm-audio-decoders/aac/README.md"),
        path.join(remuxDir, "aac-decoder.README.md")
      )
    ]);

    // js bundle processing (final step to ensure all transformations are applied correctly and we end up with a single, minified bundle file)
    await buildPluginWorker();
    await buildBundle();

    const sourceIndex = await readFile(path.join(rootDir, "index.html"), "utf8");
    // The bundle carries no build in its name: versioned here, a reload asks for
    // files only this build has, and a frozen query can no longer hand a browser
    // the bundle it cached a week ago.
    const buildId = assetBuildId(await readFile(path.join(distDir, "app.bundle.js")));
    await writeFile(path.join(distDir, "index.html"), versionAssetUrls(sourceIndex, buildId));
    console.log(`asset build id: ${buildId}`);

    // After the shell it caches exists: the cache name is a hash of those files.
    await buildBrowserServiceWorker();

    console.log("configuring runtime env from local.properties...");
    const envResult = await writeRuntimeEnvScriptFile(path.join(distDir, "nuvio.env.js"), {
      rootDir
    });
    const envSourceBaseName = path.basename(envResult.sourcePath || "");
    const usingFallbackEnv =
      !envResult.sourcePath || envSourceBaseName === "local.example.properties";
    if (requireConfiguredRuntimeEnv && usingFallbackEnv) {
      throw new Error(
        "Configured runtime env is required for this build. Provide local.properties."
      );
    }
    if (!envResult.sourcePath) {
      console.warn("WARNING: generated default runtime env (unconfigured).");
    } else if (envSourceBaseName === "local.example.properties") {
      console.warn("WARNING: using local.example.properties as fallback.");
    }

    console.log(`\nbuild finished successfully in: ${distDir}`);
  } catch (error) {
    console.error("\nbuild failed:");
    console.error(error);
    process.exit(1);
  }
}

runBuild();
