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
