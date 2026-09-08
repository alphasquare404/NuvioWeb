const EXTERNAL_PLAYER_IDS = Object.freeze({
  DISABLED: "disabled",
  LENNA: "lenna",
  INFUSE: "infuse",
  VLC: "vlc"
});

const IOS_APP_STORE_URLS = Object.freeze({
  lenna: "https://apps.apple.com/app/lenna-video-library-player/id6502967807",
  infuse: "https://apps.apple.com/app/infuse-video-player/id1136220934",
  vlc: "https://apps.apple.com/app/vlc-media-player/id650377962"
});

const ANDROID_VLC_STORE_URL = "https://play.google.com/store/apps/details?id=org.videolan.vlc";

function runtimeUserAgent(runtime = globalThis) {
  return String(runtime?.navigator?.userAgent || "");
}

export function getBrowserExternalPlayerPlatform(runtime = globalThis) {
  const userAgent = runtimeUserAgent(runtime);
  const platform = String(runtime?.navigator?.platform || "");
  const maxTouchPoints = Number(runtime?.navigator?.maxTouchPoints || 0);
  if (/android/i.test(userAgent)) return "android";
  if (/iphone|ipad|ipod/i.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1)) {
    return "ios";
  }
  return "other";
}

export function normalizeBrowserExternalPlayer(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return Object.values(EXTERNAL_PLAYER_IDS).includes(normalized)
    ? normalized
    : EXTERNAL_PLAYER_IDS.DISABLED;
}

export function getBrowserExternalPlayerOptions(runtime = globalThis) {
  const platform = getBrowserExternalPlayerPlatform(runtime);
  if (platform === "ios") {
    return [
      EXTERNAL_PLAYER_IDS.DISABLED,
      EXTERNAL_PLAYER_IDS.LENNA,
      EXTERNAL_PLAYER_IDS.INFUSE,
      EXTERNAL_PLAYER_IDS.VLC
    ];
  }
  if (platform === "android") {
    return [EXTERNAL_PLAYER_IDS.DISABLED, EXTERNAL_PLAYER_IDS.VLC];
  }
  return [EXTERNAL_PLAYER_IDS.DISABLED];
}

export function isTransferableExternalMediaUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch (_) {
    return false;
  }
}

export function buildInfuseLaunchUrl({ mediaUrl, title = "", subtitleUrl = "" } = {}) {
  if (!isTransferableExternalMediaUrl(mediaUrl)) return "";
  const query = new URLSearchParams({ url: String(mediaUrl) });
  if (String(title).trim()) query.set("filename", String(title).trim());
  if (isTransferableExternalMediaUrl(subtitleUrl)) query.set("sub", String(subtitleUrl));
  return `infuse://x-callback-url/play?${query.toString()}`;
}

export function buildLennaLaunchUrl({ mediaUrl } = {}) {
  if (!isTransferableExternalMediaUrl(mediaUrl)) return "";
  return `lenna://x-callback-url/play?${new URLSearchParams({ url: String(mediaUrl) }).toString()}`;
}

export function buildIosVlcLaunchUrl({ mediaUrl, subtitleUrl = "" } = {}) {
  if (!isTransferableExternalMediaUrl(mediaUrl)) return "";
  const query = new URLSearchParams({ url: String(mediaUrl) });
  if (isTransferableExternalMediaUrl(subtitleUrl)) query.set("sub", String(subtitleUrl));
  return `vlc-x-callback://x-callback-url/stream?${query.toString()}`;
}

export function buildAndroidVlcLaunchUrl({ mediaUrl } = {}) {
  if (!isTransferableExternalMediaUrl(mediaUrl)) return "";
  const parsed = new URL(String(mediaUrl));
  // Chrome's documented intent syntax keeps the source URL as ACTION_VIEW data
  // while restricting resolution to VLC's official Android package.
  const path = `${parsed.hostname}${parsed.pathname}${parsed.search}${parsed.hash ? `%23${encodeURIComponent(parsed.hash.slice(1))}` : ""}`;
  return `intent://${path}#Intent;scheme=${parsed.protocol.slice(0, -1)};package=org.videolan.vlc;action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(ANDROID_VLC_STORE_URL)};end`;
}

export function buildBrowserExternalPlayerLaunch({ player, platform, mediaUrl, title, subtitleUrl } = {}) {
  const selectedPlayer = normalizeBrowserExternalPlayer(player);
  if (!isTransferableExternalMediaUrl(mediaUrl) || selectedPlayer === EXTERNAL_PLAYER_IDS.DISABLED) {
    return null;
  }
  if (platform === "ios" && selectedPlayer === EXTERNAL_PLAYER_IDS.LENNA) {
    return { href: buildLennaLaunchUrl({ mediaUrl }), storeUrl: IOS_APP_STORE_URLS.lenna };
  }
  if (platform === "ios" && selectedPlayer === EXTERNAL_PLAYER_IDS.INFUSE) {
    return { href: buildInfuseLaunchUrl({ mediaUrl, title, subtitleUrl }), storeUrl: IOS_APP_STORE_URLS.infuse };
  }
  if (platform === "ios" && selectedPlayer === EXTERNAL_PLAYER_IDS.VLC) {
    return { href: buildIosVlcLaunchUrl({ mediaUrl, subtitleUrl }), storeUrl: IOS_APP_STORE_URLS.vlc };
  }
  if (platform === "android" && selectedPlayer === EXTERNAL_PLAYER_IDS.VLC) {
    return { href: buildAndroidVlcLaunchUrl({ mediaUrl }), storeUrl: ANDROID_VLC_STORE_URL };
  }
  return null;
}

export function resolveBrowserStreamPlaybackRoute(options = {}) {
  const launch = buildBrowserExternalPlayerLaunch(options);
  return launch ? { target: "external", launch } : { target: "nuvio", launch: null };
}

export function getManualBrowserExternalPlayerOptions(runtime = globalThis) {
  return getBrowserExternalPlayerOptions(runtime).filter((id) => id !== EXTERNAL_PLAYER_IDS.DISABLED);
}

export function getBrowserExternalPlayerStoreUrl({ player, platform } = {}) {
  const selectedPlayer = normalizeBrowserExternalPlayer(player);
  if (platform === "ios") return IOS_APP_STORE_URLS[selectedPlayer] || "";
  if (platform === "android" && selectedPlayer === EXTERNAL_PLAYER_IDS.VLC) return ANDROID_VLC_STORE_URL;
  return "";
}

// iOS custom schemes are deliberately fire-and-forget: Safari owns the
// unavailable-app experience, so Nuvio never stacks a speculative popup.
export function launchBrowserExternalPlayer({
  runtime = globalThis,
  href = ""
} = {}) {
  if (!href || typeof runtime?.location?.assign !== "function") return false;
  runtime.location.assign(href);
  return true;
}

export { EXTERNAL_PLAYER_IDS };
