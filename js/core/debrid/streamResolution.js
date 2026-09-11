/**
 * Classifies a debrid stream resolution from its metadata fields.
 *
 * Parsed metadata has priority over free text so an accurate resolution is
 * not overridden by a lower-priority title token such as a remaster name.
 */

export function resolutionFromText(text = "") {
  if (/\b(2160p?|4k|uhd)\b/i.test(text)) return "P2160";
  if (/\b(1440p?|2k)\b/i.test(text)) return "P1440";
  if (/\b(1080p?|fhd)\b/i.test(text)) return "P1080";
  if (/\b(720p?|hd)\b/i.test(text)) return "P720";
  if (/\b576p?\b/i.test(text)) return "P576";
  if (/\b(480p?|sd)\b/i.test(text)) return "P480";
  if (/\b360p?\b/i.test(text)) return "P360";
  return "UNKNOWN";
}

export function resolutionFromFields(values = []) {
  for (const value of values) {
    if (!value) continue;
    const resolution = resolutionFromText(value);
    if (resolution !== "UNKNOWN") return resolution;
  }
  return "UNKNOWN";
}
