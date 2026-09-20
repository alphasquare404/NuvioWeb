// Local development and the production bridge share this one return protocol.
const STORAGE_KEY = "nuvioExternalPlaybackHandoff";
const TOKEN_BYTES = 16;
const HANDOFF_TTL_MS = 10 * 60 * 1000;
// A report is written by a callback page in a separate browser context. Give
// that page a small, bounded window to finish before asking the user instead.
const FOREGROUND_RETRY_DELAYS_MS = [0, 500, 1000, 2000];

function getStorage(runtime) {
  return runtime?.localStorage;
}

function writeHandoff(handoff, runtime = globalThis) {
  try {
    getStorage(runtime)?.setItem?.(STORAGE_KEY, JSON.stringify(handoff));
    return true;
  } catch (_) {
    return false;
  }
}

function getReturnOrigin(runtime) {
  try {
    const url = new URL(String(runtime?.location?.href || ""));
    return url.protocol === "https:" ? url.origin : "";
  } catch (_) {
    return "";
  }
}

export function isValidExternalPlaybackToken(token) {
  return /^[a-f0-9]{32}$/i.test(String(token || ""));
}

function sanitizeProgressContext(context) {
  if (!context?.itemId) return null;
  return {
    itemId: String(context.itemId),
    itemType: String(context.itemType || "movie"),
    videoId: context.videoId == null ? null : String(context.videoId),
    season: Number.isFinite(context.season) ? Number(context.season) : null,
    episode: Number.isFinite(context.episode) ? Number(context.episode) : null,
    title: context.title == null ? null : String(context.title),
    poster: context.poster == null ? null : String(context.poster),
    background: context.background == null ? null : String(context.background),
    episodeTitle: context.episodeTitle == null ? null : String(context.episodeTitle),
    streamIdentity: context.streamIdentity == null ? null : String(context.streamIdentity)
  };
}

export function createOutplayerReturnToken(runtime = globalThis) {
  const bytes = new Uint8Array(TOKEN_BYTES);
  if (typeof runtime?.crypto?.getRandomValues !== "function") return "";
  runtime.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function createOutplayerReturnCallbacks({ token, returnOrigin } = {}) {
  const callbacks = createExternalPlaybackCallbacks({
    token,
    returnOrigin,
    provider: "outplayer",
    // Outplayer has proven this callback envelope on physical devices. The
    // source outcome carries the explicit-finish semantic; no position or
    // duration is synthesized into the URL.
    outcomes: { success: "stopped", cancel: "stopped" }
  });
  if (!callbacks?.success) return callbacks;
  const success = new URL(callbacks.success);
  success.searchParams.set("sourceOutcome", "finished");
  return { ...callbacks, success: success.href };
}

export function createExternalPlaybackCallbacks({
  token,
  returnOrigin,
  provider,
  outcomes = {}
} = {}) {
  if (!isValidExternalPlaybackToken(token) || !String(returnOrigin || "").startsWith("https://"))
    return null;
  const reportUrl = new URL(`/api/external-return/report/${token}`, returnOrigin);
  const callback = (outcome) => {
    const url = new URL(reportUrl);
    url.searchParams.set("outcome", outcome);
    if (provider) url.searchParams.set("provider", provider);
    return url.href;
  };
  return Object.fromEntries(
    Object.entries(outcomes).map(([name, outcome]) => [name, callback(outcome)])
  );
}

export function beginExternalPlaybackHandoff({
  runtime = globalThis,
  playerMode,
  progressContext,
  profileId,
  startingPositionMs = 0,
  knownDurationMs = 0,
  automatic = false,
  progressMode = automatic ? "automatic" : "manual",
  callbackCapable = automatic,
  manualPromptEligible = !(progressMode === "automatic" && callbackCapable)
} = {}) {
  const token = createOutplayerReturnToken(runtime);
  const returnOrigin = getReturnOrigin(runtime);
  const context = sanitizeProgressContext(progressContext);
  if (!token || !returnOrigin || !context || !String(playerMode || "").trim()) return null;
  const launchedAt = Date.now();
  const handoff = {
    token,
    returnOrigin,
    playerMode: String(playerMode),
    automatic: Boolean(automatic),
    profileId: String(profileId || ""),
    progressContext: context,
    launchedAt,
    expiresAt: launchedAt + HANDOFF_TTL_MS,
    startingPositionMs: Math.max(0, Math.round(Number(startingPositionMs) || 0)),
    knownDurationMs: Math.max(0, Math.round(Number(knownDurationMs) || 0)),
    progressMode: progressMode === "automatic" ? "automatic" : "manual",
    callbackCapable: Boolean(callbackCapable),
    manualPromptEligible: Boolean(manualPromptEligible),
    state: automatic ? "awaiting-auto-report" : "manual-required",
    returnObservedAt: null,
    manualPromptedAt: null
  };
  return writeHandoff(handoff, runtime) ? handoff : null;
}

export function clearExternalPlaybackHandoff({ runtime = globalThis } = {}) {
  try {
    getStorage(runtime)?.removeItem?.(STORAGE_KEY);
  } catch (_) {
    /* Storage is optional. */
  }
}

export function readPendingExternalPlaybackHandoff({
  runtime = globalThis,
  profileId = null
} = {}) {
  try {
    const handoff = JSON.parse(getStorage(runtime)?.getItem?.(STORAGE_KEY) || "null");
    if (
      !handoff ||
      !isValidExternalPlaybackToken(handoff.token) ||
      !String(handoff.returnOrigin || "").startsWith("https://") ||
      !sanitizeProgressContext(handoff.progressContext) ||
      !Number.isFinite(Number(handoff.expiresAt)) ||
      Date.now() > Number(handoff.expiresAt) ||
      (profileId != null && String(handoff.profileId || "") !== String(profileId || ""))
    ) {
      clearExternalPlaybackHandoff({ runtime });
      return null;
    }
    return handoff;
  } catch (_) {
    clearExternalPlaybackHandoff({ runtime });
    return null;
  }
}

function updatePendingHandoff(handoff, patch, runtime = globalThis) {
  const next = { ...handoff, ...patch };
  return writeHandoff(next, runtime) ? next : handoff;
}

function normalizeReport(report) {
  if (!report?.found || !["finished", "stopped"].includes(report.outcome)) return null;
  const finite = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
  return {
    outcome: report.outcome,
    provider: String(report.provider || ""),
    sourceOutcome: ["finished", "stopped", "success", "cancel", "error"].includes(
      report.sourceOutcome
    )
      ? report.sourceOutcome
      : report.outcome,
    positionSeconds: finite(report.position),
    durationSeconds: finite(report.duration),
    progressFraction: finite(report.progress),
    parameterNames: Array.isArray(report.parameterNames) ? report.parameterNames.map(String) : []
  };
}

export async function collectExternalPlaybackReport({
  runtime = globalThis,
  fetchImpl = runtime.fetch,
  profileId = null
} = {}) {
  const handoff = readPendingExternalPlaybackHandoff({ runtime, profileId });
  if (!handoff || !handoff.automatic || typeof fetchImpl !== "function")
    return { found: false, handoff };
  try {
    const response = await fetchImpl(
      `${handoff.returnOrigin}/api/external-return/collect/${handoff.token}`,
      { method: "GET", cache: "no-store", credentials: "omit" }
    );
    if (!response.ok) return { found: false, handoff };
    const report = normalizeReport(await response.json());
    if (!report) return { found: false, handoff };
    return { found: true, handoff, ...report };
  } catch (_) {
    return { found: false, handoff };
  }
}

export function installExternalPlaybackReturnCoordinator({
  runtime = globalThis,
  fetchImpl = runtime.fetch,
  getProfileId = () => null,
  onAutomaticReport = async () => false,
  onManualFallback = () => {}
} = {}) {
  let wasBackgrounded = runtime.document?.visibilityState === "hidden";
  let collecting = false;
  const promptManually = (handoff) => {
    if (!handoff?.manualPromptEligible) return;
    if (!handoff || (handoff.state === "manual-required" && handoff.manualPromptedAt)) return;
    const pending = updatePendingHandoff(
      handoff,
      {
        state: "manual-required",
        manualPromptedAt: Date.now()
      },
      runtime
    );
    onManualFallback(pending);
  };
  const runAfterForeground = ({ confirmedReturn = true } = {}) => {
    const handoff = readPendingExternalPlaybackHandoff({ runtime, profileId: getProfileId() });
    if (!handoff || collecting) return;
    if (!handoff.automatic) {
      // A manual launch has no callback protocol; only prompt after the app
      // actually returns from the external player, never at normal startup.
      if (confirmedReturn) promptManually(handoff);
      return;
    }
    if (handoff.state === "applying-report" || handoff.state === "manual-required") return;
    updatePendingHandoff(
      handoff,
      {
        state: "awaiting-auto-report",
        returnObservedAt: confirmedReturn ? Date.now() : handoff.returnObservedAt || null
      },
      runtime
    );
    collecting = true;
    const finishCollecting = () => {
      collecting = false;
    };
    const attempt = (index) =>
      runtime.setTimeout?.(async () => {
        try {
          const result = await collectExternalPlaybackReport({
            runtime,
            fetchImpl,
            profileId: getProfileId()
          });
          if (result.found) {
            const applying = updatePendingHandoff(
              result.handoff,
              { state: "applying-report" },
              runtime
            );
            const applied = await onAutomaticReport({ ...result, handoff: applying });
            if (applied) {
              // Keep the identity-bearing handoff until its application has
              // succeeded. The relay record is one-time, so consuming first
              // would leave an explicit completion unable to recover safely.
              clearExternalPlaybackHandoff({ runtime });
            } else {
              // The relay report is one-time. Automatic is deliberately not a
              // synonym for manual fallback: preserve the chosen mode and leave
              // existing progress unchanged if application cannot proceed.
              if (applying.manualPromptEligible) promptManually(applying);
            }
            finishCollecting();
            return;
          }
          if (index + 1 < FOREGROUND_RETRY_DELAYS_MS.length) {
            attempt(index + 1);
            return;
          }
          const pending = readPendingExternalPlaybackHandoff({
            runtime,
            profileId: getProfileId()
          });
          // A bounded retry window has elapsed after a real return/startup. It
          // is now safe to offer the manual path exactly once.
          if (pending?.manualPromptEligible) promptManually(pending);
          finishCollecting();
        } finally {
          // Completion is owned by the terminal report/no-report branches so a
          // slow report application remains protected from duplicate events.
        }
      }, FOREGROUND_RETRY_DELAYS_MS[index]);
    attempt(0);
  };
  const onForeground = () => {
    if (wasBackgrounded) {
      wasBackgrounded = false;
      runAfterForeground({ confirmedReturn: true });
    }
  };
  runtime.document?.addEventListener?.("visibilitychange", () => {
    if (runtime.document.visibilityState === "hidden") wasBackgrounded = true;
    else if (runtime.document.visibilityState === "visible") onForeground();
  });
  runtime.addEventListener?.("pagehide", () => {
    wasBackgrounded = true;
  });
  runtime.addEventListener?.("pageshow", onForeground);
  runtime.addEventListener?.("blur", () => {
    wasBackgrounded = true;
  });
  runtime.addEventListener?.("focus", onForeground);
  // A callback can open Safari and the user can later cold-launch the PWA.
  // In that case there is no prior visibility transition in this JS context.
  if (runtime.document?.visibilityState !== "hidden") {
    const pending = readPendingExternalPlaybackHandoff({ runtime, profileId: getProfileId() });
    if (pending?.automatic) runAfterForeground({ confirmedReturn: true });
  }
  return { collect: runAfterForeground };
}
