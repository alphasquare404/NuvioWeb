import { LocalStore } from "../../core/storage/localStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";

const SESSION_PREFIX = "cloudLibraryPlaybackSessions:";
const PROGRESS_PREFIX = "cloudLibraryPlaybackProgress:";
const MAX_SESSIONS = 30;
const MAX_PROGRESS_ENTRIES = 300;

function activeProfileId() {
  return String(ProfileManager.getActiveProfileId() || "1");
}

function readMap(prefix) {
  const raw = LocalStore.get(`${prefix}${activeProfileId()}`, {});
  return raw && typeof raw === "object" ? raw : {};
}

function writeMap(prefix, map) {
  LocalStore.set(`${prefix}${activeProfileId()}`, map && typeof map === "object" ? map : {});
}

function trimByRecency(map, limit) {
  const entries = Object.entries(map || {})
    .sort(
      ([, left], [, right]) =>
        Number(right?.updatedAt || right?.startedAt || 0) -
        Number(left?.updatedAt || left?.startedAt || 0)
    )
    .slice(0, limit);
  return Object.fromEntries(entries);
}

// A cloud/debrid playable URL is signed and short-lived, and the item it came
// from lives in memory only. This session record is what lets Continue Watching
// resolve a fresh URL later, after the Library was closed or the app restarted.
export const CloudLibraryPlaybackSessionStore = {
  start(session = {}) {
    const token = String(session.token || "").trim();
    if (!token) return null;
    const entry = {
      token,
      itemKey: String(session.itemKey || "").trim(),
      fileKey: String(session.fileKey || "").trim(),
      itemName: String(session.itemName || "").trim(),
      fileName: String(session.fileName || "").trim(),
      providerId: String(session.providerId || "").trim(),
      providerName: String(session.providerName || "").trim(),
      libraryId: session.libraryId ? String(session.libraryId) : null,
      itemType: String(session.itemType || "").trim(),
      itemId: String(session.itemId || "").trim(),
      poster: session.poster || null,
      fileId: String(session.fileId || "").trim(),
      playbackUrl: session.playbackUrl || null,
      fileSizeBytes: Number(session.fileSizeBytes || 0) || null,
      startedAt: Date.now(),
      updatedAt: Date.now()
    };
    if (!entry.itemKey) return null;
    const map = readMap(SESSION_PREFIX);
    map[token] = entry;
    writeMap(SESSION_PREFIX, trimByRecency(map, MAX_SESSIONS));
    return entry;
  },

  get(token) {
    const key = String(token || "").trim();
    if (!key) return null;
    return readMap(SESSION_PREFIX)[key] || null;
  },

  clear(token) {
    const key = String(token || "").trim();
    if (!key) return;
    const map = readMap(SESSION_PREFIX);
    if (!(key in map)) return;
    delete map[key];
    writeMap(SESSION_PREFIX, map);
  }
};

export const CloudLibraryPlaybackProgressStore = {
  record(token, { positionMs = 0, durationMs = 0, completed = false } = {}) {
    const session = CloudLibraryPlaybackSessionStore.get(token);
    if (!session?.itemKey) return null;
    const position = Math.max(0, Math.trunc(Number(positionMs || 0)));
    const duration = Math.max(0, Math.trunc(Number(durationMs || 0)));
    if (!position && !completed) return null;
    const map = readMap(PROGRESS_PREFIX);
    map[session.itemKey] = {
      contentId: session.itemKey,
      contentType: "cloud",
      videoId: session.token,
      title: session.itemName || session.fileName || "",
      fileName: session.fileName || "",
      poster: session.poster || null,
      providerId: session.providerId,
      providerName: session.providerName,
      libraryId: session.libraryId,
      itemType: session.itemType,
      itemId: session.itemId,
      fileId: session.fileId,
      fileKey: session.fileKey,
      playbackUrl: session.playbackUrl || null,
      fileSizeBytes: session.fileSizeBytes || null,
      positionMs: position,
      durationMs: duration,
      completed: Boolean(completed),
      updatedAt: Date.now()
    };
    writeMap(PROGRESS_PREFIX, trimByRecency(map, MAX_PROGRESS_ENTRIES));
    return map[session.itemKey];
  },

  findForContinueWatching(contentId) {
    const key = String(contentId || "").trim();
    if (!key) return null;
    return readMap(PROGRESS_PREFIX)[key] || null;
  },

  list() {
    return Object.values(readMap(PROGRESS_PREFIX))
      .filter((entry) => entry && entry.contentId)
      .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
  },

  remove(contentId) {
    const key = String(contentId || "").trim();
    if (!key) return;
    const map = readMap(PROGRESS_PREFIX);
    if (!(key in map)) return;
    delete map[key];
    writeMap(PROGRESS_PREFIX, map);
  }
};
