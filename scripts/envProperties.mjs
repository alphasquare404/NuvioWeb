import { access, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import {
  normalizeProbeMode,
  normalizeClientProbeConcurrency
} from "../js/core/player/probeMode.js";

import { normalizeRemuxPolicy, normalizeRemuxCacheMiB } from "../js/core/player/remuxPolicy.js";

export const ENV_PROPERTY_KEYS = [
  // How many rows one page open may probe. Reaches the app as a number; 0 means unlimited,
  // which is what a self-hoster with a handful of users wants.
  "PROBE_PAGE_LIMIT",
  "PROBE_MODE",
  "PROBE_CLIENT_CONCURRENCY",
  "MEDIA_URL_HOST_RESOLVE_ENABLED",
  "NUVIO_SUPABASE_URL",
  "NUVIO_SUPABASE_ANON_KEY",
  "NUVIO_SUPABASE_FALLBACK_URL",
  "TV_LOGIN_WEB_BASE_URL",
  "YOUTUBE_PROXY_URL",
  "INTRODB_API_URL",
  "PROBE_ENDPOINT",
  "REMUX_MODE",
  "REMUX_CLIENT_CACHE_MAX_MIB",
  "REMUX_ENDPOINT",
  "TRANSCODE_ENDPOINT",
  "TRANSCODE_MODE",
  "IMDB_RATINGS_API_BASE_URL",
  "IMDB_TAPFRAME_API_BASE_URL",
  "AVATAR_PUBLIC_BASE_URL",
  "UNIQUE_CONTRIBUTIONS_BASE_URL",
  "DONATIONS_BASE_URL",
  "DONATIONS_DONATE_URL",
  "SPONSOR_NAMES",
  "TMDB_API_KEY",
  "TRAKT_CLIENT_ID",
  "SIMKL_CLIENT_ID",
  "SIMKL_APP_NAME",
  "PREMIUMIZE_CLIENT_ID",
  "AUTOMATION_SHORTCUT_URL"
];

const DEFAULT_ENV_VALUES = {
  NUVIO_SUPABASE_URL: "",
  NUVIO_SUPABASE_ANON_KEY: "",
  NUVIO_SUPABASE_FALLBACK_URL: "",
  TV_LOGIN_WEB_BASE_URL: "",
  YOUTUBE_PROXY_URL: "youtube-proxy.html",
  INTRODB_API_URL: "https://api.introdb.app/",
  PROBE_ENDPOINT: "",
  REMUX_MODE: "",
  REMUX_CLIENT_CACHE_MAX_MIB: "512",
  REMUX_ENDPOINT: "",
  TRANSCODE_ENDPOINT: "",
  TRANSCODE_MODE: "",
  IMDB_RATINGS_API_BASE_URL: "",
  IMDB_TAPFRAME_API_BASE_URL: "",
  AVATAR_PUBLIC_BASE_URL: "",
  UNIQUE_CONTRIBUTIONS_BASE_URL: "",
  DONATIONS_BASE_URL: "",
  DONATIONS_DONATE_URL: "",
  SPONSOR_NAMES: "ragmehos.",
  TMDB_API_KEY: "",
  TRAKT_CLIENT_ID: "",
  SIMKL_CLIENT_ID: "",
  SIMKL_APP_NAME: "nuvio",
  PREMIUMIZE_CLIENT_ID: "",
  AUTOMATION_SHORTCUT_URL: ""
};

/**
 * The relays, and whether a deployment offers them.
 *
 * Two layers exist for one feature and they must agree: the endpoint is what the app
 * bakes in and tries, the switch is what the server answers at run time. A switch is
 * therefore the single thing an operator should have to set -- `false` wins over any
 * endpoint value, because an app that keeps trying a disabled relay shows a badge for
 * something the server refuses. Endpoint values remain for the case where the path or
 * host is not the default.
 */
export const FEATURE_SWITCHES = {
  PROBE_ENABLED: "PROBE_ENDPOINT",
  REMUX_ENABLED: "REMUX_ENDPOINT",
  TRANSCODE_ENABLED: "TRANSCODE_ENDPOINT"
};

/**
 * Which relays a deployment gets when it says nothing.
 *
 * Probe only. It reads a header and answers a question -- cheap, and the app is
 * meaningfully better with it. Remux and transcode copy a whole film through the
 * host, so they are opt-in: a self-hoster who just follows the defaults never
 * discovers, months later, that strangers were streaming through their connection.
 */
export const FEATURE_DEFAULTS = {
  PROBE_ENABLED: true,
  REMUX_ENABLED: false,
  TRANSCODE_ENABLED: false
};

/** Absent or empty means the feature's own default, which is not the same for each. */
export function isFeatureEnabled(value, fallback = true) {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return fallback;
  return !["0", "false", "no", "off", "disabled"].includes(raw);
}

async function pathExists(filePath) {
  try {
    await access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function unescapePropertyValue(value = "") {
  return String(value)
    .replace(/\\:/g, ":")
    .replace(/\\=/g, "=")
    .replace(/\\#/g, "#")
    .replace(/\\!/g, "!")
    .replace(/\\\\/g, "\\");
}

export function parseProperties(source = "") {
  const properties = {};
  String(source || "")
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) {
        return;
      }
      const separatorIndex = trimmed.search(/[:=]/);
      if (separatorIndex < 0) {
        properties[trimmed] = "";
        return;
      }
      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      if (key) {
        properties[key] = unescapePropertyValue(value);
      }
    });
  return properties;
}

export function normalizeEnvProperties(properties = {}) {
  const env = {};
  ENV_PROPERTY_KEYS.forEach((key) => {
    const rawValue = Object.prototype.hasOwnProperty.call(properties, key)
      ? properties[key]
      : DEFAULT_ENV_VALUES[key];
    const normalizedValue = String(rawValue ?? "");
    const shouldUseDefault =
      (key === "INTRODB_API_URL" || key === "SPONSOR_NAMES") && !normalizedValue.trim();
    env[key] = shouldUseDefault ? DEFAULT_ENV_VALUES[key] : normalizedValue;
  });
  // One switch, one answer. A disabled feature bakes an empty endpoint, so the app
  // never calls it and the badge says "unavailable" instead of naming a relay that
  // this server has turned off.
  //
  // Only when the operator actually wrote the switch. This function is also applied to
  // an already-resolved env on its way to the browser, and re-applying a *default*
  // there would silently erase the endpoint the server had just decided to offer.
  Object.entries(FEATURE_SWITCHES).forEach(([switchKey, endpointKey]) => {
    if (!Object.prototype.hasOwnProperty.call(properties, switchKey)) return;
    if (switchKey === "REMUX_ENABLED" && String(properties.REMUX_MODE || "").trim()) return;
    if (switchKey === "PROBE_ENABLED" && String(properties.PROBE_MODE || "").trim()) return;
    if (!isFeatureEnabled(properties[switchKey], FEATURE_DEFAULTS[switchKey])) {
      env[endpointKey] = "";
    }
  });
  // Keep an absent mode absent: materializing inferred "server" would turn
  // legacy delivery into explicit new-service policy on the second normalization.
  env.REMUX_MODE = String(properties.REMUX_MODE ?? "")
    .trim()
    .toLowerCase();
  env.REMUX_CLIENT_CACHE_MAX_MIB = String(
    normalizeRemuxCacheMiB(properties.REMUX_CLIENT_CACHE_MAX_MIB)
  );
  if (
    normalizeRemuxPolicy({ mode: env.REMUX_MODE, endpoint: env.REMUX_ENDPOINT }).mode !== "server"
  )
    env.REMUX_ENDPOINT = "";
  env.PROBE_MODE = normalizeProbeMode(properties.PROBE_MODE, properties.PROBE_ENABLED);
  env.PROBE_CLIENT_CONCURRENCY = String(
    normalizeClientProbeConcurrency(properties.PROBE_CLIENT_CONCURRENCY)
  );
  if (env.PROBE_MODE !== "server") env.PROBE_ENDPOINT = "";
  return env;
}

export async function resolveLocalPropertiesSource({ rootDir, sourcePath = "" } = {}) {
  const candidates = [];
  if (sourcePath) {
    candidates.push(path.resolve(sourcePath));
  } else if (process.env.NUVIO_LOCAL_PROPERTIES) {
    candidates.push(path.resolve(process.env.NUVIO_LOCAL_PROPERTIES));
  } else {
    candidates.push(path.join(rootDir, "local.properties"));
    candidates.push(path.join(rootDir, "local.example.properties"));
  }

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return "";
}

export async function readEnvProperties({ rootDir, sourcePath = "" } = {}) {
  const resolvedSourcePath = await resolveLocalPropertiesSource({ rootDir, sourcePath });
  if (!resolvedSourcePath) {
    return {
      sourcePath: "",
      env: normalizeEnvProperties({})
    };
  }
  if (/\.js$/i.test(resolvedSourcePath)) {
    throw new Error(
      `Runtime env JavaScript files are no longer supported as config sources. Use local.properties instead: ${resolvedSourcePath}`
    );
  }
  const properties = parseProperties(await readFile(resolvedSourcePath, "utf8"));
  return {
    sourcePath: resolvedSourcePath,
    env: normalizeEnvProperties(properties)
  };
}

export function buildRuntimeEnvScript(env = {}) {
  const values = normalizeEnvProperties(env);
  return `(function defineNuvioEnv() {
  var root = typeof globalThis !== "undefined" ? globalThis : window;
  var env = root.__NUVIO_ENV__ || {};
  var values = ${JSON.stringify(values, null, 2)};
  for (var key in values) {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      env[key] = values[key];
    }
  }
  root.__NUVIO_ENV__ = env;
}());
`;
}

export async function writeRuntimeEnvScriptFile(targetPath, { rootDir, sourcePath = "" } = {}) {
  const result = await readEnvProperties({ rootDir, sourcePath });
  await writeFile(targetPath, buildRuntimeEnvScript(result.env), "utf8");
  return result;
}
