import { AuthManager } from "../auth/authManager.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { CollectionsStore } from "../../data/local/collectionsStore.js";
import { ProfileManager } from "./profileManager.js";
import { SyncHydrationState, SyncPullResult } from "./syncHydrationState.js";

const PULL_RPC = "sync_pull_collections";
const PUSH_RPC = "sync_push_collections";
const PUSH_DEBOUNCE_MS = 500;

function resolveProfileId(profileId = null) {
  const raw = Number(profileId ?? ProfileManager.getActiveProfileId() ?? 1);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.trunc(raw);
  }
  return 1;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseRemoteCollectionsPayload(blob = null) {
  const raw = blob?.collections_json ?? blob?.collectionsJson ?? blob ?? [];
  if (typeof raw === "string") {
    return CollectionsStore.importFromJson(raw);
  }
  try {
    return CollectionsStore.importFromJson(JSON.stringify(raw));
  } catch (_) {
    return [];
  }
}

export const CollectionSyncService = {
  syncingFromRemoteProfiles: new Set(),
  pushTimers: new Map(),
  pendingLocalChanges: new Map(),

  isSyncingFromRemote(profileId = null) {
    return this.syncingFromRemoteProfiles.has(resolveProfileId(profileId));
  },

  recordLocalMutation(profileId = null, before = [], after = []) {
    const resolvedProfileId = resolveProfileId(profileId);
    const existing = this.pendingLocalChanges.get(resolvedProfileId);
    this.pendingLocalChanges.set(resolvedProfileId, { before: existing?.before || before, after });
  },

  hasPendingLocalMutation(profileId = null) {
    return this.pendingLocalChanges.has(resolveProfileId(profileId));
  },

  async push(profileId = null, { automatic = false, context = null } = {}) {
    if (!AuthManager.isAuthenticated) {
      return false;
    }
    const resolvedProfileId = resolveProfileId(profileId);
    try {
      const syncContext = context || (await SyncHydrationState.capture(resolvedProfileId));
      if (automatic && !(await SyncHydrationState.allowsAutomaticPush(syncContext, "collections"))) {
        console.info("[Sync] collections automatic push blocked", {
          hydration: SyncHydrationState.get(syncContext, "collections")
        });
        return false;
      }
      const collectionsJson = CollectionsStore.exportCurrentProfileJson(resolvedProfileId);
      const parsedJson = CollectionsStore.importFromJson(collectionsJson);
      await SupabaseApi.rpc(
        PUSH_RPC,
        {
          p_profile_id: resolvedProfileId,
          p_collections_json: parsedJson
        },
        true
      );
      this.pendingLocalChanges.delete(resolvedProfileId);
      return true;
    } catch (error) {
      console.warn("Collection sync push failed", error);
      return false;
    }
  },

  async pull(profileId = null, { context = null } = {}) {
    if (!AuthManager.isAuthenticated) {
      return false;
    }
    const resolvedProfileId = resolveProfileId(profileId);
    const syncContext = context || (await SyncHydrationState.capture(resolvedProfileId));
    try {
      if (!(await SyncHydrationState.beginPull(syncContext, "collections"))) {
        return { result: SyncPullResult.FAILED, items: CollectionsStore.getForProfile(resolvedProfileId) };
      }
      const rows = await SupabaseApi.rpc(
        PULL_RPC,
        {
          p_profile_id: resolvedProfileId
        },
        true
      );
      if (!(await SyncHydrationState.isCurrent(syncContext))) {
        return { result: SyncPullResult.FAILED, items: CollectionsStore.getForProfile(resolvedProfileId) };
      }
      const blob = Array.isArray(rows) ? rows[0] || null : rows || null;
      if (!blob) {
        await SyncHydrationState.completePull(syncContext, "collections", SyncPullResult.FAILED);
        return { result: SyncPullResult.FAILED, items: CollectionsStore.getForProfile(resolvedProfileId) };
      }

      const remoteCollections = parseRemoteCollectionsPayload(blob);
      const localCollections = CollectionsStore.getForProfile(resolvedProfileId);
      const pending = this.pendingLocalChanges.get(resolvedProfileId);
      let resolvedCollections = remoteCollections;
      if (pending) {
        const beforeById = new Map((pending.before || []).map((item) => [item.id, item]));
        const afterById = new Map((pending.after || []).map((item) => [item.id, item]));
        resolvedCollections = remoteCollections
          .filter((item) => !beforeById.has(item.id) || afterById.has(item.id))
          .map((item) => afterById.get(item.id) || item);
        afterById.forEach((item, id) => {
          if (!resolvedCollections.some((entry) => entry.id === id)) resolvedCollections.push(item);
        });
      }

      if (stableStringify(resolvedCollections) !== stableStringify(localCollections)) {
        this.syncingFromRemoteProfiles.add(resolvedProfileId);
        try {
          CollectionsStore.replaceForProfile(resolvedProfileId, resolvedCollections, { silentSync: true });
        } finally {
          this.syncingFromRemoteProfiles.delete(resolvedProfileId);
        }
      }

      const result = remoteCollections.length ? SyncPullResult.SUCCESS_WITH_DATA : SyncPullResult.SUCCESS_EMPTY;
      await SyncHydrationState.completePull(syncContext, "collections", result);
      return { result, items: resolvedCollections };
    } catch (error) {
      console.warn("Collection sync pull failed", error);
      await SyncHydrationState.completePull(syncContext, "collections", SyncPullResult.FAILED);
      return { result: SyncPullResult.FAILED, items: CollectionsStore.getForProfile(resolvedProfileId) };
    }
  },

  triggerPush(profileId = null, mutation = null) {
    if (!AuthManager.isAuthenticated) {
      return;
    }
    const resolvedProfileId = resolveProfileId(profileId);
    if (mutation) this.recordLocalMutation(resolvedProfileId, mutation.before, mutation.after);
    if (this.isSyncingFromRemote(resolvedProfileId)) {
      return;
    }
    const existingTimer = this.pushTimers.get(resolvedProfileId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    const timerId = setTimeout(() => {
      this.pushTimers.delete(resolvedProfileId);
      void this.push(resolvedProfileId, { automatic: true });
    }, PUSH_DEBOUNCE_MS);
    this.pushTimers.set(resolvedProfileId, timerId);
  }
};
