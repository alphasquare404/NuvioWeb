import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

// Probe bridge: what is actually inside the stream?
//
// The stream list can only estimate from the addon's own text, and addons format
// that text however they like. One ffprobe answers the question exactly: which
// container, which codecs, what resolution. From that the app decides between
// playing directly, remuxing the container, transcoding the audio only, or
// re-encoding the picture — a cost ladder rather than a guess.
//
// Deliberately narrow: one source parameter, http(s) only, a cached answer per
// source, and a short timeout so one slow host cannot hold the bridge.

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 20_000;
const PROBE_PATH = "/api/probe";
const HEALTH_PATH = "/api/probe/health";

function json(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*"
  });
  response.end(JSON.stringify(payload));
}

export function parseProbeSource(raw) {
  const value = String(raw || "").trim();
  if (!value) return { ok: false, reason: "missing-source" };
  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }
  if (!/^https?:$/.test(url.protocol)) return { ok: false, reason: "unsupported-scheme" };
  if (url.username || url.password) return { ok: false, reason: "credentials-not-allowed" };
  return {
    ok: true,
    url: url.toString(),
    key: createHash("sha256").update(url.toString()).digest("hex").slice(0, 32)
  };
}

/** ffprobe's JSON, reduced to the few facts the decision needs. */
export function normalizeProbe(probeJson) {
  const streams = Array.isArray(probeJson?.streams) ? probeJson.streams : [];
  const video = streams.find((stream) => stream?.codec_type === "video") || null;
  const audio = streams.find((stream) => stream?.codec_type === "audio") || null;
  const formatName = String(probeJson?.format?.format_name || "");

  const container = /matroska|webm/i.test(formatName)
    ? "mkv"
    : /mp4|mov/i.test(formatName)
      ? "mp4"
      : formatName
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean)[0] || "unknown";

  return {
    container,
    videoCodec: String(video?.codec_name || "unknown").toLowerCase(),
    audioCodec: String(audio?.codec_name || "unknown").toLowerCase(),
    width: Number(video?.width) || 0,
    height: Number(video?.height) || 0,
    durationSeconds: Number(probeJson?.format?.duration) || 0
  };
}

export function createProbeBridgeHandler({
  ffprobePath = process.env.FFPROBE_PATH || "ffprobe",
  ttlMs = DEFAULT_TTL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  spawnImpl = spawn,
  now = () => Date.now()
} = {}) {
  const cache = new Map();

  function probe(source) {
    return new Promise((resolve, reject) => {
      const args = [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type,codec_name,width,height",
        "-show_entries",
        "format=format_name,duration",
        "-of",
        "json",
        source
      ];
      let output = "";
      let settled = false;
      const child = spawnImpl(ffprobePath, args, { stdio: ["ignore", "pipe", "ignore"] });
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          child.kill("SIGKILL");
        } catch {
          // already gone
        }
        reject(new Error("probe-timeout"));
      }, timeoutMs);
      child.stdout?.on?.("data", (chunk) => {
        if (output.length < 256 * 1024) output += String(chunk);
      });
      child.on("error", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error("probe-failed"));
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error("probe-failed"));
          return;
        }
        try {
          resolve(normalizeProbe(JSON.parse(output)));
        } catch {
          reject(new Error("probe-unreadable"));
        }
      });
    });
  }

  return async function handleProbeBridge(request, response) {
    const requestUrl = new URL(
      request.url || "/",
      `http://${request.headers?.host || "localhost"}`
    );
    if (requestUrl.pathname === HEALTH_PATH) {
      json(response, 200, { ok: true });
      return;
    }
    if (requestUrl.pathname !== PROBE_PATH) {
      json(response, 404, { ok: false, error: "unknown_path" });
      return;
    }
    if (request.method !== "GET") {
      json(response, 405, { ok: false, error: "method_not_allowed" });
      return;
    }

    const parsed = parseProbeSource(requestUrl.searchParams.get("u"));
    if (!parsed.ok) {
      json(response, 400, { ok: false, error: parsed.reason });
      return;
    }

    const cached = cache.get(parsed.key);
    if (cached && cached.expiresAt > now()) {
      json(response, 200, { ok: true, cached: true, ...cached.value });
      return;
    }

    try {
      const value = await probe(parsed.url);
      cache.set(parsed.key, { value, expiresAt: now() + ttlMs });
      json(response, 200, { ok: true, cached: false, ...value });
    } catch (error) {
      json(response, 502, { ok: false, error: String(error?.message || "probe-failed") });
    }
  };
}

export function createProbeBridgeServer(options = {}) {
  return createServer(createProbeBridgeHandler(options));
}
