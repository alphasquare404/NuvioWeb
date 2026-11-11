import http from "node:http";
import os from "node:os";
import {
  normalizeProbeMode,
  normalizeClientProbeConcurrency
} from "../js/core/player/probeMode.js";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  FEATURE_DEFAULTS,
  FEATURE_SWITCHES,
  buildRuntimeEnvScript,
  isFeatureEnabled,
  parseProperties,
  readEnvProperties,
  resolveLocalPropertiesSource
} from "./envProperties.mjs";
import { createDebridApiBridgeHandler } from "../services/debrid-api-bridge/bridge.mjs";
import { createExternalReturnHandler } from "../services/external-return-bridge/bridge.mjs";
import { createTraktAuthBridgeHandler } from "../services/trakt-auth-bridge/bridge.mjs";
import { createIntrodbBridgeHandler } from "../services/introdb-bridge/bridge.mjs";
import { createRemuxBridgeHandler } from "../services/remux-bridge/bridge.mjs";
import { createProbeBridgeHandler } from "../services/probe-bridge/bridge.mjs";
import { createTranscodeBridgeHandler } from "../services/transcode-bridge/bridge.mjs";
import { inspectFFmpegRuntime, resolveFFmpegPath } from "../services/shared/ffmpegRuntime.mjs";

import { normalizeRemuxPolicy, normalizeRemuxCacheMiB } from "../js/core/player/remuxPolicy.js";

import { createMdbListBridgeHandler } from "../services/mdblist-bridge/bridge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 4173);
// Switches a deployment can flip without touching code. They are read here, at
// start-up, and are the runtime truth: a bridge that is off answers the same shape as
// one that was never built, so a client sees a clear "not offered" instead of a
// half-working endpoint. Endpoints in the bundle still decide whether the app *tries*.
const envFlag = (name, fallback = true) => {
  const raw = String(process.env[name] ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return fallback;
  return !["0", "false", "no", "off", "disabled"].includes(raw);
};
const { env: deploymentEnv } = await readEnvProperties({ rootDir });
const probeMode = normalizeProbeMode(
  process.env.PROBE_MODE ?? (process.env.PROBE_ENABLED == null ? deploymentEnv.PROBE_MODE : ""),
  process.env.PROBE_ENABLED
);
const rawRemuxMode = process.env.REMUX_MODE ?? deploymentEnv.REMUX_MODE ?? "";
const remuxPolicy = normalizeRemuxPolicy({
  mode: rawRemuxMode,
  endpoint: envFlag("REMUX_ENABLED", FEATURE_DEFAULTS.REMUX_ENABLED) ? "/api/remux" : ""
});
const transcodeMode = String(process.env.TRANSCODE_MODE ?? deploymentEnv.TRANSCODE_MODE ?? "")
  .trim()
  .toLowerCase();
const featureEnabled = {
  probe: probeMode === "server",
  remux: remuxPolicy.mode === "server",
  transcode:
    transcodeMode === "server" || envFlag("TRANSCODE_ENABLED", FEATURE_DEFAULTS.TRANSCODE_ENABLED)
};
const configuredFeatures = { ...featureEnabled };
const ffmpegRuntime =
  featureEnabled.remux || featureEnabled.transcode ? await inspectFFmpegRuntime() : null;
if (ffmpegRuntime) {
  featureEnabled.remux &&= ffmpegRuntime.remux;
  featureEnabled.transcode &&= ffmpegRuntime.audioTranscoding;
  console.log(
    `[ffmpeg] source=${ffmpegRuntime.source} available=${ffmpegRuntime.available} remux=${ffmpegRuntime.remux} audio=${ffmpegRuntime.audioTranscoding}`
  );
}
const ffmpegPath = ffmpegRuntime?.path || resolveFFmpegPath();
// The paths this server mounts. A feature that is on and not given an endpoint gets
// its own, which is what makes "probe is on by default" true without configuration.
const FEATURE_PATHS = {
  PROBE_ENDPOINT: "/api/probe",
  REMUX_ENDPOINT: "/api/remux",
  TRANSCODE_ENDPOINT: "/api/transcode"
};
function refuseDisabled(response, name) {
  response.writeHead(404, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify({ ok: false, error: "disabled", feature: name }));
}
// Said out loud at start-up: "which relays are on" is the first question an operator
// asks, and it used to be discoverable only by probing endpoints one by one.
console.log(
  `[relays] probe=${featureEnabled.probe} remux=${featureEnabled.remux} transcode=${featureEnabled.transcode}`
);
const mediaRuntimePath = path.join(rootDir, "services", "webos", "runtime", "media-http.cjs");
const mediaServerPorts = [2710, 2711, 2712, 2713, 2714];
const mediaProbeTimeoutMs = 1200;
let mediaRuntimeProcess = null;
let cachedMediaServerPort = mediaServerPorts[0];
const hostResolveEnabled = /^(1|true)$/i.test(
  String(
    process.env.MEDIA_URL_HOST_RESOLVE_ENABLED ?? deploymentEnv.MEDIA_URL_HOST_RESOLVE_ENABLED ?? ""
  ).trim()
);
const debridApiBridgeHandler = createDebridApiBridgeHandler({
  addonResolveEnabled: hostResolveEnabled,
  pluginRelay: {
    supabaseUrl: process.env.NUVIO_SUPABASE_URL || deploymentEnv.NUVIO_SUPABASE_URL,
    anonKey: process.env.NUVIO_SUPABASE_ANON_KEY || deploymentEnv.NUVIO_SUPABASE_ANON_KEY
  }
});
const externalReturnHandler = createExternalReturnHandler();
// The third bridge, mounted like the other two. It was the only one missing,
// so Trakt sign-in could be exercised in a container and nowhere else -- which
// is a poor place to find out that the bridge refuses every request.
const traktAuthBridgeHandler = createTraktAuthBridgeHandler();
// IntroDB serves its segments with Access-Control-Allow-Origin limited to its own
// site, so the browser cannot read them cross-origin. Mounted here for the same
// reason as the others: the deployed page is served by this process, which makes a
// relay on this origin the only way the data can reach a browser at all.
const introdbBridgeHandler = createIntrodbBridgeHandler();
// Safari cannot open an MKV because of the container, not the codec — measured, not
// assumed. This bridge moves the bytes into an MP4 so the built-in player can open
// them, and because it fetches the source itself, a CDN without CORS stops being an
// obstacle too.
// Which container and codecs a source really has, so the app can say how it will
// be played before anyone presses play.
const probeBridgeHandler = createProbeBridgeHandler({
  ffprobePath: process.env.FFPROBE_PATH || "ffprobe"
});
const remuxBridgeHandler = createRemuxBridgeHandler({
  ffmpegPath,
  ffmpegRuntime,
  // Deployment policy. One relay at a time by default: a remux is a copy of a whole
  // film, so the limit that matters on a home connection is how many run at once.
  ttlMs: Number(process.env.REMUX_TTL_MS ?? 15 * 60 * 1000) || 0,
  finishedTtlMs: Number(process.env.REMUX_FINISHED_TTL_MS ?? 3 * 60 * 60 * 1000) || 0,
  maxConcurrent: Number(process.env.REMUX_MAX_CONCURRENT ?? 1) || 0,
  perIpConcurrent: Number(process.env.REMUX_PER_IP_CONCURRENT ?? 1) || 0,
  maxSourceBytes: Number(process.env.REMUX_MAX_SOURCE_BYTES ?? 4 * 1024 * 1024 * 1024) || 0,
  maxTotalBytes: Number(process.env.REMUX_MAX_DISK_BYTES ?? 8 * 1024 * 1024 * 1024) || 0,
  monthlyEgressBytes: Number(process.env.RELAY_MONTHLY_EGRESS_BYTES ?? 0) || 0,
  dailyBudgetBytes: Number(process.env.REMUX_DAILY_BUDGET_BYTES ?? 0) || 0,
  allowHosts: String(process.env.REMUX_ALLOW_HOSTS || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
});
// The audio half of "this will not play": the picture is fine and the audio track
// is not (E-AC3, DTS, TrueHD). Where remux moves bytes, this one spends CPU, so it
// is mounted whether or not anyone may use it and the access mode decides: `token`
// is the default and it refuses everything until the deployment sets a token, and
// `lan` judges the caller by the address a tunnel forwards, not by the socket.
const transcodeBridgeHandler = createTranscodeBridgeHandler({
  fullVideoEnabled:
    transcodeMode === "server" ||
    /^(1|true)$/i.test(process.env.TRANSCODE_FULL_VIDEO_ENABLED || ""),
  ffmpegPath,
  ffmpegRuntime,
  access: process.env.TRANSCODE_ACCESS || "token",
  token: process.env.TRANSCODE_TOKEN || "",
  bitrate: process.env.TRANSCODE_AUDIO_BITRATE || "192k",
  // Transcoding is the expensive one, so it is the most tightly limited by default:
  // one production at a time and a 2 GB source ceiling. An audio-only pass is cheap,
  // but the same knobs have to hold a full re-encode if a deployment enables it.
  ttlMs: Number(process.env.TRANSCODE_TTL_MS ?? 15 * 60 * 1000) || 0,
  finishedTtlMs: Number(process.env.TRANSCODE_FINISHED_TTL_MS ?? 3 * 60 * 60 * 1000) || 0,
  maxConcurrent: Number(process.env.TRANSCODE_MAX_CONCURRENT ?? 1) || 0,
  perIpConcurrent: Number(process.env.TRANSCODE_PER_IP_CONCURRENT ?? 1) || 0,
  maxSourceBytes: Number(process.env.TRANSCODE_MAX_SOURCE_BYTES ?? 2 * 1024 * 1024 * 1024) || 0,
  maxTotalBytes: Number(process.env.TRANSCODE_MAX_DISK_BYTES ?? 4 * 1024 * 1024 * 1024) || 0,
  monthlyEgressBytes: Number(process.env.RELAY_MONTHLY_EGRESS_BYTES ?? 0) || 0,
  dailyBudgetBytes: Number(process.env.TRANSCODE_DAILY_BUDGET_BYTES ?? 0) || 0
});

let mdbListBridgeHandler = null;

async function getMdbListBridgeHandler() {
  if (mdbListBridgeHandler) return mdbListBridgeHandler;
  const sourcePath = await resolveLocalPropertiesSource({ rootDir });
  const properties = sourcePath ? parseProperties(await readFile(sourcePath, "utf8")) : {};
  mdbListBridgeHandler = createMdbListBridgeHandler({
    environment: { ...properties, ...process.env }
  });
  return mdbListBridgeHandler;
}

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".m3u8": "application/vnd.apple.mpegurl",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".wasm": "application/wasm",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8"
};

function getContentType(filePath) {
  return mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function getLanUrls() {
  const interfaces = os.networkInterfaces();
  const urls = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (!entry || entry.family !== "IPv4" || entry.internal) {
        continue;
      }
      urls.push(`http://${entry.address}:${port}/`);
    }
  }
  return Array.from(new Set(urls)).sort();
}

function resolveRequestPath(urlPathname) {
  let pathname = urlPathname || "/";
  if (pathname === "/") {
    pathname = "/index.html";
  }
  const normalized = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  return path.join(rootDir, normalized);
}

function resolveDistPathForRootFile(rootFilePath) {
  const relativePath = path.relative(rootDir, rootFilePath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return "";
  }
  return path.join(distDir, relativePath);
}

// Decode once, then authorize the same path that is resolved on disk.
// Only web assets are public; repository configuration and tooling are not.
const PUBLIC_FILES = new Set([
  "/",
  "/index.html",
  "/app.bundle.js",
  "/core-js.bundle.js",
  "/boot-guard.js",
  "/manifest.webmanifest",
  "/sw.js",
  "/youtube-proxy.html",
  "/docs/youtube-proxy.html"
]);
const PUBLIC_PREFIXES = ["/assets/", "/css/", "/js/", "/res/"];

function publicStaticPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  // Reject hidden/traversal segments and Windows path aliases before resolution.
  if (/[\\:]/.test(decoded) || [...decoded].some((char) => char.charCodeAt(0) < 32)) return null;
  if (decoded.split("/").some((part) => part.startsWith(".") || /[. ]$/.test(part))) {
    return null;
  }
  return PUBLIC_FILES.has(decoded) || PUBLIC_PREFIXES.some((prefix) => decoded.startsWith(prefix))
    ? decoded
    : null;
}
async function resolveRequestFile(pathname) {
  const rootPath = resolveRequestPath(pathname);
  const rootStat = await stat(rootPath).catch(() => null);
  const distPath = resolveDistPathForRootFile(rootPath);
  const distStat = distPath ? await stat(distPath).catch(() => null) : null;
  if (distStat?.isFile()) {
    return { filePath: distPath, fileStat: distStat };
  }

  return { filePath: rootPath, fileStat: rootStat };
}

function requestLocalMediaPath(
  portNumber,
  requestPath,
  { method = "GET", timeoutMs = mediaProbeTimeoutMs } = {}
) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: portNumber,
        path: requestPath,
        method
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            port: portNumber,
            statusCode: res.statusCode || 0,
            headers: res.headers || {},
            body: Buffer.concat(chunks)
          });
        });
      }
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Local media request timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    req.end();
  });
}

async function findLocalMediaServerPort() {
  const candidates = Array.from(new Set([cachedMediaServerPort, ...mediaServerPorts]));
  for (const candidatePort of candidates) {
    try {
      const result = await requestLocalMediaPath(candidatePort, "/settings", {
        timeoutMs: mediaProbeTimeoutMs
      });
      if (result.statusCode >= 200 && result.statusCode < 500) {
        cachedMediaServerPort = candidatePort;
        return candidatePort;
      }
    } catch (_) {
      // Try the next local media server port.
    }
  }
  return null;
}

async function ensureLocalMediaRuntime() {
  if (process.env.NUVIO_DISABLE_MEDIA_RUNTIME === "1") {
    return null;
  }
  const existingPort = await findLocalMediaServerPort();
  if (existingPort) {
    return existingPort;
  }
  mediaRuntimeProcess = spawn(process.execPath, [mediaRuntimePath], {
    windowsHide: true,
    cwd: rootDir,
    stdio: ["ignore", "inherit", "inherit"]
  });
  mediaRuntimeProcess.on("exit", (code, signal) => {
    mediaRuntimeProcess = null;
    if (code || signal) {
      console.warn(`Local media runtime exited (${signal || code}).`);
    }
  });

  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const portNumber = await findLocalMediaServerPort();
    if (portNumber) {
      return portNumber;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return null;
}

async function proxyLocalMediaRequest(request, response, pathname) {
  const mediaPort = await findLocalMediaServerPort();
  if (!mediaPort) {
    response.writeHead(503, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8"
    });
    response.end(JSON.stringify({ error: "Local media server unavailable" }));
    return true;
  }

  const proxied = await requestLocalMediaPath(mediaPort, pathname, {
    method: request.method || "GET",
    timeoutMs: 6000
  });
  response.writeHead(proxied.statusCode || 502, {
    "Cache-Control": "no-store",
    "Content-Type": proxied.headers["content-type"] || "application/json; charset=utf-8"
  });
  response.end(proxied.body);
  return true;
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (requestUrl.pathname.startsWith("/api/debrid/")) {
      await debridApiBridgeHandler(request, response);
      return;
    }
    if (requestUrl.pathname.startsWith("/api/external-return/")) {
      externalReturnHandler(request, response);
      return;
    }
    if (requestUrl.pathname.startsWith("/api/trakt/")) {
      await traktAuthBridgeHandler(request, response);
      return;
    }
    if (requestUrl.pathname.startsWith("/api/introdb/")) {
      await introdbBridgeHandler(request, response);
      return;
    }
    if (requestUrl.pathname.startsWith("/api/probe")) {
      if (!featureEnabled.probe) return refuseDisabled(response, "probe");
      await probeBridgeHandler(request, response);
      return;
    }
    if (requestUrl.pathname.startsWith("/api/remux")) {
      if (!featureEnabled.remux) return refuseDisabled(response, "remux");
      await remuxBridgeHandler(request, response);
      return;
    }
    if (requestUrl.pathname.startsWith("/api/transcode")) {
      if (!featureEnabled.transcode) return refuseDisabled(response, "transcode");
      await transcodeBridgeHandler(request, response);
      return;
    }
    // Where a phone can put an error it cannot show anyone. Bounded, and only the fields
    // the client hook sends; nothing is written to disk.
    if (requestUrl.pathname === "/api/debug/log") {
      if (request.method !== "POST") {
        response.writeHead(405, { "Content-Type": "text/plain" });
        response.end("POST only");
        return;
      }
      let body = "";
      request.on("data", (chunk) => {
        if (body.length < 16_384) body += chunk;
      });
      request.on("end", () => {
        try {
          const payload = JSON.parse(body || "{}");
          console.error(
            `[client-${String(payload.kind || "error")}] ${String(payload.message || "").slice(0, 400)}\n  at ${String(payload.at || "")} ${String(payload.url || "")}\n${String(payload.stack || "").slice(0, 2000)}`
          );
        } catch {
          console.error("[client-error] unreadable payload");
        }
        response.writeHead(204);
        response.end();
      });
      return;
    }

    if (requestUrl.pathname.startsWith("/api/mdblist/")) {
      await (
        await getMdbListBridgeHandler()
      )(request, response);
      return;
    }
    if (requestUrl.pathname === "/nuvio.env.js") {
      const { env } = await readEnvProperties({ rootDir });
      // This is where a deployment's one switch becomes the app's answer. The
      // endpoints are read at runtime (js/config.js prefers __NUVIO_ENV__), so a
      // feature turned off here bakes an empty endpoint for this page load and the app
      // stops calling it -- no rebuild, and the badge says "unavailable" rather than
      // naming a relay that is switched off. A feature that is on but has no explicit
      // endpoint gets the path this server actually mounts.
      const resolved = {
        ...env,
        TRANSCODE_MODE: transcodeMode,
        PROBE_MODE: probeMode,
        REMUX_MODE: String(rawRemuxMode).trim().toLowerCase(),
        REMUX_CLIENT_CACHE_MAX_MIB: String(
          normalizeRemuxCacheMiB(
            process.env.REMUX_CLIENT_CACHE_MAX_MIB ?? env.REMUX_CLIENT_CACHE_MAX_MIB
          )
        )
      };
      resolved.MEDIA_URL_HOST_RESOLVE_ENABLED = String(hostResolveEnabled);
      resolved.PROBE_CLIENT_CONCURRENCY = String(
        normalizeClientProbeConcurrency(
          process.env.PROBE_CLIENT_CONCURRENCY ?? env.PROBE_CLIENT_CONCURRENCY
        )
      );
      // How many rows one page open may probe. A deployment used by a few people does not
      // need a budget at all, so 0 means unlimited; a public one sets it to keep the probe
      // load (and its downloads) predictable.
      const pageLimit =
        String(process.env.PROBE_PAGE_LIMIT ?? "").trim() ||
        String(env.PROBE_PAGE_LIMIT ?? "").trim();
      resolved.PROBE_PAGE_LIMIT = pageLimit || "20";
      Object.entries(FEATURE_SWITCHES).forEach(([switchKey, endpointKey]) => {
        const raw = String(process.env[switchKey] ?? "").trim();
        const externalEndpoint = /^https?:\/\//i.test(String(env[endpointKey] || "").trim());
        const on =
          switchKey === "PROBE_ENABLED"
            ? probeMode === "server"
            : switchKey === "REMUX_ENABLED"
              ? configuredFeatures.remux && (externalEndpoint || featureEnabled.remux)
              : (transcodeMode === "server" ||
                  isFeatureEnabled(raw || env[switchKey], FEATURE_DEFAULTS[switchKey])) &&
                (externalEndpoint || ffmpegRuntime?.audioTranscoding === true);
        resolved[endpointKey] = on
          ? String(env[endpointKey] || "").trim() || FEATURE_PATHS[endpointKey]
          : "";
      });
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "application/javascript; charset=utf-8"
      });
      response.end(
        buildRuntimeEnvScript(resolved) +
          "\nglobalThis.__NUVIO_SUBTITLE_DEBUG__ = " +
          (process.env.NUVIO_SUBTITLE_DEBUG === "1" ? "true" : "false") +
          ";\nglobalThis.__NUVIO_PLAYBACK_STARTUP_DEBUG__ = " +
          (process.env.NUVIO_PLAYBACK_STARTUP_DEBUG === "1" ? "true" : "false") +
          ";\nglobalThis.__NUVIO_CLIENT_PROBE_DEBUG__ = " +
          (process.env.NUVIO_CLIENT_PROBE_DEBUG === "1" ? "true" : "false") +
          ";\n"
      );
      return;
    }

    if (requestUrl.pathname === "/settings" || requestUrl.pathname.startsWith("/tracks/")) {
      await proxyLocalMediaRequest(
        request,
        response,
        `${requestUrl.pathname}${requestUrl.search || ""}`
      );
      return;
    }

    const staticPath = publicStaticPath(requestUrl.pathname);
    if (staticPath === null) {
      response.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store"
      });
      response.end("Not found");
      return;
    }

    let { filePath, fileStat } = await resolveRequestFile(staticPath);

    if (fileStat?.isDirectory()) {
      filePath = path.join(filePath, "index.html");
      fileStat = await stat(filePath).catch(() => null);
    }

    if (!fileStat?.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const fileContents = await readFile(filePath);
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": getContentType(filePath)
    });
    response.end(fileContents);
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(`Server error: ${error?.message || error}`);
  }
});

await ensureLocalMediaRuntime();

server.listen(port, host, async () => {
  const localHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  const mediaPort = await findLocalMediaServerPort();
  console.log(`Serving Nuvio from ${rootDir}`);
  console.log(`Local URL: http://${localHost}:${port}/`);
  for (const lanUrl of getLanUrls()) {
    console.log(`LAN URL: ${lanUrl}`);
  }
  console.log(
    mediaPort
      ? `Local media tracks endpoint: http://${localHost}:${port}/tracks/<media-url> -> 127.0.0.1:${mediaPort}`
      : "Local media tracks endpoint unavailable. Install/enable the media runtime to inspect internal tracks."
  );
  console.log(
    "Use one of the URLs above if you want to test the app over http(s) during development."
  );
});

function stopMediaRuntime() {
  if (!mediaRuntimeProcess) {
    return;
  }
  mediaRuntimeProcess.kill("SIGTERM");
  mediaRuntimeProcess = null;
}

process.on("SIGINT", () => {
  stopMediaRuntime();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stopMediaRuntime();
  process.exit(0);
});
