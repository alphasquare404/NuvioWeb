// How long this is, said in the metadata the app already has.
//
// An HLS playlist that is still being written has no total duration -- the player
// treats it as something live until the closing tag arrives, so its scrubber shows
// no length and a film looks open-ended for the few minutes the server needs. The
// runtime is already in the route's metadata, so the one thing that can be done
// without touching the player is to say it out loud where the title is shown.

/** @param {number|string} minutes runtime from the catalogue */
export function formatRuntimeLabel(minutes) {
  const total = Math.round(Number(minutes) || 0);
  if (!Number.isFinite(total) || total <= 0) return "";
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/**
 * The subtitle line the player shows, with the runtime appended when it is known.
 *
 * Kept pure so the join rule is testable: one separator, no dangling dot when the
 * episode title is missing, and untouched when there is no runtime.
 */
export function buildPlayerSubtitle({ title = "", minutes = 0, separator = " · " } = {}) {
  const cleanTitle = String(title || "").trim();
  const label = formatRuntimeLabel(minutes);
  return [cleanTitle, label].filter(Boolean).join(separator);
}
