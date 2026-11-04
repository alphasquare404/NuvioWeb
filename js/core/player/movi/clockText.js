// The two clock lines the built-in player shows: the wall clock, and when the
// film ends. Both are pure arithmetic on the playhead, which is all the canvas
// route has — and all it needs.

export function formatWallClock(date = new Date()) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * "Ends at 23:14" — empty when there is nothing to say.
 *
 * A live stream has no finite duration, a finished film has nothing left, and a
 * position past the end (a rounding overshoot at `ended`) should not print a time
 * in the past. All three return "" so the line simply disappears.
 */
export function endsAtLabel(positionSeconds, durationSeconds, now = new Date()) {
  const position = Number(positionSeconds);
  const duration = Number(durationSeconds);
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return "";
  const remaining = duration - position;
  if (!Number.isFinite(remaining) || remaining <= 0) return "";
  return `Ends at ${formatWallClock(new Date(now.getTime() + remaining * 1000))}`;
}
