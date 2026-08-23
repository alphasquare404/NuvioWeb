/* global __NUVIO_INCLUDE_TRAKT_CLIENT_SECRET__ */

const runtimeEnv = globalThis.__NUVIO_ENV__ || {};

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
// Desktop browser bundles compile this branch out. Native TV package builds
// explicitly opt in, so their existing Trakt device-auth flow can retain its
// trusted packaged credential without delivering it to browser clients.
export const TRAKT_CLIENT_SECRET = __NUVIO_INCLUDE_TRAKT_CLIENT_SECRET__
  ? String(runtimeEnv.TRAKT_CLIENT_SECRET || "").trim()
  : "";
export const TRAKT_API_URL = "https://api.trakt.tv/";
export const TRAKT_REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob";
export const SIMKL_CLIENT_ID = String(runtimeEnv.SIMKL_CLIENT_ID || "").trim();
export const SIMKL_API_URL = "https://api.simkl.com";
export const SIMKL_APP_NAME = String(runtimeEnv.SIMKL_APP_NAME || "nuvio").trim() || "nuvio";
export const PREMIUMIZE_CLIENT_ID = String(runtimeEnv.PREMIUMIZE_CLIENT_ID || "").trim();
