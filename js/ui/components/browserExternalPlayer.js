import { createExternalPlaybackCallbacks, createOutplayerReturnCallbacks } from "./browserExternalPlaybackHandoff.js";
import {
  beginExternalPlaybackHandoff,
  clearExternalPlaybackHandoff
} from "./browserExternalPlaybackHandoff.js";
import { ProfileManager } from "../../core/profile/profileManager.js";

const EXTERNAL_PLAYER_IDS = Object.freeze({
  DISABLED: "disabled",
  LENNA: "lenna",
  INFUSE: "infuse",
  VLC: "vlc",
  OUTPLAYER: "outplayer"
});

const IOS_APP_STORE_URLS = Object.freeze({
  lenna: "https://apps.apple.com/app/lenna-video-library-player/id6502967807",
  outplayer: "https://apps.apple.com/app/outplayer/id1449923287",
  infuse: "https://apps.apple.com/app/infuse-video-player/id1136220934",
  vlc: "https://apps.apple.com/app/vlc-media-player/id650377962"
});

const ANDROID_VLC_STORE_URL = "https://play.google.com/store/apps/details?id=org.videolan.vlc";

// Keep the policy beside the URL builders: a callback can mean a real progress
// report, a return observation, or merely a best-effort manual fallback.
const EXTERNAL_PLAYER_CAPABILITIES = Object.freeze({
  [EXTERNAL_PLAYER_IDS.OUTPLAYER]: Object.freeze({ automaticProgress: true, resume: true, callbackMode: "progress", verified: true }),
  [EXTERNAL_PLAYER_IDS.INFUSE]: Object.freeze({ automaticProgress: true, resume: true, callbackMode: "progress", verified: true }),
  [EXTERNAL_PLAYER_IDS.LENNA]: Object.freeze({ automaticProgress: true, resume: true, callbackMode: "progress", verified: true, manualFallbackOnInvalid: true }),
  [EXTERNAL_PLAYER_IDS.VLC]: Object.freeze({ automaticProgress: false, resume: false, callbackMode: "return-only", verified: false })
});

export function getBrowserExternalPlayerCapabilities(player) {
  return EXTERNAL_PLAYER_CAPABILITIES[normalizeBrowserExternalPlayer(player)] || Object.freeze({ automaticProgress: false, resume: false, callbackMode: "none", verified: false });
}

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
      EXTERNAL_PLAYER_IDS.LENNA,
      EXTERNAL_PLAYER_IDS.OUTPLAYER,
      EXTERNAL_PLAYER_IDS.INFUSE,
      EXTERNAL_PLAYER_IDS.VLC,
      EXTERNAL_PLAYER_IDS.DISABLED
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

export function buildInfuseLaunchUrl({ mediaUrl, title = "", subtitleUrl = "", resumePositionSeconds = 0, externalReturnToken, externalReturnOrigin } = {}) {
  if (!isTransferableExternalMediaUrl(mediaUrl)) return "";
  const query = new URLSearchParams({ url: String(mediaUrl), position: String(Math.max(0, Math.floor(Number(resumePositionSeconds) || 0))) });
  if (String(title).trim()) query.set("filename", String(title).trim());
  if (isTransferableExternalMediaUrl(subtitleUrl)) query.set("sub", String(subtitleUrl));
  const callbacks = createExternalPlaybackCallbacks({
    token: externalReturnToken, returnOrigin: externalReturnOrigin, provider: "infuse", outcomes: { success: "stopped", error: "stopped" }
  });
  if (callbacks?.success) {
    const success = new URL(callbacks.success);
    success.searchParams.set("sourceOutcome", "success");
    query.set("x-success", success.href);
  }
  if (callbacks?.error) {
    const error = new URL(callbacks.error);
    error.searchParams.set("sourceOutcome", "error");
    query.set("x-error", error.href);
  }
  return `infuse://x-callback-url/play?${query.toString()}`;
}

export function buildLennaLaunchUrl({ mediaUrl, subtitleUrl = "", resumePositionSeconds = 0, externalReturnToken, externalReturnOrigin } = {}) {
  if (!isTransferableExternalMediaUrl(mediaUrl)) return "";
  const query = new URLSearchParams({ url: String(mediaUrl) });
  if (isTransferableExternalMediaUrl(subtitleUrl)) query.set("sub", String(subtitleUrl));
  // Lenna associates sub/position with the nearest preceding url. Keep this
  // order explicit and use its documented integer-second resume input.
  query.set("position", String(Math.max(0, Math.floor(Number(resumePositionSeconds) || 0))));
  const callbacks = createExternalPlaybackCallbacks({
    token: externalReturnToken, returnOrigin: externalReturnOrigin, provider: "lenna", outcomes: { success: "stopped", error: "stopped" }
  });
  if (callbacks?.success) {
    const success = new URL(callbacks.success);
    success.searchParams.set("sourceOutcome", "success");
    query.set("x-success", success.href);
  }
  if (callbacks?.error) {
    const error = new URL(callbacks.error);
    error.searchParams.set("sourceOutcome", "error");
    query.set("x-error", error.href);
  }
  return `lenna://x-callback-url/play?${query.toString()}`;
}

export function buildIosVlcLaunchUrl({ mediaUrl, subtitleUrl = "" } = {}) {
  if (!isTransferableExternalMediaUrl(mediaUrl)) return "";
  const query = new URLSearchParams({ url: String(mediaUrl) });
  if (isTransferableExternalMediaUrl(subtitleUrl)) query.set("sub", String(subtitleUrl));
  return `vlc-x-callback://x-callback-url/stream?${query.toString()}`;
}

function buildIosVlcReturnLaunchUrl({ mediaUrl, subtitleUrl = "", externalReturnToken, externalReturnOrigin } = {}) {
  const href = buildIosVlcLaunchUrl({ mediaUrl, subtitleUrl });
  if (!href) return "";
  const callbacks = createExternalPlaybackCallbacks({
    token: externalReturnToken, returnOrigin: externalReturnOrigin, provider: "vlc", outcomes: { success: "stopped" }
  });
  if (!callbacks?.success) return href;
  const query = new URL(href).searchParams;
  const success = new URL(callbacks.success);
  success.searchParams.set("sourceOutcome", "success");
  query.set("x-success", success.href);
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

export function buildOutplayerLaunchUrl({ mediaUrl, externalReturnToken, externalReturnOrigin, resumePositionSeconds = 0, knownDurationMs = 0 } = {}) {
  if (!isTransferableExternalMediaUrl(mediaUrl)) return "";
  const callbacks = createOutplayerReturnCallbacks({ token: externalReturnToken, returnOrigin: externalReturnOrigin });
  const query = new URLSearchParams({ url: String(mediaUrl) });
  if (callbacks?.success && callbacks?.cancel) {
    query.set("x-success", callbacks.success);
    query.set("x-cancel", callbacks.cancel);
  }
  const safeResumePosition = Number(resumePositionSeconds);
  if (Number.isFinite(safeResumePosition) && safeResumePosition > 0) {
    query.set("position", String(Math.max(0, safeResumePosition)));
  }
  return `outplayer://x-callback-url/play?${query.toString()}`;
}

export function buildBrowserExternalPlayerLaunch({ player, platform, mediaUrl, title, subtitleUrl, externalReturnToken, externalReturnOrigin, resumePositionSeconds = 0, knownDurationMs = 0 } = {}) {
  const selectedPlayer = normalizeBrowserExternalPlayer(player);
  if (!isTransferableExternalMediaUrl(mediaUrl) || selectedPlayer === EXTERNAL_PLAYER_IDS.DISABLED) {
    return null;
  }
  if (platform === "ios" && selectedPlayer === EXTERNAL_PLAYER_IDS.LENNA) {
    return { href: buildLennaLaunchUrl({ mediaUrl, subtitleUrl, resumePositionSeconds, externalReturnToken, externalReturnOrigin }), storeUrl: IOS_APP_STORE_URLS.lenna };
  }
  if (platform === "ios" && selectedPlayer === EXTERNAL_PLAYER_IDS.INFUSE) {
    return { href: buildInfuseLaunchUrl({ mediaUrl, title, subtitleUrl, resumePositionSeconds, externalReturnToken, externalReturnOrigin }), storeUrl: IOS_APP_STORE_URLS.infuse };
  }
  if (platform === "ios" && selectedPlayer === EXTERNAL_PLAYER_IDS.VLC) {
    return { href: buildIosVlcReturnLaunchUrl({ mediaUrl, subtitleUrl, externalReturnToken, externalReturnOrigin }), storeUrl: IOS_APP_STORE_URLS.vlc };
  }
  if (platform === "ios" && selectedPlayer === EXTERNAL_PLAYER_IDS.OUTPLAYER) {
    const href = buildOutplayerLaunchUrl({ mediaUrl, externalReturnToken, externalReturnOrigin, resumePositionSeconds, knownDurationMs });
    return href ? { href, storeUrl: IOS_APP_STORE_URLS.outplayer } : null;
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

export function prepareBrowserExternalPlaybackLaunch({
  player,
  platform = getBrowserExternalPlayerPlatform(),
  mediaUrl,
  title = "",
  subtitleUrl = "",
  resumePositionSeconds = 0,
  knownDurationMs = 0,
  progressContext = null,
  progressMode = "automatic",
  profileId = null,
  runtime = globalThis
} = {}) {
  const normalizedPlayer = normalizeBrowserExternalPlayer(player);
  const capabilities = getBrowserExternalPlayerCapabilities(normalizedPlayer);
  const observationCallback = capabilities.callbackMode === "return-only";
  const automatic = progressMode !== "manual" && (capabilities.automaticProgress || observationCallback);
  const handoff = beginExternalPlaybackHandoff({
    runtime,
    playerMode: normalizedPlayer,
    automatic,
    progressMode: automatic ? "automatic" : "manual",
    callbackCapable: capabilities.automaticProgress,
    manualPromptEligible: observationCallback || capabilities.manualFallbackOnInvalid || progressMode === "manual",
    progressContext,
    profileId: profileId ?? ProfileManager.getActiveProfileId(),
    startingPositionMs: Math.max(0, Number(resumePositionSeconds) || 0) * 1000,
    knownDurationMs
  });
  const launch = buildBrowserExternalPlayerLaunch({
    player: normalizedPlayer,
    platform,
    mediaUrl,
    title,
    subtitleUrl,
    externalReturnToken: handoff?.automatic ? handoff.token : null,
    externalReturnOrigin: handoff?.automatic ? handoff.returnOrigin : null,
    resumePositionSeconds,
    knownDurationMs: handoff?.automatic ? handoff.knownDurationMs : 0
  });
  if (!launch?.href) {
    if (handoff) clearExternalPlaybackHandoff({ runtime });
    return null;
  }
  return { launch, handoff, automatic, callbackCapable: capabilities.automaticProgress };
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

export async function copyBrowserExternalStreamLink({ runtime = globalThis, mediaUrl = "" } = {}) {
  if (!isTransferableExternalMediaUrl(mediaUrl)) return false;
  try {
    await runtime?.navigator?.clipboard?.writeText?.(String(mediaUrl));
    return true;
  } catch (_) {
    const document = runtime?.document;
    if (!document?.body || typeof document.createElement !== "function") return false;
    const input = document.createElement("textarea");
    input.value = String(mediaUrl);
    input.setAttribute("readonly", "");
    input.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
    document.body.appendChild(input);
    input.select();
    let copied = false;
    try { copied = document.execCommand?.("copy") === true; } catch (_) { copied = false; }
    input.remove();
    return copied;
  }
}

export { EXTERNAL_PLAYER_IDS };
