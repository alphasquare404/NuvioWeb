const PROFILE_SCOPED_VERSION = 1;

// These values describe account/profile state only. Device identity, generic
// image caches, and offline downloads deliberately remain outside this list.
const ACCOUNT_LOCAL_STORAGE_KEYS = new Set([
  "profiles",
  "activeProfileId",
  "rememberLastProfile",
  "hasEverSelectedProfile",
  "installedAddonUrls",
  "installedAddonDisplayNames",
  "installedAddonEnabledStates",
  "mediaConnections",
  "mediaServerSyncState",
  "watchedItems",
  "savedLibraryItems",
  "watchProgressItems",
  "streamPreferences",
  "trackPreferences",
  "trackPreferenceSyncPayload",
  "continueWatchingPreferences",
  "libraryPreferences",
  "traktAuthState",
  "simklAuthState",
  "simklSyncState",
  "startupSyncState",
  "watchProgressSyncState",
  "watchedItemsSyncState",
  "profileSettingsSyncCache",
  "profileSettingsSyncPendingProfiles",
  "homeCatalogSettingsPendingPushTokens",
  "providerCredentialSyncPendingProfiles",
  "homeContinueWatchingDisplaySnapshot",
  "homeContinueWatchingEnrichmentCache",
  "browserProfileAvatarCacheIndex",
  "memberAccessCache",
  "manualSyncCode",
  "pluginSources",
  "pluginsEnabled",
  "pluginProviderPlays",
  "pluginState:migrationComplete",
  "nuvioSyncBackoffState"
]);

const ACCOUNT_LOCAL_STORAGE_PREFIXES = [
  "cloudLibraryPlaybackSessions:",
  "cloudLibraryPlaybackProgress:",
  "libraryTraktState:",
  "traktCachedStats:"
];

// Nothing survives a sign-out.
//
// Torrent settings used to, on the reasoning that they describe this device
// rather than this account: turning uploading off on a metered laptop should not
// quietly turn itself back on. That holds only while the same person signs back
// in. Let someone else in and the "device preference" is really the previous
// person's, and two of the three switches decide whether this machine uploads --
// which costs bandwidth and, in some places, rather more than that.
//
// Inheriting a stranger's upload setting is silent. Losing your own is visible
// and takes one tap to put back. The visible mistake is the cheaper one.
//
// It also carried the previous account's profile ids across, so a new account's
// storage still named profiles that had never belonged to it.
const PRESERVED_PROFILE_SCOPED_KEYS = new Set();
const runtimeResetHandlers = new Set();

function isProfileScopedEnvelope(rawValue) {
  if (typeof rawValue !== "string" || !rawValue) return false;
  try {
    const value = JSON.parse(rawValue);
    return Boolean(
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      value.__profileScoped === true &&
      Number(value.version || 0) === PROFILE_SCOPED_VERSION &&
      value.profiles &&
      typeof value.profiles === "object" &&
      !Array.isArray(value.profiles)
    );
  } catch (_) {
    return false;
  }
}

function shouldRemoveLocalStorageKey(key, rawValue) {
  if (PRESERVED_PROFILE_SCOPED_KEYS.has(key)) return false;
  return (
    ACCOUNT_LOCAL_STORAGE_KEYS.has(key) ||
    ACCOUNT_LOCAL_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix)) ||
    isProfileScopedEnvelope(rawValue)
  );
}

export function registerAccountRuntimeResetHandler(handler) {
  if (typeof handler !== "function") return () => {};
  runtimeResetHandlers.add(handler);
  return () => runtimeResetHandlers.delete(handler);
}

export async function resetAccountRuntimeState() {
  await Promise.allSettled(Array.from(runtimeResetHandlers, (handler) => handler()));
}

export function clearAccountLocalData(
  storage = globalThis.localStorage,
  sessionStorage = globalThis.sessionStorage
) {
  if (storage) {
    const keys = [];
    try {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key) keys.push(key);
      }
    } catch (_) {
      // Best effort: session cleanup still prevents route/focus leakage.
    }

    keys.forEach((key) => {
      try {
        const raw = storage.getItem(key);
        if (shouldRemoveLocalStorageKey(key, raw)) storage.removeItem(key);
      } catch (_) {
        // Never leave sensitive values in diagnostics.
      }
    });
  }

  try {
    sessionStorage?.removeItem?.("homeReturnFocusState");
  } catch (_) {}
}

export function hasAccountLocalData(storage = globalThis.localStorage) {
  if (!storage) return false;
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && shouldRemoveLocalStorageKey(key, storage.getItem(key))) return true;
    }
  } catch (_) {
    return true;
  }
  return false;
}

/**
 * Remove one profile's account-scoped local data.
 *
 * Deleting a profile used to remove only its entry in the profile list. The
 * slot was then handed to the next profile created with it, which inherited the
 * previous person's watch history, progress, provider credentials and sync
 * baselines -- and could push them back to the cloud as its own.
 *
 * The shapes the app stores this data in are all handled here: arrays of rows
 * carrying `profileId`, profile envelopes with a `profiles` map, plain maps
 * keyed by profile id, and device rows suffixed with `:<profileId>`.
 */
export function clearProfileLocalData(profileId, storage = globalThis.localStorage) {
  const pid = String(profileId || "").trim();
  if (!pid || !storage) return false;
  const keys = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key) keys.push(key);
    }
  } catch (_) {
    return false;
  }

  let changed = false;
  keys.forEach((key) => {
    try {
      if (key.endsWith(`:${pid}`)) {
        storage.removeItem(key);
        changed = true;
        return;
      }
      const raw = storage.getItem(key);
      if (raw == null || !shouldRemoveLocalStorageKey(key, raw)) return;
      let value = null;
      try {
        value = JSON.parse(raw);
      } catch (_) {
        return;
      }
      if (Array.isArray(value)) {
        const next = value.filter((item) => String(item?.profileId ?? "1") !== pid);
        if (next.length !== value.length) {
          storage.setItem(key, JSON.stringify(next));
          changed = true;
        }
        return;
      }
      if (!value || typeof value !== "object") return;
      if (
        value.profiles &&
        typeof value.profiles === "object" &&
        !Array.isArray(value.profiles) &&
        Object.prototype.hasOwnProperty.call(value.profiles, pid)
      ) {
        delete value.profiles[pid];
        storage.setItem(key, JSON.stringify(value));
        changed = true;
        return;
      }
      // Plain maps keyed by profile id, such as the sync baselines. Only a
      // nested object is profile state; a scalar under the same key could be
      // an unrelated setting and is left alone.
      if (
        Object.prototype.hasOwnProperty.call(value, pid) &&
        value[pid] &&
        typeof value[pid] === "object"
      ) {
        delete value[pid];
        storage.setItem(key, JSON.stringify(value));
        changed = true;
      }
    } catch (_) {
      // Best effort: a key that cannot be read is not a reason to stop.
    }
  });
  return changed;
}
