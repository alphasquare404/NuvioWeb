import { WatchProgressSource } from "../local/traktSettingsStore.js";

/**
 * Which tracking provider a progress row belongs to, or "" when it is Nuvio
 * Sync's own playback.
 *
 * A row carries this as a `source` tag: the provider's own records arrive as
 * `simkl_playback`/`trakt_history` and the like, while playback this device
 * recorded is tagged with whichever source owned Continue Watching at the time.
 * The tag is what keeps one source's viewing out of another's list, so it has
 * to survive everywhere a row travels -- including a Nuvio cloud round trip,
 * which has no column for it and used to hand every row back as plain "local".
 */
export function watchProgressOwner(item = {}) {
  const source = String(item?.source || "").toLowerCase();
  if (source.startsWith("trakt")) return WatchProgressSource.TRAKT;
  if (source.startsWith("simkl")) return WatchProgressSource.SIMKL;
  return "";
}

/**
 * Whether a row was recorded under a source other than the one asked about.
 *
 * An untagged row belongs to nobody in particular: it predates the tag, or came
 * from another device through a cloud that does not carry it. Those stay
 * visible rather than disappearing from a list they have always been in.
 */
export function isWatchProgressFromOtherSource(item, selectedSource) {
  const owner = watchProgressOwner(item);
  if (!owner) return false;
  return owner !== String(selectedSource || "");
}

/**
 * Whether a progress row belongs in Nuvio's own cloud.
 *
 * Only Nuvio Sync's playback does. A row recorded while a tracking provider
 * owned Continue Watching is that provider's record, kept locally so this
 * device can resume -- pushing it to Nuvio Sync's cloud republishes it as Nuvio
 * Sync's own, which is how a title watched under SIMKL reappeared in Continue
 * Watching on the PWA and on the official app. Those clients see the cloud, not
 * this device's tag, so the only place to stop it is before the push.
 */
export function isNuvioSyncOwnedProgress(item) {
  return !watchProgressOwner(item);
}
