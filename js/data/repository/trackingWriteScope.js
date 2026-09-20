import { TraktSettingsStore } from "../local/traktSettingsStore.js";

/**
 * Whether a tracking provider currently owns Watch Progress.
 *
 * Being signed in to a provider is not permission to write to it. Continue
 * Watching belongs to exactly one source at a time, and a provider that is only
 * connected -- not selected -- must not receive playback: progress recorded
 * under Nuvio Sync was reaching SIMKL through the scrobble fan-out, so
 * switching the source afterwards surfaced titles the provider should never
 * have heard about, and no local filter could hide them because they were
 * genuinely on the provider's server by then.
 *
 * This is the rule the watched-items writes already followed; it lives here so
 * every write path shares one definition of "this provider owns playback".
 */
export function ownsWatchProgress(provider) {
  const selected = String(TraktSettingsStore.get()?.watchProgressSource || "");
  return Boolean(provider) && selected === String(provider);
}
