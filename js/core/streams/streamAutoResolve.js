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

import { streamRepository } from "../../data/repository/streamRepository.js";
import { flattenStreams, mergeStreamItems } from "./streamList.js";
import { isAutoPlayEffectivelyEnabled, selectAutoPlayStream } from "./streamAutoPlaySelector.js";

// The stream screen's own sentinel for "never choose early": wait for every
// addon before deciding, however long that takes.
const WAIT_FOREVER_SECONDS = 2147483647;

// The stream route carries whatever type the catalog gave it. One place
// decides what that means, so a caller cannot get it subtly wrong.
export function normalizeStreamType(itemType) {
  return String(itemType || "movie").toLowerCase() || "movie";
}

export function normalizeSelectionWaitSeconds(value) {
  return Math.max(0, Math.trunc(Number(value || 0)));
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
  itemType,
  videoId,
  settings = {},
  installedAddonNames = new Set(),
  preferredBingeGroup = "",
  shouldCancel = () => false,
  onProgress = null,
  repository = streamRepository,
  now = () => Date.now()
} = {}) {
  if (!isAutoPlayEffectivelyEnabled(settings)) {
    return { streams: [], selected: null, cancelled: false, reason: "disabled" };
  }
  if (!itemType || !videoId) {
    return { streams: [], selected: null, cancelled: false, reason: "no-target" };
  }

  const type = normalizeStreamType(itemType);
  const startedAt = now();
  const waitSeconds = normalizeSelectionWaitSeconds(settings.streamAutoPlayTimeoutSeconds);
  let streams = [];
  let selected = null;

  const choose = () =>
    selectAutoPlayStream(streams, {
      mode: settings.streamAutoPlayMode,
      source: settings.streamAutoPlaySource,
      regexPattern: settings.streamAutoPlayRegex,
      installedAddonNames,
      selectedAddons: settings.streamAutoPlaySelectedAddons,
      selectedPlugins: settings.streamAutoPlaySelectedPlugins,
      preferredBingeGroup,
      preferBingeGroupInSelection: Boolean(preferredBingeGroup)
    });

  const absorb = (groups) => {
    const incoming = flattenStreams({ status: "success", data: groups });
    if (!incoming.length) return;
    streams = mergeStreamItems(streams, incoming);
    onProgress?.({ streams, count: streams.length });
  };

  const options = {
    onChunk: (chunkResult) => {
      if (selected || shouldCancel() || chunkResult?.status !== "success") return;
      absorb(Array.isArray(chunkResult.data) ? chunkResult.data : []);
      // A chunk is a partial list, so it only counts once the grace period for
      // better sources has passed.
      if (!canSelectFromPartialList({ waitSeconds, elapsedMs: now() - startedAt })) return;
      const candidate = choose();
      if (candidate?.id) selected = candidate;
    }
  };

  let result;
  try {
    result = await repository.getStreamsFromAllAddons(type, videoId, options);
  } catch (error) {
    // A failed fetch is not a failed feature: the caller falls back to the
    // stream screen, which reports the error the way it always has.
    return { streams, selected: null, cancelled: false, reason: "error", error };
  }

  if (shouldCancel()) return { streams, selected: null, cancelled: true, reason: "cancelled" };

  streams = mergeStreamItems(streams, flattenStreams(result));
  onProgress?.({ streams, count: streams.length });

  if (!selected) {
    // The list is complete now, so the grace period no longer applies.
    const candidate = choose();
    if (candidate?.id) selected = candidate;
  }

  return {
    streams,
    selected: selected || null,
    cancelled: false,
    reason: selected ? "selected" : "no-match"
  };
}
