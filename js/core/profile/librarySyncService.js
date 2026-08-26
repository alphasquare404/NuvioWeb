import { AuthManager } from "../auth/authManager.js";
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

function isOnConflictConstraintError(error) {
  if (!error) {
    return false;
  }
  if (typeof error.code === "string" && error.code === "42P10") {
    return true;
  }
  const message = String(error.message || "");
  return (
    message.includes("42P10") ||
    message.includes("no unique or exclusion constraint matching the ON CONFLICT specification")
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

function extractAddonUrls(rows = []) {
  return extractAddonEntries(rows)
    .map((entry) => entry.url)
    .filter(Boolean);
}

function extractAddonEntries(rows = []) {
  return (rows || [])
    .map((row) => ({
      url: row?.url || row?.base_url || null,
      displayName:
        row?.display_name ||
        row?.displayName ||
        row?.custom_name ||
        row?.customName ||
        row?.alias ||
        row?.name ||
        null,
      name: row?.name || null,
      enabled: row?.enabled !== false
    }))
    .filter((entry) => entry.url);
}

function applyPulledAddons(rows = []) {
  const entries = extractAddonEntries(rows);
  const urls = entries.map((entry) => entry.url).filter(Boolean);
  const currentNames = addonRepository.getAddonDisplayNameOverrides();
  const displayNamesChanged = addonRepository.setAddonDisplayNameOverrides(
    entries.map((entry) => {
      const cleanUrl = addonRepository.canonicalizeUrl(entry.url);
      return {
        url: entry.url,
        name: entry.displayName || entry.name || currentNames[cleanUrl] || ""
      };
    }),
    { replace: true }
  );
  const enabledStatesChanged = addonRepository.setAddonEnabledStates(entries, { replace: true });
  return { urls, changed: displayNamesChanged || enabledStatesChanged };
}

async function isStillActiveAddonProfile(profileId) {
  return (await resolveAddonProfileId()) === profileId;
}

async function applyRemoteAddonRows(rows, profileId) {
  // The active profile can change while a remote pull is in flight. Never
  // write a completed pull into the newly active profile's local namespace.
  if (!(await isStillActiveAddonProfile(profileId))) {
    return null;
  }
  const applied = applyPulledAddons(rows);
  const orderChanged = await addonRepository.setAddonOrder(applied.urls, { silent: true });
  if (applied.changed || orderChanged) {
    // Remote hydration must update mounted Home and Addons views, but it is not
    // a local mutation and must not schedule a write-back push.
    addonRepository.notifyAddonsChanged("remote-pull");
  }
  return applied.urls;
}

async function restorePendingAddonAdditions(profileId, remoteUrls = []) {
  const pending = pendingLocalSnapshots.get(String(ProfileManager.getActiveProfileId() || "1"));
  if (!pending) return remoteUrls;
  const beforeUrls = pending.before?.urls || [];
  const afterUrls = pending.after?.urls || [];
  const beforeSet = new Set(beforeUrls);
  const afterSet = new Set(afterUrls);
  const removedUrls = new Set(beforeUrls.filter((url) => !afterSet.has(url)));
  const mergedUrls = [
    ...afterUrls.filter((url) => remoteUrls.includes(url) || !beforeSet.has(url)),
    ...remoteUrls.filter((url) => !afterSet.has(url) && !removedUrls.has(url))
  ];
  await addonRepository.setAddonOrder(mergedUrls, { silent: true });
  addonRepository.setAddonEnabledStates(
    mergedUrls
      .filter((url) => !beforeSet.has(url) || pending.before.enabled?.[url] !== pending.after.enabled?.[url])
      .map((url) => ({ url, enabled: pending.after.enabled?.[url] !== false })),
    { replace: false }
  );
  addonRepository.setAddonDisplayNameOverrides(
    mergedUrls
      .filter((url) => !beforeSet.has(url) || pending.before.names?.[url] !== pending.after.names?.[url])
      .map((url) => ({ url, name: pending.after.names?.[url] || "" })),
    { replace: false }
  );
  addonRepository.notifyAddonsChanged("remote-pull");
  return mergedUrls;
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
    return pendingLocalSnapshots.has(String(profileId ?? ProfileManager.getActiveProfileId() ?? "1"));
  },

  async pull({ context = null } = {}) {
    let readError = null;
    try {
      if (!AuthManager.isAuthenticated) {
        recordPullStatus("signed-out");
        return { result: SyncPullResult.FAILED, items: [] };
      }
      const localUrls = addonRepository.getInstalledAddonUrls();
      const profileId = await resolveAddonProfileId();
      const syncContext = context || (await SyncHydrationState.capture(profileId));
      if (!(await SyncHydrationState.beginPull(syncContext, "addons"))) {
        return { result: SyncPullResult.FAILED, items: localUrls };
      }
      const ownerId = await AuthManager.getEffectiveUserId();
      let addonTableMissing = false;

      try {
        const addonRows = await SupabaseApi.select(
          ADDONS_TABLE,
          `user_id=eq.${encodeURIComponent(ownerId)}&profile_id=eq.${profileId}&select=*&order=sort_order.asc`,
          true
        );
        if (!(await SyncHydrationState.isCurrent(syncContext))) {
          return { result: SyncPullResult.FAILED, items: localUrls };
        }
        const addonUrls = await applyRemoteAddonRows(addonRows, profileId);
        if (addonUrls == null) {
          return { result: SyncPullResult.FAILED, items: localUrls };
        }
        recordPullStatus("ok", { count: addonUrls.length });
        const resolvedUrls = await restorePendingAddonAdditions(profileId, addonUrls);
        const result = resolvedUrls.length ? SyncPullResult.SUCCESS_WITH_DATA : SyncPullResult.SUCCESS_EMPTY;
        await SyncHydrationState.completePull(syncContext, "addons", result);
        return { result, items: resolvedUrls };
      } catch (addonsTableError) {
        addonTableMissing = isMissingResourceError(addonsTableError);
        if (!addonTableMissing) {
          readError = addonsTableError;
        }
        console.warn("Addon sync pull addons-table read failed", addonsTableError);
      }

      let tvTableMissing = false;
      try {
        const rows = await SupabaseApi.select(
          TABLE,
          `owner_id=eq.${encodeURIComponent(ownerId)}&select=*&order=position.asc`,
          true
        );
        if (!(await SyncHydrationState.isCurrent(syncContext))) {
          return { result: SyncPullResult.FAILED, items: localUrls };
        }
        const urls = await applyRemoteAddonRows(rows, profileId);
        if (urls == null) {
          return { result: SyncPullResult.FAILED, items: localUrls };
        }
        recordPullStatus("ok", { count: urls.length });
        const resolvedUrls = await restorePendingAddonAdditions(profileId, urls);
        const result = resolvedUrls.length ? SyncPullResult.SUCCESS_WITH_DATA : SyncPullResult.SUCCESS_EMPTY;
        await SyncHydrationState.completePull(syncContext, "addons", result);
        return { result, items: resolvedUrls };
      } catch (tvTableError) {
        tvTableMissing = isMissingResourceError(tvTableError);
        if (!tvTableMissing) {
          readError = tvTableError;
        }
        console.warn("Addon sync pull tv-table read failed", tvTableError);
      }

      if (addonTableMissing && tvTableMissing) {
        try {
          const rpcRows = await SupabaseApi.rpc(
            "sync_pull_addons",
            { p_profile_id: profileId },
            true
          );
          if (!(await SyncHydrationState.isCurrent(syncContext))) {
            return { result: SyncPullResult.FAILED, items: localUrls };
          }
          const urls = await applyRemoteAddonRows(rpcRows, profileId);
          if (urls == null) {
            return { result: SyncPullResult.FAILED, items: localUrls };
          }
          recordPullStatus("ok", { count: urls.length });
          const resolvedUrls = await restorePendingAddonAdditions(profileId, urls);
          const result = resolvedUrls.length ? SyncPullResult.SUCCESS_WITH_DATA : SyncPullResult.SUCCESS_EMPTY;
          await SyncHydrationState.completePull(syncContext, "addons", result);
          return { result, items: resolvedUrls };
        } catch (rpcError) {
          readError = rpcError;
          console.warn("Addon sync pull RPC failed", rpcError);
        }
      }

      if (readError) {
        recordPullStatus("error", { count: localUrls.length, error: readError });
        await SyncHydrationState.completePull(syncContext, "addons", SyncPullResult.FAILED);
      } else {
        recordPullStatus("ok", { count: localUrls.length });
      }
      return { result: SyncPullResult.FAILED, items: localUrls };
    } catch (error) {
      recordPullStatus("error", { error });
      console.warn("Library sync pull failed", error);
      return { result: SyncPullResult.FAILED, items: [] };
    }
  },

  async push({ automatic = false, context = null } = {}) {
    try {
      if (!AuthManager.isAuthenticated) {
        return false;
      }
      const profileId = await resolveAddonProfileId();
      const syncContext = context || (await SyncHydrationState.capture(profileId));
      if (automatic && !(await SyncHydrationState.allowsAutomaticPush(syncContext, "addons"))) {
        console.info("[Sync] addons automatic push blocked", { hydration: SyncHydrationState.get(syncContext, "addons") });
        return false;
      }
      const urls = addonRepository.getInstalledAddonUrls();

      try {
        await SupabaseApi.rpc(
          "sync_push_addons",
          {
            p_profile_id: profileId,
            p_addons: urls.map((url, index) => ({
              url,
              sort_order: index,
              enabled: addonRepository.isAddonEnabled(url),
              ...(addonRepository.getAddonDisplayNameOverride(url)
                ? { name: addonRepository.getAddonDisplayNameOverride(url) }
                : {})
            }))
          },
          true
        );
        pendingLocalSnapshots.delete(String(ProfileManager.getActiveProfileId() || "1"));
        return true;
      } catch (rpcError) {
        console.warn("Addon sync push RPC failed, falling back to legacy table", rpcError);
      }

      const ownerId = await AuthManager.getEffectiveUserId();
      try {
        await SupabaseApi.delete(
          ADDONS_TABLE,
          `user_id=eq.${encodeURIComponent(ownerId)}&profile_id=eq.${profileId}`,
          true
        );
        const addonRows = urls.map((url, index) => {
          const name = addonRepository.getAddonDisplayNameOverride(url);
          return {
            user_id: ownerId,
            profile_id: profileId,
            url,
            sort_order: index,
            enabled: addonRepository.isAddonEnabled(url),
            ...(name ? { name } : {})
          };
        });
        if (addonRows.length) {
          try {
            await SupabaseApi.upsert(ADDONS_TABLE, addonRows, "user_id,profile_id,url", true);
          } catch (upsertError) {
            if (!isOnConflictConstraintError(upsertError)) {
              throw upsertError;
            }
            await SupabaseApi.upsert(ADDONS_TABLE, addonRows, null, true);
          }
        }
        pendingLocalSnapshots.delete(String(ProfileManager.getActiveProfileId() || "1"));
        return true;
      } catch (addonsTableError) {
        if (!isMissingResourceError(addonsTableError)) {
          console.warn("Addon sync push addons-table fallback failed", addonsTableError);
          return false;
        }
        console.warn(
          "Addon sync push addons-table missing, trying tv_addons fallback",
          addonsTableError
        );
      }

      const rows = urls.map((baseUrl, index) => ({
        owner_id: ownerId,
        base_url: baseUrl,
        position: index
      }));
      try {
        await SupabaseApi.delete(TABLE, `owner_id=eq.${encodeURIComponent(ownerId)}`, true);
        if (rows.length) {
          await SupabaseApi.upsert(TABLE, rows, "owner_id,base_url", true);
        }
        pendingLocalSnapshots.delete(String(ProfileManager.getActiveProfileId() || "1"));
        return true;
      } catch (tvTableError) {
        console.warn("Addon sync push tv_addons fallback failed", tvTableError);
        return false;
      }
    } catch (error) {
      console.warn("Library sync push failed", error);
      return false;
    }
  }
};
