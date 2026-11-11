import { AuthManager } from "../auth/authManager.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { PluginRuntime } from "../player/pluginRuntime.js";
import { PluginStore } from "../../data/local/pluginStore.js";
import {
  canonicalizePluginUrl,
  normalizePluginRepositoryType,
  PLUGIN_REPOSITORY_TYPES,
  repositoryIdForUrl
} from "../player/pluginModels.js";
import { ProfileManager } from "./profileManager.js";
import { SyncHydrationState, SyncPullResult } from "./syncHydrationState.js";

const TABLE = "plugins";
const PUSH_RPC = "sync_push_plugins";
const OVERVIEW_RPC = "get_sync_overview";
const operationsByProfile = new Map();

function runProfileExclusive(profileId, operation) {
  const current = (operationsByProfile.get(profileId) || Promise.resolve()).then(operation);
  operationsByProfile.set(profileId, current);
  return current.finally(() => {
    if (operationsByProfile.get(profileId) === current) operationsByProfile.delete(profileId);
  });
}
const { NUVIO_JS, EXTERNAL_DEX, LEGACY } = PLUGIN_REPOSITORY_TYPES;

function resolveProfileId() {
  const raw = Number(ProfileManager.getActiveProfileId() || 1);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.trunc(raw);
  }
  return 1;
}

async function resolvePluginProfileId() {
  const profileId = resolveProfileId();
  if (profileId === 1) {
    return 1;
  }
  const profiles = await ProfileManager.getProfiles();
  const activeProfile = profiles.find((profile) => {
    const id = Number(profile?.profileIndex || profile?.id || 1);
    return Number.isFinite(id) && Math.trunc(id) === profileId;
  });
  const usesPrimaryPlugins =
    typeof activeProfile?.usesPrimaryPlugins === "boolean"
      ? activeProfile.usesPrimaryPlugins
      : typeof activeProfile?.uses_primary_plugins === "boolean"
        ? activeProfile.uses_primary_plugins
        : false;
  return usesPrimaryPlugins ? 1 : profileId;
}

function shouldTryLegacyTable(error) {
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

function sourceIdFromUrl(url, index) {
  const compact = String(url || "")
    .replace(/[^a-z0-9]/gi, "")
    .slice(-18)
    .toLowerCase();
  return `plugin_${index + 1}_${compact || "source"}`;
}

function mapRemoteRowsToSources(rows = []) {
  return (rows || [])
    .map((row, index) => {
      const url = row.url || row.url_template || row.urlTemplate || "";
      if (!url) {
        return null;
      }
      const declaredType = row.repo_type ?? row.repoType ?? row.type;
      const inferredType = /\.cs3(?:$|[?#])/i.test(url)
        ? EXTERNAL_DEX
        : /\/manifest\.json(?:$|[?#])/i.test(url)
          ? NUVIO_JS
          : LEGACY;
      return {
        id: sourceIdFromUrl(url, index),
        repoType: String(declaredType ?? "").trim()
          ? normalizePluginRepositoryType(declaredType)
          : inferredType,
        name: row.name || `Plugin ${index + 1}`,
        urlTemplate: url,
        enabled: row.enabled !== false
      };
    })
    .filter(Boolean);
}

function sourceKey(source = {}) {
  return String(source.urlTemplate || "").trim();
}

function isRepository(source) {
  return Boolean(source?.repoType && source.repoType !== LEGACY);
}

function repositoryUrl(source) {
  return isRepository(source) ? canonicalizePluginUrl(source.urlTemplate) : "";
}

function mutationKey(source) {
  return repositoryUrl(source) || sourceKey(source);
}

function syncFields(source) {
  if (!source) return null;
  return {
    id: source.id,
    urlTemplate: source.urlTemplate,
    name: source.name,
    enabled: source.enabled !== false,
    repoType: source.repoType || LEGACY
  };
}

function reconcileSources(localSources, remoteSources, syncedUrls, changes) {
  const localByKey = new Map(localSources.map((source) => [mutationKey(source), source]));
  const merged = new Map();
  for (const source of remoteSources) {
    const key = mutationKey(source);
    const local = localByKey.get(key);
    merged.set(key, { ...local, ...source, id: local?.id || source.id });
  }
  for (const [key, source] of localByKey) {
    if (!merged.has(key) && !syncedUrls.has(repositoryUrl(source))) merged.set(key, source);
  }
  for (const { key, source } of changes) {
    if (source) merged.set(key, { ...merged.get(key), ...localByKey.get(key), ...source });
    else merged.delete(key);
  }
  return [...merged.values()];
}

async function verifyEmptyRemoteSnapshot(profileId) {
  try {
    const response = await SupabaseApi.rpc(OVERVIEW_RPC, {}, true);
    const overview = Array.isArray(response) && response.length === 1 ? response[0] : response;
    const profile = overview?.profiles?.[String(profileId)];
    const counts = overview?.plugins;
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) return false;
    const count = counts?.[String(profileId)];
    return count === undefined || count === 0 || count === "0";
  } catch {
    return false;
  }
}

function readLocalSources(profileId) {
  const state = PluginStore.get(profileId);
  return [
    ...PluginRuntime.listSources(profileId),
    ...state.repositories.map((entry) => ({
      ...entry,
      urlTemplate: entry.url,
      repoType: entry.type
    }))
  ];
}

function writeLocalSources(sources, profileId, syncedRepositoryUrls) {
  PluginRuntime.saveSources(
    sources.filter((entry) => !entry.repoType || entry.repoType === LEGACY),
    profileId
  );
  const state = PluginStore.get(profileId);
  const repositories = sources
    .filter((entry) => entry.repoType && entry.repoType !== LEGACY)
    .map((entry) => {
      const url = canonicalizePluginUrl(entry.urlTemplate);
      const existing = state.repositories.find((repository) => repository.url === url);
      return {
        ...existing,
        url,
        name: entry.name,
        enabled: entry.enabled,
        type:
          entry.repoType === PLUGIN_REPOSITORY_TYPES.UNKNOWN && existing
            ? existing.type
            : entry.repoType,
        id: existing?.id || repositoryIdForUrl(url)
      };
    });
  const ids = new Set(repositories.map((repository) => repository.id));
  PluginStore.replace(
    {
      ...state,
      syncedRepositoryUrls,
      repositories,
      scrapers: state.scrapers.filter((scraper) => ids.has(scraper.repositoryId))
    },
    profileId
  );
}

async function reconcileCloudSources(profileId, syncContext, localSources) {
  const ownerId = await AuthManager.getEffectiveUserId();
  const rows = await SupabaseApi.select(
    TABLE,
    `user_id=eq.${encodeURIComponent(ownerId)}&profile_id=eq.${profileId}&select=*&order=sort_order.asc`,
    true
  );
  if (!(await SyncHydrationState.isCurrent(syncContext))) {
    return { result: SyncPullResult.FAILED, items: localSources };
  }
  if (!Array.isArray(rows)) throw new Error("Invalid cloud plugin snapshot");
  const remoteSources = mapRemoteRowsToSources(rows);
  const knownUrls = new Set(PluginStore.get(profileId).syncedRepositoryUrls || []);
  const remoteUrls = new Set(remoteSources.map(repositoryUrl).filter(Boolean));
  const missingKnownRepo = [...knownUrls].some((url) => !remoteUrls.has(url));
  const snapshotValid = rows.length === remoteSources.length;
  const verifiedEmpty =
    rows.length === 0 && missingKnownRepo ? await verifyEmptyRemoteSnapshot(profileId) : false;
  if (!(await SyncHydrationState.isCurrent(syncContext))) {
    return { result: SyncPullResult.FAILED, items: localSources };
  }
  if (!snapshotValid || (rows.length === 0 && missingKnownRepo && !verifiedEmpty)) {
    await SyncHydrationState.completePull(syncContext, "plugins", SyncPullResult.FAILED);
    return { result: SyncPullResult.FAILED, items: readLocalSources(profileId) };
  }
  const state = PluginStore.get(profileId);
  const mergedSources = reconcileSources(
    readLocalSources(profileId),
    remoteSources,
    knownUrls,
    state.pendingPluginChanges || []
  );
  writeLocalSources(mergedSources, profileId, [...remoteUrls]);
  const result = remoteSources.length
    ? SyncPullResult.SUCCESS_WITH_DATA
    : SyncPullResult.SUCCESS_EMPTY;
  await SyncHydrationState.completePull(syncContext, "plugins", result);
  return { result, items: mergedSources };
}

export const PluginSyncService = {
  snapshot() {
    return readLocalSources();
  },
  recordLocalMutation(profileId = null, before = [], after = []) {
    const target = profileId ?? resolveProfileId();
    const state = PluginStore.get(target);
    const previous = new Map(before.map((source) => [mutationKey(source), syncFields(source)]));
    const next = new Map(after.map((source) => [mutationKey(source), syncFields(source)]));
    const pending = new Map(
      (state.pendingPluginChanges || []).map((change) => [change.key, change])
    );
    for (const key of new Set([...previous.keys(), ...next.keys()])) {
      if (!key || JSON.stringify(previous.get(key)) === JSON.stringify(next.get(key))) continue;
      pending.set(key, { key, source: next.get(key) || null });
    }
    PluginStore.replace({ ...state, pendingPluginChanges: [...pending.values()] }, target);
  },

  hasPendingLocalMutation(profileId = null) {
    return Boolean(PluginStore.get(profileId ?? resolveProfileId()).pendingPluginChanges?.length);
  },

  async pull({ context = null } = {}) {
    try {
      if (!AuthManager.isAuthenticated) {
        return { result: SyncPullResult.FAILED, items: [] };
      }
      const profileId = await resolvePluginProfileId();
      const syncContext = context || (await SyncHydrationState.capture(profileId));
      return await runProfileExclusive(profileId, async () => {
        const localSources = readLocalSources(profileId);
        if (!(await SyncHydrationState.beginPull(syncContext, "plugins"))) {
          return { result: SyncPullResult.FAILED, items: localSources };
        }
        return reconcileCloudSources(profileId, syncContext, localSources);
      });
    } catch (error) {
      console.warn("Plugin sync pull failed", error);
      return { result: SyncPullResult.FAILED, items: [] };
    }
  },

  async push({ automatic = false, context = null } = {}) {
    try {
      if (!AuthManager.isAuthenticated) {
        return false;
      }
      const profileId = await resolvePluginProfileId();
      if (!PluginStore.canEdit()) return false;
      const syncContext = context || (await SyncHydrationState.capture(profileId));
      return await runProfileExclusive(profileId, async () => {
        if (!(await SyncHydrationState.isCurrent(syncContext))) return false;
        if (automatic && !(await SyncHydrationState.allowsAutomaticPush(syncContext, "plugins"))) {
          console.info("[Sync] plugins automatic push blocked", {
            hydration: SyncHydrationState.get(syncContext, "plugins")
          });
          return false;
        }
        const initialState = PluginStore.get(profileId);
        const localSources = readLocalSources(profileId);
        const usesRepositorySync =
          initialState.syncedRepositoryUrls?.length || localSources.some(isRepository);
        if (usesRepositorySync) {
          // A write replaces the cloud list. Refresh first so an unrelated local
          // change cannot restore a repository already deleted on another device.
          const snapshot = await reconcileCloudSources(profileId, syncContext, localSources);
          if (snapshot.result === SyncPullResult.FAILED) return false;
        }
        if (!(await SyncHydrationState.isCurrent(syncContext))) return false;
        const sources = readLocalSources(profileId);
        const pushedChanges = PluginStore.get(profileId).pendingPluginChanges || [];
        const acknowledge = async () => {
          if (!(await SyncHydrationState.isCurrent(syncContext))) return false;
          const state = PluginStore.get(profileId);
          const acknowledged = new Map(
            pushedChanges.map((change) => [change.key, JSON.stringify(change)])
          );
          PluginStore.replace(
            {
              ...state,
              syncedRepositoryUrls: sources.map(repositoryUrl).filter(Boolean),
              pendingPluginChanges: (state.pendingPluginChanges || []).filter(
                (change) => acknowledged.get(change.key) !== JSON.stringify(change)
              )
            },
            profileId
          );
          return true;
        };
        const hasRepositories = sources.some(
          (source) => source.repoType && source.repoType !== LEGACY
        );
        if (sources.some((source) => source.repoType === PLUGIN_REPOSITORY_TYPES.UNKNOWN))
          return false;
        try {
          await SupabaseApi.rpc(
            PUSH_RPC,
            {
              p_profile_id: profileId,
              p_plugins: sources.map((source, index) => ({
                url: source.urlTemplate,
                name: source.name || `Plugin ${index + 1}`,
                enabled: source.enabled !== false,
                sort_order: index,
                ...([NUVIO_JS, EXTERNAL_DEX].includes(source.repoType)
                  ? { repo_type: source.repoType }
                  : {})
              }))
            },
            true
          );
          return await acknowledge();
        } catch (rpcError) {
          if (
            hasRepositories ||
            initialState.syncedRepositoryUrls?.length ||
            !shouldTryLegacyTable(rpcError)
          ) {
            throw rpcError;
          }
        }

        const ownerId = await AuthManager.getEffectiveUserId();
        const rows = sources.map((source, index) => ({
          user_id: ownerId,
          profile_id: profileId,
          url: source.urlTemplate,
          name: source.name || `Plugin ${index + 1}`,
          enabled: source.enabled !== false,
          sort_order: index
        }));
        await SupabaseApi.delete(
          TABLE,
          `user_id=eq.${encodeURIComponent(ownerId)}&profile_id=eq.${profileId}`,
          true
        );
        if (rows.length) {
          try {
            await SupabaseApi.upsert(TABLE, rows, "user_id,profile_id,url", true);
          } catch {
            await SupabaseApi.upsert(TABLE, rows, null, true);
          }
        }
        return await acknowledge();
      });
    } catch (error) {
      console.warn("Plugin sync push failed", error);
      return false;
    }
  }
};
