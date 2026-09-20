import {
  WATCH_PROGRESS_COMPLETED_THRESHOLD,
  WATCH_PROGRESS_STARTED_THRESHOLD,
  getWatchProgressFraction
} from "../../domain/model/watchProgress.js";

// Both providers treat a scrobble stop at or above this as "watched", which is
// why a stop cannot carry a position past it.
const PROVIDER_WATCHED_THRESHOLD = 0.8;

/**
 * Whether a terminal position is worth reporting to the tracking providers.
 *
 * A few seconds of a stream that never got going is not worth an entry, and
 * anything past the watched threshold belongs to the completion path.
 */
export function shouldSendTerminalScrobbleReport(context) {
  if (!context?.contentId) return false;
  // A series episode the provider cannot address is dropped by the services
  // anyway; deciding it here keeps the reason visible.
  if (String(context.contentType || "") === "series" && !Number(context.episodeNumber || 0)) {
    return false;
  }
  const fraction = getWatchProgressFraction(context);
  return (
    fraction >= WATCH_PROGRESS_STARTED_THRESHOLD && fraction < WATCH_PROGRESS_COMPLETED_THRESHOLD
  );
}

/**
 * Which message carries this position without misrepresenting it.
 *
 * A stop past the provider's watched threshold would finish the title, so the
 * band between that threshold and our own completion mark needs the other
 * message: a pause records where the viewer got to and claims nothing more.
 * Leaving that band unreported, as it was, meant stopping at 85% reached the
 * provider as nothing at all -- too far along for a stop, not far enough to
 * count as finished.
 */
export function terminalScrobbleAction(context) {
  return getWatchProgressFraction(context) >= PROVIDER_WATCHED_THRESHOLD ? "pause" : "stop";
}

/**
 * The identity of a terminal scrobble report: which episode, and how far in.
 *
 * Leaving the player, backgrounding the app and an external player's final
 * report all describe the same thing -- where the user got to -- and the app
 * lifecycle can deliver several of them for one position. A phone switching
 * away and back while the player screen is open fires one every time, so
 * without this the same position would be posted over and over.
 *
 * Progress is rounded to a tenth of a percent: finer than that is not a real
 * change in position, only timing jitter between two reads of currentTime.
 */
export function terminalScrobbleReportKey(context) {
  if (!context?.contentId) return "";
  return [
    String(context.contentId),
    String(context.contentType || ""),
    context.seasonNumber ?? "",
    context.episodeNumber ?? "",
    Math.round(Number(context.progressPercent || 0) * 10)
  ].join("|");
}
