import { normalizeProbeMode, normalizeClientProbeConcurrency } from "./core/player/probeMode.js";

import { normalizeRemuxPolicy, normalizeRemuxCacheMiB } from "./core/player/remuxPolicy.js";

// What the bundle was built with. nuvio.env.js is a separate request, served
// no-store, and it can simply not execute -- offline at the wrong moment, a
// cache miss, or an insecure origin where no service worker can stand in for
// it. Every value here then read as empty, and an empty SUPABASE_URL is the
// dangerous one: `${SUPABASE_URL}/rest/v1/...` becomes a relative path, which
// the host that served the page answers with its own 404. Every cloud call
// then failed for the life of that page, looking exactly like a backend that
// was down, and nothing short of a real page load could undo it.
const buildEnv = typeof __NUVIO_BUILD_ENV__ === "undefined" ? {} : __NUVIO_BUILD_ENV__;

// The runtime file still wins outright whenever it loads, so a redeployed
// container keeps overriding what was built in. It only falls back.
const runtimeEnv = globalThis.__NUVIO_ENV__ || buildEnv;

if (!globalThis.__NUVIO_ENV__) {
  console.warn(
    Object.keys(buildEnv).length
      ? "[Config] nuvio.env.js did not load; using the configuration built into this bundle."
      : "[Config] nuvio.env.js did not load and no built-in configuration exists: cloud sync cannot work."
  );
}

export const SUPABASE_URL = String(runtimeEnv.NUVIO_SUPABASE_URL || "").trim();
export const SUPABASE_ANON_KEY = String(runtimeEnv.NUVIO_SUPABASE_ANON_KEY || "").trim();
export const SUPABASE_FALLBACK_URL = String(runtimeEnv.NUVIO_SUPABASE_FALLBACK_URL || "").trim();
export const TV_LOGIN_WEB_BASE_URL = String(runtimeEnv.TV_LOGIN_WEB_BASE_URL || "").trim();
export const YOUTUBE_PROXY_URL = String(
  runtimeEnv.YOUTUBE_PROXY_URL || "youtube-proxy.html"
).trim();
export const PARENTAL_GUIDE_API_URL = "https://api.tiffara.com/";
export const INTRODB_API_URL = String(
  runtimeEnv.INTRODB_API_URL || "https://api.introdb.app/"
).trim();
// Same-origin remux relay. Empty means the deployment does not run one, and
// nothing about playback changes.
// What this deployment can afford to do with a stream it cannot hand straight to
// the player. Empty means "not offered": the app then labels streams by estimate
// and never calls anyone.
export const PROBE_MODE = normalizeProbeMode(runtimeEnv.PROBE_MODE, runtimeEnv.PROBE_ENABLED);
export const PROBE_CLIENT_CONCURRENCY = normalizeClientProbeConcurrency(
  runtimeEnv.PROBE_CLIENT_CONCURRENCY
);
export const PROBE_ENDPOINT =
  PROBE_MODE === "server" ? String(runtimeEnv.PROBE_ENDPOINT || "").trim() : "";
export const REMUX_POLICY = normalizeRemuxPolicy({
  mode: runtimeEnv.REMUX_MODE,
  endpoint: runtimeEnv.REMUX_ENDPOINT
});
export const REMUX_MODE = REMUX_POLICY.mode;
export const REMUX_CLIENT_CACHE_MAX_MIB = normalizeRemuxCacheMiB(
  runtimeEnv.REMUX_CLIENT_CACHE_MAX_MIB
);
export const REMUX_ENDPOINT =
  REMUX_MODE === "server" ? String(runtimeEnv.REMUX_ENDPOINT || "").trim() : "";
// Audio-only transcode. Its own switch, not a part of remux: it costs minutes of
// CPU on the machine that runs ffmpeg, so a deployment says whether it may be
// asked at all. Empty means the app never calls it.
export const TRANSCODE_ENDPOINT = String(runtimeEnv.TRANSCODE_ENDPOINT || "").trim();
const configuredTranscodeMode = String(runtimeEnv.TRANSCODE_MODE || "")
  .trim()
  .toLowerCase();
export const TRANSCODE_MODE = ["client", "server"].includes(configuredTranscodeMode)
  ? configuredTranscodeMode
  : !configuredTranscodeMode && TRANSCODE_ENDPOINT
    ? "server"
    : "none";
export const IMDB_RATINGS_API_BASE_URL = String(runtimeEnv.IMDB_RATINGS_API_BASE_URL || "").trim();
export const IMDB_TAPFRAME_API_BASE_URL = String(
  runtimeEnv.IMDB_TAPFRAME_API_BASE_URL || ""
).trim();
export const MDBLIST_API_BASE_URL = String(
  runtimeEnv.MDBLIST_API_BASE_URL || "https://api.mdblist.com/"
).trim();
export const AVATAR_PUBLIC_BASE_URL = String(runtimeEnv.AVATAR_PUBLIC_BASE_URL || "").trim();
export const UNIQUE_CONTRIBUTIONS_BASE_URL = String(
  runtimeEnv.UNIQUE_CONTRIBUTIONS_BASE_URL || ""
).trim();
export const DONATIONS_BASE_URL = String(runtimeEnv.DONATIONS_BASE_URL || "").trim();
export const DONATIONS_DONATE_URL = String(runtimeEnv.DONATIONS_DONATE_URL || "").trim();
export const SPONSOR_NAMES = String(runtimeEnv.SPONSOR_NAMES || "").trim() || "ragmehos.";
export const TMDB_API_KEY = String(runtimeEnv.TMDB_API_KEY || "").trim();
export const TRAKT_CLIENT_ID = String(runtimeEnv.TRAKT_CLIENT_ID || "").trim();
export const TRAKT_API_URL = "https://api.trakt.tv/";
export const SIMKL_CLIENT_ID = String(runtimeEnv.SIMKL_CLIENT_ID || "").trim();
// A ready-made iCloud Shortcut for this deployment. Empty on purpose: a
// Shortcut carries the domain it opens, so one deployment's link would send
// another deployment's users to the wrong instance. Empty means the app shows
// how to build the Shortcut instead.
export const AUTOMATION_SHORTCUT_URL = String(runtimeEnv.AUTOMATION_SHORTCUT_URL || "").trim();
export const SIMKL_API_URL = "https://api.simkl.com";
export const SIMKL_APP_NAME = String(runtimeEnv.SIMKL_APP_NAME || "nuvio").trim() || "nuvio";
export const PREMIUMIZE_CLIENT_ID = String(runtimeEnv.PREMIUMIZE_CLIENT_ID || "").trim();
