// VTT and SRT, as cues.
//
// Both formats are the same shape once the header is gone: blocks separated by
// blank lines, one line naming the times, the rest the words. So there is one
// block reader rather than one parser per flavour — what differs (a `WEBVTT`
// header, an SRT index line, a comma instead of a point, cue settings after the
// end time) is skipped by the same three rules.

/**
 * `01:02:03.400`, `02:03,400`, `03.400` — seconds, in that order.
 *
 * Returns null rather than NaN for anything that is not a time, because a
 * malformed block should drop one cue and leave the rest of the file usable.
 */
export function parseSubtitleTimestamp(raw) {
  const parts = String(raw ?? "")
    .trim()
    .replace(",", ".")
    .split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const seconds = Number(parts.pop());
  const minutes = Number(parts.pop());
  const hours = parts.length ? Number(parts.pop()) : 0;
  if (!Number.isFinite(seconds) || !Number.isFinite(minutes) || !Number.isFinite(hours))
    return null;
  return hours * 3600 + minutes * 60 + seconds;
}

// `<i>`, `<c.yellow>`, `<00:00:01.000>` — VTT's own markup, never meant to be
// read; and `{\an8}`-style overrides that leak out of converted ASS files.
function cleanCueText(lines) {
  return lines
    .join("\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

/**
 * Parse a subtitle file into `[{ start, end, text }]`, sorted by start.
 *
 * Format is not trusted: `format` is a hint at most, because addon URLs carry
 * no extension more often than they carry one.
 */
export function parseSubtitleText(text) {
  const source = String(text ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");
  if (!source.trim()) return [];

  const cues = [];
  for (const block of source.split(/\n{2,}/)) {
    const lines = block.split("\n").filter((line) => line.trim() !== "");
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex === -1) continue;

    const [rawStart, rawEnd] = lines[timingIndex].split("-->");
    // VTT may append cue settings after the end time ("align:start position:10%").
    const end = parseSubtitleTimestamp(
      String(rawEnd ?? "")
        .trim()
        .split(/\s+/)[0]
    );
    const start = parseSubtitleTimestamp(rawStart);
    if (start == null || end == null) continue;

    const body = cleanCueText(lines.slice(timingIndex + 1));
    if (!body) continue;
    cues.push({ start, end: Math.max(end, start), text: body });
  }

  cues.sort((left, right) => left.start - right.start);
  return cues;
}

/**
 * The cue covering `seconds`, or null.
 *
 * Binary search because this runs on every time tick: a linear scan over a
 * film's worth of cues, twenty times a second, is work for nothing.
 */
export function findActiveCue(cues, seconds) {
  if (!Array.isArray(cues) || !cues.length) return null;
  const time = Number(seconds);
  if (!Number.isFinite(time)) return null;

  let low = 0;
  let high = cues.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const cue = cues[middle];
    if (time < cue.start) high = middle - 1;
    else if (time > cue.end) low = middle + 1;
    else return cue;
  }
  return null;
}
