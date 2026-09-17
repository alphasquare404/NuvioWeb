// Decides whether a WatchProgressStore/WatchedItemsStore change event should
// trigger a Continue Watching refresh on Home. Ordinary high-frequency local
// playback writes ("upsert"/"remove") are ignored so a slow addon/Trakt call
// never re-runs enrichment on every tick; a profile-scoped bulk replace
// ("replaceForProfile", e.g. a cloud-sync pull) always refreshes; and an
// authoritative write (e.g. an accepted external-player callback report)
// refreshes even though its reason is "upsert"/"remove".
export function shouldRefreshContinueWatchingForChange({ profileId, reason, authoritative } = {}, activeProfileId) {
  if (String(profileId || "") !== String(activeProfileId || "")) {
    return false;
  }
  if (reason === "replaceForProfile") {
    return true;
  }
  return Boolean(authoritative) && (reason === "upsert" || reason === "remove");
}
