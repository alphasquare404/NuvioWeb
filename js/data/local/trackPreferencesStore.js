import { LocalStore } from "../../core/storage/localStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { queueProfileSettingsCloudSync } from "./profileScopedStore.js";

const KEY = "trackPreferences";
const PASSTHROUGH_KEY = "trackPreferenceSyncPayload";
const MAX_ENTRIES = 500;

function activeProfileId() {
  return String(ProfileManager.getActiveProfileId() || "1");
}

function normalizeText(value) {
  return String(value ?? "").trim() || null;
}

function normalizeAudioPreference(value = {}) {
  const preference = {
    language: normalizeText(value?.language),
    name: normalizeText(value?.name),
    trackId: normalizeText(value?.trackId)
  };
  return Object.values(preference).some(Boolean) ? preference : null;
}

function readAll() {
  const raw = LocalStore.get(KEY, {});
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

function writeAll(next) {
  LocalStore.set(KEY, next && typeof next === "object" ? next : {});
}

function readEntries(profileId = activeProfileId()) {
  const entries = readAll()[String(profileId || "1")];
  return Array.isArray(entries)
    ? entries.filter((entry) => entry && typeof entry === "object" && entry.contentId)
    : [];
}

function writeEntries(profileId, entries) {
  const all = readAll();
  all[String(profileId || "1")] = entries;
  writeAll(all);
}

function readPassthrough(profileId) {
  const all = LocalStore.get(PASSTHROUGH_KEY, {});
  const payload = all?.[String(profileId || "1")];
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
}

function writePassthrough(profileId, payload) {
  const all = LocalStore.get(PASSTHROUGH_KEY, {});
  const normalizedAll = all && typeof all === "object" && !Array.isArray(all) ? all : {};
  normalizedAll[String(profileId || "1")] = payload;
  LocalStore.set(PASSTHROUGH_KEY, normalizedAll);
}

function contentIdFromKey(keyName, field) {
  const prefix = `${field}|`;
  return String(keyName || "").startsWith(prefix) ? String(keyName).slice(prefix.length) : null;
}

export const TrackPreferencesStore = {
  getAudio(contentId, profileId = activeProfileId()) {
    const normalizedContentId = normalizeText(contentId);
    if (!normalizedContentId) {
      return null;
    }
    const entry = readEntries(profileId).find(
      (candidate) => candidate.contentId === normalizedContentId
    );
    return normalizeAudioPreference(entry?.audio);
  },

  setAudio(contentId, audio, profileId = activeProfileId()) {
    const normalizedContentId = normalizeText(contentId);
    const normalizedAudio = normalizeAudioPreference(audio);
    if (!normalizedContentId || !normalizedAudio) {
      return;
    }

    const entries = readEntries(profileId).filter(
      (entry) => entry.contentId !== normalizedContentId
    );
    entries.unshift({
      contentId: normalizedContentId,
      audio: normalizedAudio,
      updatedAtMs: Date.now()
    });
    if (entries.length > MAX_ENTRIES) {
      entries.length = MAX_ENTRIES;
    }
    writeEntries(profileId, entries);
    queueProfileSettingsCloudSync(profileId, undefined, {
      source: "user",
      storeKey: "trackPreferences",
      replay(targetProfileId) {
        const targetEntries = readEntries(targetProfileId).filter(
          (entry) => entry.contentId !== normalizedContentId
        );
        targetEntries.unshift({
          contentId: normalizedContentId,
          audio: normalizedAudio,
          updatedAtMs: Date.now()
        });
        writeEntries(targetProfileId, targetEntries.slice(0, MAX_ENTRIES));
        return true;
      }
    });
  },

  exportFeaturePayload(profileId = activeProfileId()) {
    return readEntries(profileId).reduce((payload, entry) => {
      const contentId = normalizeText(entry?.contentId);
      const audio = normalizeAudioPreference(entry?.audio);
      if (!contentId || !audio) return payload;
      if (audio.language) payload[`audio_lang|${contentId}`] = audio.language;
      if (audio.name) payload[`audio_name|${contentId}`] = audio.name;
      if (audio.trackId) payload[`audio_track_id|${contentId}`] = audio.trackId;
      return payload;
    }, { ...readPassthrough(profileId) });
  },

  importFeaturePayload(rawFeature = {}, profileId = activeProfileId()) {
    writePassthrough(profileId, { ...(rawFeature || {}) });
    const byContentId = new Map();
    Object.entries(rawFeature || {}).forEach(([keyName, value]) => {
      const field = ["audio_lang", "audio_name", "audio_track_id"].find((candidate) =>
        String(keyName).startsWith(`${candidate}|`)
      );
      if (!field) return;
      const contentId = contentIdFromKey(keyName, field);
      if (!contentId) return;
      const current = byContentId.get(contentId) || {};
      if (field === "audio_lang") current.language = normalizeText(value);
      if (field === "audio_name") current.name = normalizeText(value);
      if (field === "audio_track_id") current.trackId = normalizeText(value);
      byContentId.set(contentId, current);
    });

    const imported = Array.from(byContentId.entries())
      .map(([contentId, audio]) => ({
        contentId,
        audio: normalizeAudioPreference(audio),
        updatedAtMs: Date.now()
      }))
      .filter((entry) => entry.audio)
      .slice(0, MAX_ENTRIES);
    if (!imported.length) return Object.keys(rawFeature || {}).length > 0;

    const untouched = readEntries(profileId).filter((entry) => !byContentId.has(entry.contentId));
    writeEntries(profileId, [...imported, ...untouched].slice(0, MAX_ENTRIES));
    return true;
  }
};
