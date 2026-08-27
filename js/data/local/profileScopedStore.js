import { LocalStore } from "../../core/storage/localStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { SyncHydrationState } from "../../core/profile/syncHydrationState.js";

const PROFILE_SCOPED_VERSION = 1;
const PROFILES_KEY = "profiles";
const SETTINGS_SYNC_DEBOUNCE_MS = 1500;
const SETTINGS_SYNC_PENDING_KEY = "profileSettingsSyncPendingProfiles";

const scheduledSettingsSyncTimers = new Map();
const settingsSyncInFlightByProfile = new Map();
const scopedStoreReplayers = new Map();

function normalizeProfileId(profileId) {
  const raw = String(profileId ?? ProfileManager.getActiveProfileId() ?? "1").trim();
  return raw || "1";
}

function cloneValue(value) {
  if (value == null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function isProfileScopedEnvelope(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    value.__profileScoped === true &&
    Number(value.version || 0) === PROFILE_SCOPED_VERSION &&
    value.profiles &&
    typeof value.profiles === "object"
  );
}

function getKnownProfileIds() {
  const storedProfiles = LocalStore.get(PROFILES_KEY, null);
  const ids = Array.isArray(storedProfiles)
    ? storedProfiles
        .map((profile) => String(profile?.id || profile?.profileIndex || "").trim())
        .filter(Boolean)
    : [];
  if (!ids.includes("1")) {
    ids.unshift("1");
  }
  return Array.from(new Set(ids));
}

function createEmptyEnvelope() {
  return {
    __profileScoped: true,
    version: PROFILE_SCOPED_VERSION,
    profiles: {}
  };
}

function normalizeEnvelopeProfiles(profiles = {}, normalize) {
  const normalized = {};
  Object.entries(profiles || {}).forEach(([profileId, value]) => {
    const normalizedProfileId = normalizeProfileId(profileId);
    normalized[normalizedProfileId] = normalize(cloneValue(value) || {});
  });
  return normalized;
}

function readEnvelope(key, normalize, { legacyMigration = "all" } = {}) {
  const raw = LocalStore.get(key, null);
  if (isProfileScopedEnvelope(raw)) {
    const next = {
      ...raw,
      profiles: normalizeEnvelopeProfiles(raw.profiles, normalize)
    };
    if (JSON.stringify(next) !== JSON.stringify(raw)) {
      LocalStore.set(key, next);
    }
    return next;
  }

  if (raw == null) {
    return createEmptyEnvelope();
  }

  const profileIds = legacyMigration === "active" ? [normalizeProfileId()] : getKnownProfileIds();
  const normalizedLegacy = normalize(cloneValue(raw) || {});
  const migrated = createEmptyEnvelope();
  profileIds.forEach((profileId) => {
    migrated.profiles[profileId] = cloneValue(normalizedLegacy);
  });
  LocalStore.set(key, migrated);
  return migrated;
}

function persistEnvelope(key, envelope) {
  LocalStore.set(key, envelope);
}

function readPendingSettingsSyncProfiles() {
  const value = LocalStore.get(SETTINGS_SYNC_PENDING_KEY, {}) || {};
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function markProfileSettingsCloudSyncPending(profileId = null) {
  const normalizedProfileId = normalizeProfileId(profileId);
  const pending = readPendingSettingsSyncProfiles();
  pending[normalizedProfileId] = Date.now();
  LocalStore.set(SETTINGS_SYNC_PENDING_KEY, pending);
}

export function clearProfileSettingsCloudSyncPending(profileId = null) {
  const normalizedProfileId = normalizeProfileId(profileId);
  const pending = readPendingSettingsSyncProfiles();
  if (!Object.prototype.hasOwnProperty.call(pending, normalizedProfileId)) {
    return;
  }
  delete pending[normalizedProfileId];
  LocalStore.set(SETTINGS_SYNC_PENDING_KEY, pending);
}

export function hasProfileSettingsCloudSyncPending(profileId = null) {
  const normalizedProfileId = normalizeProfileId(profileId);
  const pending = readPendingSettingsSyncProfiles();
  return Object.prototype.hasOwnProperty.call(pending, normalizedProfileId);
}

function ensureProfileValue(key, envelope, normalize, profileId, { seedFromPrimary = true } = {}) {
  const normalizedProfileId = normalizeProfileId(profileId);
  if (Object.prototype.hasOwnProperty.call(envelope.profiles, normalizedProfileId)) {
    return envelope.profiles[normalizedProfileId];
  }

  const primaryValue = envelope.profiles["1"];
  const seed = seedFromPrimary && primaryValue != null ? cloneValue(primaryValue) : normalize({});
  envelope.profiles[normalizedProfileId] = normalize(seed || {});
  persistEnvelope(key, envelope);
  return envelope.profiles[normalizedProfileId];
}

export function queueProfileSettingsCloudSync(
  profileId = null,
  delayMs = SETTINGS_SYNC_DEBOUNCE_MS,
  mutation = null
) {
  const normalizedProfileId = normalizeProfileId(profileId);
  markProfileSettingsCloudSyncPending(normalizedProfileId);
  SyncHydrationState.recordPendingSettingsMutation(normalizedProfileId, mutation);
  // Capture the scope at scheduling time. A delayed mutation is safe only for
  // the same authenticated user/profile generation that initiated it.
  const scheduledContext = SyncHydrationState.capture(normalizedProfileId);
  if (scheduledSettingsSyncTimers.has(normalizedProfileId)) {
    clearTimeout(scheduledSettingsSyncTimers.get(normalizedProfileId));
  }
  const timerId = setTimeout(() => {
    scheduledSettingsSyncTimers.delete(normalizedProfileId);
    const runPush = async () => {
      const activePush = settingsSyncInFlightByProfile.get(normalizedProfileId);
      if (activePush) {
        await activePush.catch(() => false);
      }
      const pushPromise = import("../../core/profile/profileSettingsSyncService.js")
        .then(({ ProfileSettingsSyncService }) =>
          scheduledContext.then((context) =>
            ProfileSettingsSyncService.push(normalizedProfileId, {
              automatic: true,
              context,
              requireActiveProfile: true
            })
          )
        )
        .catch((error) => {
          console.warn("Profile settings sync enqueue failed", error);
          return false;
        })
        .finally(() => {
          if (settingsSyncInFlightByProfile.get(normalizedProfileId) === pushPromise) {
            settingsSyncInFlightByProfile.delete(normalizedProfileId);
          }
        });
      settingsSyncInFlightByProfile.set(normalizedProfileId, pushPromise);
      await pushPromise;
    };
    void runPush();
  }, delayMs);
  scheduledSettingsSyncTimers.set(normalizedProfileId, timerId);
}

export function replayProfileSettingsMutation(profileId, mutation) {
  const replay = scopedStoreReplayers.get(String(mutation?.storeKey || "").trim());
  if (!replay || !mutation) return false;
  return replay(normalizeProfileId(profileId), mutation);
}

export function createProfileScopedStore({
  key,
  normalize,
  merge,
  seedFromPrimary = true,
  legacyMigration = "all"
}) {
  const listeners = new Set();
  const mergeValues =
    typeof merge === "function"
      ? merge
      : (current, partial) => ({ ...(current || {}), ...(partial || {}) });

  const emitChange = (profileId, previousValue, value, metadata = {}) => {
    if (JSON.stringify(previousValue) === JSON.stringify(value)) {
      return;
    }
    listeners.forEach((listener) => {
      try {
        listener({
          profileId: normalizeProfileId(profileId),
          previousValue: cloneValue(previousValue),
          value: cloneValue(value),
          ...metadata
        });
      } catch (error) {
        console.warn("Profile-scoped store listener failed", error);
      }
    });
  };

  const store = {
    getForProfile(profileId) {
      const envelope = readEnvelope(key, normalize, { legacyMigration });
      return cloneValue(
        ensureProfileValue(key, envelope, normalize, profileId, { seedFromPrimary })
      );
    },

    get() {
      return this.getForProfile(normalizeProfileId());
    },

    replaceForProfile(profileId, nextValue, { silentSync = false, syncSource = "user", mutation } = {}) {
      const envelope = readEnvelope(key, normalize, { legacyMigration });
      const normalizedProfileId = normalizeProfileId(profileId);
      const previousValue = Object.prototype.hasOwnProperty.call(envelope.profiles, normalizedProfileId)
        ? cloneValue(envelope.profiles[normalizedProfileId])
        : normalize({});
      const value = normalize(cloneValue(nextValue) || {});
      envelope.profiles[normalizedProfileId] = value;
      persistEnvelope(key, envelope);
      emitChange(normalizedProfileId, previousValue, value, {
        reason: mutation?.operation || "replace",
        silentSync: Boolean(silentSync),
        syncSource
      });
      if (!silentSync) {
        queueProfileSettingsCloudSync(normalizedProfileId, SETTINGS_SYNC_DEBOUNCE_MS, {
          storeKey: key,
          operation: mutation?.operation || "replace",
          value: cloneValue(envelope.profiles[normalizedProfileId]),
          partial: cloneValue(mutation?.partial),
          source: syncSource
        });
      }
      return cloneValue(value);
    },

    setForProfile(profileId, partial, { silentSync = false, syncSource = "user" } = {}) {
      const current = this.getForProfile(profileId);
      return this.replaceForProfile(profileId, mergeValues(current, partial), {
        silentSync,
        syncSource,
        mutation: { operation: "set", partial: cloneValue(partial) }
      });
    },

    set(partial, options = {}) {
      return this.setForProfile(normalizeProfileId(options.profileId), partial, options);
    },

    clearProfile(profileId, { silentSync = false, syncSource = "user" } = {}) {
      const envelope = readEnvelope(key, normalize, { legacyMigration });
      const normalizedProfileId = normalizeProfileId(profileId);
      const previousValue = Object.prototype.hasOwnProperty.call(envelope.profiles, normalizedProfileId)
        ? cloneValue(envelope.profiles[normalizedProfileId])
        : null;
      delete envelope.profiles[normalizedProfileId];
      persistEnvelope(key, envelope);
      if (previousValue != null) {
        emitChange(normalizedProfileId, previousValue, null, {
          reason: "clear",
          silentSync: Boolean(silentSync),
          syncSource
        });
      }
      if (!silentSync) {
        queueProfileSettingsCloudSync(normalizedProfileId, SETTINGS_SYNC_DEBOUNCE_MS, {
          storeKey: key,
          operation: "clear",
          source: syncSource
        });
      }
    },

    subscribe(listener) {
      if (typeof listener !== "function") {
        return () => {};
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };

  scopedStoreReplayers.set(key, (profileId, mutation) => {
    if (mutation.operation === "clear") {
      store.clearProfile(profileId, { silentSync: true });
      return true;
    }
    if (mutation.operation === "set" && mutation.partial && typeof mutation.partial === "object") {
      store.setForProfile(profileId, mutation.partial, { silentSync: true });
      return true;
    }
    store.replaceForProfile(profileId, mutation.value, { silentSync: true });
    return true;
  });

  return store;
}
