// Handing a downloaded file to another app is a copy, not a loan: iOS passes the
// bytes across and the receiving player keeps them. Everything here exists so
// that cost is decided deliberately rather than discovered later in Settings.

export const OFFLINE_PLAYBACK_TARGETS = {
  ASK: "ask",
  INTERNAL: "internal",
  EXTERNAL: "external"
};

const TARGET_VALUES = Object.values(OFFLINE_PLAYBACK_TARGETS);

export function normalizeOfflinePlaybackTarget(value) {
  const normalized = String(value == null ? "" : value)
    .trim()
    .toLowerCase();
  return TARGET_VALUES.includes(normalized) ? normalized : OFFLINE_PLAYBACK_TARGETS.ASK;
}

// A partial file handed to a player is a broken file that still occupies the
// space of a whole one, so an unfinished download is never offered.
export function canHandOffOfflineDownload(download = null) {
  return Boolean(download && download.status === "completed" && download.fileName);
}

export function resolveOfflinePlaybackTarget({
  setting,
  download = null,
  supportsHandoff = true
} = {}) {
  if (!supportsHandoff || !canHandOffOfflineDownload(download)) {
    return OFFLINE_PLAYBACK_TARGETS.INTERNAL;
  }
  return normalizeOfflinePlaybackTarget(setting);
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!(bytes > 0)) return "0 B";
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.round(bytes / 1e3)} KB`;
}

export function describeOfflineHandoffStorage({ sizeBytes = 0, freeBytes = null } = {}) {
  const size = Number(sizeBytes) > 0 ? Number(sizeBytes) : 0;
  // Number(null) is a perfectly finite 0, and reporting "0 B free" for a browser
  // that simply never told us would read as a full device.
  const free =
    freeBytes == null || freeBytes === "" || !Number.isFinite(Number(freeBytes))
      ? null
      : Math.max(0, Number(freeBytes));
  const sizeLabel = formatBytes(size);
  const freeLabel = free === null ? "" : formatBytes(free);
  // The receiving app needs room for the whole file before Nuvio's copy can be
  // released, so "enough" means more than the file itself, not exactly it.
  const tight = size > 0 && free !== null && free < size * 1.2;
  const lines = [`The player keeps its own copy of this ${sizeLabel} file.`];
  if (freeLabel) {
    lines.push(
      tight
        ? `Only ${freeLabel} free — the copy may fail part-way.`
        : `${freeLabel} free after Nuvio's own copy.`
    );
  }
  return { sizeLabel, freeLabel, tight, message: lines.join(" ") };
}

export function readStorageHeadroom(estimate = null) {
  const quota = Number(estimate?.quota);
  const usage = Number(estimate?.usage);
  if (!Number.isFinite(quota) || !Number.isFinite(usage)) return null;
  return Math.max(0, quota - usage);
}
