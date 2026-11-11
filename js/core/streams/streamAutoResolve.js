import { reusableStreamPreference, matchesReusableStream } from "./streamReusePreference.js";
// Picking a stream without a screen to pick it on.
//
// Auto stream selection used to happen on the stream screen: the app navigated
// there, the screen fetched, and the moment a stream matched it played. That
// worked, but it meant the selection page was on display for the whole fetch --
// which is precisely the page the setting exists to skip.
//
// This runs the same fetch and the same choice with no screen attached, so the
// caller can stay where it is and show nothing more than a progress bar. The
// choice itself is still `selectAutoPlayStream`: nothing about which stream
// wins is decided here.

import { hdrFromText } from "./streamHdrPreference.js";
import { filterAutoPlaySourceStreams } from "./streamAutoPlaySelector.js";
import { resolveHdrPreference } from "./streamHdrPreference.js";
import { streamRepository } from "../../data/repository/streamRepository.js";
import { flattenStreams, mergeStreamItems } from "./streamList.js";
import { isAutoPlayEffectivelyEnabled, selectAutoPlayStream } from "./streamAutoPlaySelector.js";

// The stream screen's own sentinel for "never choose early": wait for every
// addon before deciding, however long that takes.
const WAIT_FOREVER_SECONDS = 2147483647;
export const INSTANT_SELECTION_TIMEOUT_MS = 45000;

// The stream route carries whatever type the catalog gave it. One place
// decides what that means, so a caller cannot get it subtly wrong.
export function normalizeStreamType(itemType) {
  return String(itemType || "movie").toLowerCase() || "movie";
}

export function normalizeSelectionWaitSeconds(value) {
  return Math.max(0, Math.trunc(Number(value || 0)));
}

// One deadline belongs to the complete Finding stream attempt.
export function streamSelectionDeadline(seconds, now = Date.now()) {
  const wait = normalizeSelectionWaitSeconds(seconds);
  return wait === WAIT_FOREVER_SECONDS
    ? Infinity
    : now + (wait === 0 ? INSTANT_SELECTION_TIMEOUT_MS : wait * 1000);
}

export async function withinStreamSelectionDeadline(task, deadlineAt, onTimeout, signal = null) {
  if (signal?.aborted) return onTimeout();
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) return onTimeout();
  if (!Number.isFinite(remaining) && !signal) return task();
  let timer, abortListener;
  try {
    return await Promise.race([
      Promise.resolve().then(task),
      new Promise((resolve) => {
        if (Number.isFinite(remaining)) timer = setTimeout(() => resolve(onTimeout()), remaining);
        abortListener = () => resolve(onTimeout());
        signal?.addEventListener("abort", abortListener, { once: true });
      })
    ]);
  } finally {
    clearTimeout(timer);
    if (abortListener) signal?.removeEventListener("abort", abortListener);
  }
}

// Whether a partial list may be chosen from yet. Zero means the first matching
// stream wins as soon as it arrives; the sentinel means only a complete list
// counts; anything else is a grace period for better sources to turn up.
export function canSelectFromPartialList({ waitSeconds = 0, elapsedMs = 0 } = {}) {
  const wait = normalizeSelectionWaitSeconds(waitSeconds);
  if (wait === 0) return true;
  if (wait === WAIT_FOREVER_SECONDS) return false;
  return elapsedMs >= wait * 1000;
}

// The route the background resolve belongs to. It runs on the detail screen and
// nowhere else, so leaving that screen is what ends it.
const RESOLVE_HOST_ROUTE = "detail";

// Whether an answer still belongs to the page that asked for it.
//
// Two things end that claim: a newer resolve started, meaning the person tapped
// something else, or they are no longer on the detail screen at all. Either one
// has to abandon the answer, because the worst thing this feature could do is
// open a player for a title somebody already walked away from.
//
// Unknown counts as abandoned. Called with nothing it returns true, so a caller
// that fails to report where it is loses its answer rather than acting on it.
export function shouldAbandonAutoResolve({ startedToken, currentToken, currentRoute } = {}) {
  return startedToken !== currentToken || currentRoute !== RESOLVE_HOST_ROUTE;
}

// Whether a route should paint a waiting screen instead of its own page.
//
// Continue Watching opens the player through Detail, which exists on that path
// only to load the metadata -- router calls it "Continue Watching's transient
// Detail" and replaces it the moment the load finishes. Until now it painted
// its whole page first, so one tap showed a screen nobody asked for.
//
// Back navigation is the exception, and the important one: closing the player
// returns to this same Detail route, and that time the page is the destination.
// Hiding it then would land the viewer on a spinner that never resolves.
//
// Browser only, and not because the feature is: the waiting screen's styles
// live behind `.desktop-browser` in desktop.css, a class carrying every
// browser rather than only desktop ones. On a television that class is absent,
// so hiding the page there would trade it for unstyled markup. Television
// keeps the page until those styles exist.
export function shouldPaintRouteHandoff({
  autoOpenContinueWatching = false,
  isBackNavigation = false,
  isBrowser = false
} = {}) {
  return Boolean(autoOpenContinueWatching) && !isBackNavigation && Boolean(isBrowser);
}

// Where Back belongs once playback has started.
//
// The stream route is a real destination when its list was shown: the person
// chose from it and may want to choose again. It is not a destination when it
// was only a doorway -- auto selection picked a stream and the list never
// appeared -- and landing there on the way back strands them on a screen they
// never asked for, needing a second Back to leave.
//
// `handedOff` is the whole distinction, and it is false whenever nothing was
// selected automatically. That is what keeps the picker reachable: no choice
// means the list was shown, which means Back still returns to it.
//
// Continue Watching goes Home rather than Detail because its Detail was
// replaced on the way in -- router calls it a transient route -- so there is no
// Detail entry to go back to.
export function resolveHandoffReturnRoute({
  handedOff = false,
  continueWatchingBackHome = false
} = {}) {
  if (!handedOff) {
    return "stream";
  }
  return continueWatchingBackHome ? "home" : "detail";
}

// Resolves to the stream auto-play would have chosen, along with everything
// fetched on the way. The streams come back even when nothing was chosen, so
// the caller can hand them to the stream screen rather than fetching twice.
export async function resolveAutoPlayStream({
  itemId,
  itemType,
  videoId,
  tmdbId,
  imdbId,
  season,
  episode,
  settings = {},
  installedAddonNames = new Set(),
  preferredBingeGroup = "",
  shouldCancel = () => false,
  onProgress = null,
  repository = streamRepository,
  now = () => Date.now(),
  deadlineAt = streamSelectionDeadline(settings.streamAutoPlayTimeoutSeconds ?? 2147483647),
  returnOnFirstMatch = false,
  verifySelection = null,
  signal = null
} = {}) {
  if (!isAutoPlayEffectivelyEnabled(settings)) {
    return { streams: [], selected: null, cancelled: false, reason: "disabled" };
  }
  if (!itemType || !videoId) {
    return { streams: [], selected: null, cancelled: false, reason: "no-target" };
  }

  const cancelled = () => Boolean(signal?.aborted || shouldCancel());
  if (cancelled()) return { streams: [], selected: null, cancelled: true, reason: "cancelled" };
  const knownAddonNames = new Set(installedAddonNames);
  const type = normalizeStreamType(itemType);
  const startedAt = now();
  const waitSeconds = normalizeSelectionWaitSeconds(settings.streamAutoPlayTimeoutSeconds);
  const reusableStream = reusableStreamPreference(settings, itemId, videoId);
  let streams = [];
  let selected = null;
  let finished = false;
  let complete = false;
  let timedOut = false;
  let releaseCandidate;
  const firstCandidate = new Promise((resolve) => {
    releaseCandidate = resolve;
  });

  let revision = 0,
    checkedRevision = -1,
    verification = null,
    bestVerified = null;
  const verifiedProbes = new Map();
  let verifiedHdrExcluded = false;
  const verify = () => {
    if (!verifySelection || selected || finished || cancelled() || Date.now() >= deadlineAt)
      return Promise.resolve();
    if (verification) return verification;
    const atRevision = revision;
    verification = Promise.resolve()
      .then(() =>
        verifySelection(
          {
            streams: [...streams],
            selected: choose(),
            preferredBingeGroup,
            deadlineAt,
            complete,
            probes: [...verifiedProbes]
          },
          () => finished || cancelled() || Date.now() >= deadlineAt
        )
      )
      .then((result) => {
        if (finished || cancelled()) return;
        checkedRevision = atRevision;
        verifiedHdrExcluded = result?.hdrExcluded === true;
        for (const [key, probe] of result?.probes || []) verifiedProbes.set(key, probe);
        if (result?.streams) {
          const byId = new Map(result.streams.map((stream) => [stream.id, stream]));
          streams = streams.map((stream) => {
            const updated = byId.get(stream.id);
            return updated?.url && !stream.url
              ? { ...stream, url: updated.url, externalUrl: null }
              : stream;
          });
        }
        if (result?.selected) {
          bestVerified = result.selected;
          if (
            (complete && atRevision === revision) ||
            (!complete && canSelectFromPartialList({ waitSeconds, elapsedMs: now() - startedAt }))
          ) {
            selected = bestVerified;
            if (returnOnFirstMatch) releaseCandidate({ status: "success", data: [] });
          }
        }
      })
      .catch(() => {
        checkedRevision = atRevision;
      })
      .finally(() => {
        verification = null;
        if (!selected && checkedRevision !== revision && !finished && Date.now() < deadlineAt)
          void verify();
      });
    return verification;
  };

  const choose = ({ allowOther = false } = {}) => {
    const candidate = selectAutoPlayStream(streams, {
      reusableStream,
      filenameStreamDisplayMode: settings.filenameStreamDisplayMode,
      filenameStreamFilter: settings.filenameStreamFilter,
      filenameTranscodeFilter: settings.filenameTranscodeFilter,
      mode: settings.streamAutoPlayMode,
      hdrPreference: resolveHdrPreference(settings),
      source: settings.streamAutoPlaySource,
      regexPattern: settings.streamAutoPlayRegex,
      installedAddonNames: knownAddonNames,
      selectedAddons: settings.streamAutoPlaySelectedAddons,
      selectedPlugins: settings.streamAutoPlaySelectedPlugins,
      preferredBingeGroup,
      preferBingeGroupInSelection: Boolean(preferredBingeGroup)
    });
    // A partial addon response must not beat a still-pending remembered source.
    return reusableStream &&
      !complete &&
      !allowOther &&
      !matchesReusableStream(candidate, reusableStream)
      ? null
      : candidate;
  };

  const absorb = (groups) => {
    const incoming = flattenStreams({ status: "success", data: groups });
    if (!incoming.length) return;
    streams = mergeStreamItems(streams, incoming);
    revision++;
    onProgress?.({ streams, count: streams.length });
  };

  const options = {
    itemId,
    tmdbId,
    imdbId,
    season,
    episode,
    signal,
    priorityBingeGroup: preferredBingeGroup,
    onAddon: (addon) => {
      const name = String(addon?.displayName || addon?.name || "").trim();
      if (name && !finished && !cancelled()) knownAddonNames.add(name);
    },
    onChunk: (chunkResult) => {
      if (finished || cancelled() || chunkResult?.status !== "success") return;
      absorb(Array.isArray(chunkResult.data) ? chunkResult.data : []);
      if (verifySelection) {
        void verify();
        return;
      }
      // A chunk is a partial list, so it only counts once the grace period for
      // better sources has passed.
      if (!canSelectFromPartialList({ waitSeconds, elapsedMs: now() - startedAt })) return;
      const candidate = choose();
      if (candidate?.id) {
        selected = candidate;
        if (returnOnFirstMatch) releaseCandidate({ status: "success", data: [] });
      }
    }
  };

  let cancelListener;
  const aborted = new Promise((resolve) => {
    cancelListener = () => resolve({ status: "cancelled", data: [] });
    if (signal?.aborted) cancelListener();
    else signal?.addEventListener("abort", cancelListener, { once: true });
  });
  const cleanup = () => signal?.removeEventListener("abort", cancelListener);
  let result;
  try {
    result = await withinStreamSelectionDeadline(
      () => {
        const all = Promise.resolve(
          repository.getStreamsFromAllAddons(type, videoId, options)
        ).then((value) => {
          complete = true;
          return value;
        });
        return Promise.race([
          returnOnFirstMatch ? Promise.race([all, firstCandidate]) : all,
          aborted
        ]);
      },
      deadlineAt,
      () => {
        timedOut = true;
        return { status: "success", data: [] };
      }
    );
  } catch (error) {
    // A failed fetch is not a failed feature: the caller falls back to the
    // stream screen, which reports the error the way it always has.
    finished = true;
    cleanup();
    return {
      streams,
      selected: null,
      cancelled: cancelled(),
      reason: cancelled() ? "cancelled" : "error",
      error
    };
  }

  if (cancelled()) {
    finished = true;
    cleanup();
    return { streams, selected: null, cancelled: true, reason: "cancelled" };
  }

  streams = mergeStreamItems(streams, flattenStreams(result));
  revision++;
  onProgress?.({ streams, count: streams.length });
  if (verifySelection && !selected && !timedOut) {
    // A complete discovery waits for the corresponding compatibility pass.
    // Earlier partial passes cannot finalize a different candidate revision.
    while (checkedRevision !== revision && !cancelled() && Date.now() < deadlineAt) {
      await withinStreamSelectionDeadline(
        () => verify(),
        deadlineAt,
        () => null
      );
    }
  }
  finished = true;
  cleanup();
  if (cancelled()) return { streams, selected: null, cancelled: true, reason: "cancelled" };
  if (verifySelection && !selected) selected = bestVerified;

  if (!selected && !verifySelection) {
    // The list is complete now, so the grace period no longer applies.
    const candidate = choose({ allowOther: true });
    if (candidate?.id) selected = candidate;
  }

  return {
    streams,
    selected: selected || null,
    cancelled: false,
    complete,
    hdrExcluded:
      verifiedHdrExcluded ||
      (!selected &&
        resolveHdrPreference(settings) === "AVOID" &&
        filterAutoPlaySourceStreams(streams, {
          source: settings.streamAutoPlaySource,
          installedAddonNames: knownAddonNames,
          selectedAddons: settings.streamAutoPlaySelectedAddons,
          selectedPlugins: settings.streamAutoPlaySelectedPlugins
        }).some((stream) => hdrFromText(stream) === true)),
    timedOut: timedOut && !selected,
    deadlineAt,
    preferredBingeGroup,
    ...(verifySelection ? { probes: [...verifiedProbes] } : {}),
    reason: selected ? "selected" : timedOut ? "timeout" : "no-match"
  };
}

// Deliberately exclude source URLs, regex text, tokens and exception bodies.
export function reportAutoPlaySelection(entry, result, settings = {}) {
  const reasons = new Set([
    "selected",
    "timeout",
    "no-match",
    "cancelled",
    "error",
    "disabled",
    "no-target",
    "filtered-choice"
  ]);
  console.warn(
    "[AutoPlay] " +
      JSON.stringify({
        entry,
        event: "selection-finished",
        reason: reasons.has(result.reason) ? result.reason : "no-match",
        waitSeconds: normalizeSelectionWaitSeconds(settings.streamAutoPlayTimeoutSeconds),
        received: Array.isArray(result.streams) ? result.streams.length : 0,
        selected: Boolean(result.selected),
        complete: result.complete === true,
        timedOut: result.timedOut === true
      })
  );
}
