// A downloaded file is stored under an opaque id, which is all the app itself
// needs. The moment it leaves for another app it becomes something a person
// reads in a file list, so it is named from the metadata already on the record.

const EXTENSION_BY_MIME = {
  "video/mp4": "mp4",
  "video/x-m4v": "m4v",
  "video/x-matroska": "mkv",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-msvideo": "avi",
  "video/mp2t": "ts",
  "video/mpeg": "mpg",
  "video/ogg": "ogv",
  "video/3gpp": "3gp"
};

const DEFAULT_CONTAINER = { extension: "mp4", mimeType: "video/mp4" };

// Long enough for a real series-and-episode title, short enough to stay clear of
// the 255-byte limit every filesystem this file can land on shares.
const MAX_BASE_LENGTH = 150;

// Illegal or reserved on the filesystems this file travels to, plus the control
// characters that turn a name into something unopenable.
const UNSAFE_CHARACTERS = /[/\\:*?"<>|\x00-\x1f\x7f]+/g;

function text(value) {
  return String(value == null ? "" : value).trim();
}

function sanitizePart(value) {
  return text(value).replace(UNSAFE_CHARACTERS, " ").replace(/\s+/g, " ").trim();
}

function sanitizeName(value) {
  // A trailing dot or space is silently dropped or rejected depending on where
  // the file lands, so a name can never end in one.
  return sanitizePart(value)
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "");
}

function pickYear(...values) {
  for (const value of values) {
    const match = text(value).match(/\b(19|20)\d{2}\b/);
    if (match) return match[0];
  }
  return "";
}

function pad(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.abs(Math.trunc(number))).padStart(2, "0") : "";
}

// The name and the media type have to name the same container, or iOS appends
// the type's own extension to the one already there and the file arrives as
// "... - The Detail.mkv.mp4". The recorded type is the authority, because it is
// also what the built-in player is handed; the name simply follows it.
export function resolveOfflineHandoffContainer(download = {}) {
  const mimeType = text(download.mimeType).toLowerCase();
  const extension = EXTENSION_BY_MIME[mimeType];
  return extension ? { extension, mimeType } : DEFAULT_CONTAINER;
}

function episodeTitleOf(download = {}, episodeNumber) {
  const title = sanitizePart(download.displaySnapshot?.episode?.title || download.title);
  // The download record falls back to "Episode 4" when a title was never
  // resolved. Repeating that next to S01E04 reads like a bug, so drop it.
  if (!title || new RegExp(`^episode\\s*0*${Number(episodeNumber)}$`, "i").test(title)) return "";
  return title;
}

export function buildOfflineHandoffFileName(download = {}) {
  const isEpisode = text(download.contentType).toLowerCase() === "episode";
  const year = pickYear(
    download.year,
    download.displaySnapshot?.year,
    download.displaySnapshot?.yearRange
  );
  const parts = [];

  if (isEpisode) {
    const series = sanitizePart(
      download.seriesTitle || download.displaySnapshot?.title || download.title
    );
    const season = pad(download.seasonNumber);
    const episode = pad(download.episodeNumber);
    parts.push(year ? `${series} (${year})` : series);
    if (season && episode) parts.push(`S${season}E${episode}`);
    const episodeTitle = episodeTitleOf(download, download.episodeNumber);
    if (episodeTitle) parts.push(episodeTitle);
  } else {
    const title = sanitizePart(download.title || download.displaySnapshot?.title);
    parts.push(year ? `${title} (${year})` : title);
  }

  const base = sanitizeName(parts.filter(Boolean).join(" - ")).slice(0, MAX_BASE_LENGTH);
  return `${sanitizeName(base) || "Video"}.${resolveOfflineHandoffContainer(download).extension}`;
}

// Same trap as the video, with a worse ending: a sidecar named ".srt" but typed
// "text/plain" arrives as ".srt.txt", and a player pairs a subtitle to a video
// by filename -- so the renamed file is simply never found.
const SUBTITLE_TYPE_BY_EXTENSION = {
  vtt: "text/vtt",
  srt: "application/x-subrip"
};

const DEFAULT_SUBTITLE_CONTAINER = { extension: "srt", mimeType: "application/x-subrip" };

export function resolveOfflineSubtitleContainer(subtitle = {}) {
  const extension = text(subtitle.extension).toLowerCase();
  const mimeType = SUBTITLE_TYPE_BY_EXTENSION[extension];
  return mimeType ? { extension, mimeType } : DEFAULT_SUBTITLE_CONTAINER;
}

// The name is what pairs the two: a player matches a sidecar to a video by it,
// and no sheet carries that pairing for us.
export function buildOfflineHandoffSubtitleFileName(download = {}, subtitle = {}) {
  const video = buildOfflineHandoffFileName(download);
  const base = video.slice(0, video.lastIndexOf("."));
  const tag = sanitizePart(subtitle.lang || subtitle.language).replace(/\s+/g, "-");
  return `${base}${tag ? `.${tag}` : ""}.${resolveOfflineSubtitleContainer(subtitle).extension}`;
}
