export function parseExternalPlaybackPositionParts(hours, minutes, seconds, durationMs = 0) {
  const values = [hours, minutes, seconds].map((value) => String(value || "").trim());
  if (values.some((value) => !/^\d{0,2}$/.test(value))) return null;
  const [hourValue, minuteValue, secondValue] = values.map((value) => Number(value || 0));
  if (minuteValue > 59 || secondValue > 59) return null;
  const milliseconds = hourValue * 3_600_000 + minuteValue * 60_000 + secondValue * 1_000;
  if (Number(durationMs) > 0 && milliseconds > Number(durationMs)) return null;
  return milliseconds;
}

export function validateExternalPlaybackPositionParts(hours, minutes, seconds, durationMs = 0) {
  const positionMs = parseExternalPlaybackPositionParts(hours, minutes, seconds, durationMs);
  if (positionMs == null) return { valid: false, positionMs: 0, message: "Enter a valid position within the runtime." };
  if (positionMs <= 0) return { valid: false, positionMs, message: "Enter a playback position greater than zero." };
  return { valid: true, positionMs, message: "" };
}

// A report's duration says "this is how long the media is". Zero says no such
// thing -- it is what a handoff that never learned the runtime leaves behind,
// and sending it as a measurement had the entire report refused, so a position
// typed into the manual prompt was silently never saved.
export function externalPlaybackReportDurationSeconds(knownDurationMs) {
  const milliseconds = Number(knownDurationMs);
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds / 1000 : null;
}

// The entry fields beside this label are HH/MM/SS, so printing a runtime as
// minutes:seconds told a viewer "138:05" and then asked them to type 02:18:05.
// Anything an hour or longer is shown the way it has to be entered. Returns ""
// when there is no runtime to show, so the caller can say so in its own words.
export function formatExternalPlaybackDuration(milliseconds) {
  const totalSeconds = Math.round(Number(milliseconds) / 1000);
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "";
  const pad = (value) => String(value).padStart(2, "0");
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
