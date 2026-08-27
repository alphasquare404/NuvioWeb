import { LocalStore } from "../../core/storage/localStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { queueProfileSettingsCloudSync } from "./profileScopedStore.js";

const KEY = "continueWatchingPreferences";
const VERSION = 1;

function activeProfileId() {
  return String(ProfileManager.getActiveProfileId() || "1");
}

function normalizeKey(value) {
  return String(value || "").trim();
}

function normalizeState(raw = {}) {
  const dismissedNextUpKeys = Array.isArray(raw.dismissedNextUpKeys)
    ? raw.dismissedNextUpKeys.map(normalizeKey).filter(Boolean)
    : [];
  return {
    version: VERSION,
    dismissedNextUpKeys: Array.from(new Set(dismissedNextUpKeys)).slice(0, 1000)
  };
}

function readAll() {
  const raw = LocalStore.get(KEY, {});
  return raw && typeof raw === "object" ? raw : {};
}

function writeAll(next) {
  LocalStore.set(KEY, next && typeof next === "object" ? next : {});
}

function readForProfile(profileId = activeProfileId()) {
  const all = readAll();
  return normalizeState(all[String(profileId || "1")] || {});
}

function writeForProfile(profileId, state) {
  const pid = String(profileId || "1");
  const all = readAll();
  all[pid] = normalizeState(state);
  writeAll(all);
  const intendedState = normalizeState(all[pid]);
  queueProfileSettingsCloudSync(pid, undefined, {
    source: "user",
    storeKey: "continueWatchingPreferences",
    replay(targetProfileId) {
      const targetAll = readAll();
      targetAll[String(targetProfileId || "1")] = intendedState;
      writeAll(targetAll);
      return true;
    }
  });
  return all[pid];
}

export const ContinueWatchingPreferences = {
  getDismissedNextUpKeys(profileId = activeProfileId()) {
    return readForProfile(profileId).dismissedNextUpKeys;
  },

  replaceDismissedNextUpKeys(keys, profileId = activeProfileId(), { silentSync = false } = {}) {
    const pid = String(profileId || "1");
    const all = readAll();
    all[pid] = normalizeState({ dismissedNextUpKeys: Array.isArray(keys) ? keys : [] });
    writeAll(all);
    if (!silentSync) {
      const intendedState = normalizeState(all[pid]);
      queueProfileSettingsCloudSync(pid, undefined, {
        source: "user",
        storeKey: "continueWatchingPreferences",
        replay(targetProfileId) {
          const targetAll = readAll();
          targetAll[String(targetProfileId || "1")] = intendedState;
          writeAll(targetAll);
          return true;
        }
      });
    }
    return all[pid];
  },

  addDismissedNextUpKey(key, profileId = activeProfileId()) {
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey) {
      return readForProfile(profileId);
    }
    const current = readForProfile(profileId);
    return writeForProfile(profileId, {
      ...current,
      dismissedNextUpKeys: [
        normalizedKey,
        ...current.dismissedNextUpKeys.filter((entry) => entry !== normalizedKey)
      ]
    });
  },

  removeDismissedNextUpKeysForContent(contentId, profileId = activeProfileId()) {
    const normalizedContentId = normalizeKey(contentId);
    if (!normalizedContentId) {
      return readForProfile(profileId);
    }
    const current = readForProfile(profileId);
    return writeForProfile(profileId, {
      ...current,
      dismissedNextUpKeys: current.dismissedNextUpKeys.filter(
        (key) => !key.startsWith(`${normalizedContentId}|`)
      )
    });
  }
};
