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
  "pluginState:migrationComplete",
  "nuvioSyncBackoffState"
]);

const ACCOUNT_LOCAL_STORAGE_PREFIXES = [
  "cloudLibraryPlaybackSessions:",
  "cloudLibraryPlaybackProgress:",
  "libraryTraktState:",
  "traktCachedStats:"
];

// Torrent settings are intentionally device-level. Do not infer scope from an
// envelope alone: this explicit exception preserves the existing behaviour.
const PRESERVED_PROFILE_SCOPED_KEYS = new Set(["torrentSettings"]);
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
