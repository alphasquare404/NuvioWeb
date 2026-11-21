import { AuthManager } from "../auth/authManager.js";
import { registerAccountRuntimeResetHandler } from "../auth/accountLocalDataReset.js";
import { addonRepository } from "../../data/repository/addonRepository.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { ProfileManager } from "./profileManager.js";
import { SyncHydrationState, SyncPullResult } from "./syncHydrationState.js";

const ADDONS_TABLE = "addons";
const TABLE = "tv_addons";

// Records the outcome of the latest pull so the Addons screen can show a
// visible sync state on TV.
let lastPullStatus = { state: "idle", count: 0, error: null, at: 0 };
const pendingLocalSnapshots = new Map();
let writeRevision = 0;

function recordPullStatus(state, { count = 0, error = null } = {}) {
  lastPullStatus = {
    state,
    count: Number(count) || 0,
    error: error ? String(error.message || error) : null,
    at: Date.now()
  };
}

function isMissingResourceError(error) {
  if (!error) {
    return false;
  }
  if (error.status === 404) {
    return true;
  }
  if (typeof error.code === "string" && (error.code === "PGRST205" || error.code === "PGRST202")) {
    return true;
  }
  const message = String(error.message || "");
  return (
    message.includes("PGRST205") ||
    message.includes("PGRST202") ||
    message.includes("Could not find the table") ||
    message.includes("Could not find the function")
  );
}

async function resolveProfileId() {
  const activeId = String(ProfileManager.getActiveProfileId() || "1");
  const direct = Number(activeId);
  if (Number.isFinite(direct) && direct > 0) {
    return Math.trunc(direct);
  }

  const profiles = await ProfileManager.getProfiles();
  const activeProfile = profiles.find((profile) => String(profile.id) === activeId);
  const candidate = Number(activeProfile?.profileIndex || activeProfile?.id || 1);
  return Number.isFinite(candidate) && candidate > 0 ? Math.trunc(candidate) : 1;
}

async function resolveAddonProfileId() {
  const profileId = await resolveProfileId();
  if (profileId === 1) {
    return 1;
  }

  const profiles = await ProfileManager.getProfiles();
  const activeProfile = profiles.find((profile) => {
    const id = Number(profile?.profileIndex || profile?.id || 1);
    return Number.isFinite(id) && Math.trunc(id) === profileId;
  });
  const usesPrimaryAddons =
    typeof activeProfile?.usesPrimaryAddons === "boolean"
      ? activeProfile.usesPrimaryAddons
      : typeof activeProfile?.uses_primary_addons === "boolean"
        ? activeProfile.uses_primary_addons
        : true;

  return usesPrimaryAddons ? 1 : profileId;
}

// Only missing schema resources justify trying an older read contract.
// Network/auth/server failures must preserve local state and fail the pull.
async function readRemoteAddonRows(ownerId, profileId) {
  try {
    return await SupabaseApi.select(
      ADDONS_TABLE,
      `user_id=eq.${encodeURIComponent(ownerId)}&profile_id=eq.${profileId}&select=*&order=sort_order.asc`,
      true
    );
  } catch (error) {
    if (!isMissingResourceError(error)) throw error;
  }
  try {
    return await SupabaseApi.select(
      TABLE,
      `owner_id=eq.${encodeURIComponent(ownerId)}&select=*&order=position.asc`,
      true
    );
  } catch (error) {
    if (!isMissingResourceError(error)) throw error;
  }
  return SupabaseApi.rpc("sync_pull_addons", { p_profile_id: profileId }, true);
}

function extractAddonEntries(rows) {
  if (
    !Array.isArray(rows) ||
    rows.some(
      (row) => typeof (row?.url || row?.base_url) !== "string" || !(row.url || row.base_url).trim()
    )
  ) {
    throw new Error("Invalid remote addon list");
  }
  return rows.map((row) => ({
    url: addonRepository.canonicalizeUrl(row.url || row.base_url),
    name:
      row.display_name ||
      row.displayName ||
      row.custom_name ||
      row.customName ||
      row.alias ||
      row.name ||
      "",
    enabled: row.enabled !== false
  }));
}

function mergePendingAddonChanges(entries, pending) {
  if (!pending) return entries;
  const before = pending.before;
  const after = pending.after;
  const remote = new Map(entries.map((entry) => [entry.url, entry]));
  const beforeSet = new Set(before.urls);
  const afterSet = new Set(after.urls);
  const urls = [
    ...after.urls.filter((url) => remote.has(url) || !beforeSet.has(url)),
    ...entries.map((entry) => entry.url).filter((url) => !afterSet.has(url) && !beforeSet.has(url))
  ];
  return urls.map((url) => {
    const entry = remote.get(url) || { url, name: "", enabled: true };
    const added = !beforeSet.has(url) && afterSet.has(url);
    return {
      ...entry,
      name:
        added || before.names?.[url] !== after.names?.[url] ? after.names?.[url] || "" : entry.name,
      enabled:
        added || before.enabled?.[url] !== after.enabled?.[url]
          ? after.enabled?.[url] !== false
          : entry.enabled
    };
  });
}

async function applyRemoteAddonEntries(entries) {
  const currentNames = addonRepository.getAddonDisplayNameOverrides();
  const namesChanged = addonRepository.setAddonDisplayNameOverrides(
    entries.map((entry) => ({ url: entry.url, name: entry.name || currentNames[entry.url] || "" })),
    { replace: true }
  );
  const enabledChanged = addonRepository.setAddonEnabledStates(entries, { replace: true });
  const urls = entries.map((entry) => entry.url);
  const orderChanged = await addonRepository.setAddonOrder(urls, { silent: true });
  if (namesChanged || enabledChanged || orderChanged)
    addonRepository.notifyAddonsChanged("remote-pull");
  return urls;
}

export const LibrarySyncService = {
  getLastPullStatus() {
    return lastPullStatus;
  },

  markLocalMutation(profileId = null, mutation = null) {
    const key = String(profileId ?? ProfileManager.getActiveProfileId() ?? "1");
    const existing = pendingLocalSnapshots.get(key);
    const after = mutation?.after || addonRepository.getSyncSnapshot();
    pendingLocalSnapshots.set(key, {
      before: existing?.before || mutation?.before || addonRepository.getSyncSnapshot(),
      after
    });
  },

  hasPendingLocalMutation(profileId = null) {
    return pendingLocalSnapshots.has(
      String(profileId ?? ProfileManager.getActiveProfileId() ?? "1")
    );
  },

  async pull({ context = null } = {}) {
    const localUrls = addonRepository.getInstalledAddonUrls();
    let syncContext = context;
    try {
      if (!AuthManager.isAuthenticated) {
        recordPullStatus("signed-out");
        return { result: SyncPullResult.FAILED, items: localUrls };
      }
      const profileId = await resolveAddonProfileId();
      syncContext ||= await SyncHydrationState.capture(profileId);
      if (!(await SyncHydrationState.beginPull(syncContext, "addons"))) {
        return { result: SyncPullResult.FAILED, items: localUrls };
      }
      const revision = writeRevision;
      const rows = await readRemoteAddonRows(syncContext.userId, profileId);
      const entries = extractAddonEntries(rows);
      if (
        !(await SyncHydrationState.isCurrent(syncContext)) ||
        (await resolveAddonProfileId()) !== profileId ||
        revision !== writeRevision
      ) {
        return { result: SyncPullResult.FAILED, items: localUrls };
      }
      // Merge before publishing: never expose a temporary list that discards
      // pending additions, removals, names or enabled states.
      const pending = pendingLocalSnapshots.get(String(syncContext.activeProfileId));
      const urls = await applyRemoteAddonEntries(mergePendingAddonChanges(entries, pending));
      const result = urls.length ? SyncPullResult.SUCCESS_WITH_DATA : SyncPullResult.SUCCESS_EMPTY;
      recordPullStatus("ok", { count: urls.length });
      await SyncHydrationState.completePull(syncContext, "addons", result);
      return { result, items: urls };
    } catch (error) {
      recordPullStatus("error", { count: localUrls.length, error });
      if (syncContext)
        await SyncHydrationState.completePull(syncContext, "addons", SyncPullResult.FAILED);
      console.warn("Library sync pull failed", error);
      return { result: SyncPullResult.FAILED, items: localUrls };
    }
  },

  async push({ automatic = false, context = null } = {}) {
    try {
      if (!AuthManager.isAuthenticated) return false;
      const profileId = await resolveAddonProfileId();
      const syncContext = context || (await SyncHydrationState.capture(profileId));
      if (
        !(await SyncHydrationState.isCurrent(syncContext)) ||
        (await resolveAddonProfileId()) !== profileId
      )
        return false;
      const key = String(syncContext.activeProfileId);
      const pending = pendingLocalSnapshots.get(key);
      // Reading remote state does not authorize writing it back. Automatic
      // pushes are only needed for actual local edits.
      if (automatic && !pending) return true;
      if (automatic && !(await SyncHydrationState.allowsAutomaticPush(syncContext, "addons")))
        return false;
      const snapshot = addonRepository.getSyncSnapshot();
      // Replacement belongs to one server transaction. Never fall back to
      // client DELETE + INSERT, which exposes an empty list between requests.
      // An unavailable RPC is a failed save; local changes remain intact.
      await SupabaseApi.rpc(
        "sync_push_addons",
        {
          p_profile_id: profileId,
          p_addons: snapshot.urls.map((url, index) => ({
            url,
            sort_order: index,
            enabled: snapshot.enabled[url] !== false,
            ...(snapshot.names[url] ? { name: snapshot.names[url] } : {})
          }))
        },
        true
      );
      writeRevision += 1;
      if (!(await SyncHydrationState.isCurrent(syncContext))) return false;
      // A newer edit made during this request still needs its own save.
      if (pendingLocalSnapshots.get(key) === pending) pendingLocalSnapshots.delete(key);
      return true;
    } catch (error) {
      console.warn("Library sync push failed; local changes retained", error);
      return false;
    }
  }
};

registerAccountRuntimeResetHandler(() => {
  pendingLocalSnapshots.clear();
  writeRevision += 1;
  lastPullStatus = { state: "idle", count: 0, error: null, at: 0 };
});
