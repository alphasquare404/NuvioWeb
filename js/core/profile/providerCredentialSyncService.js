import { AuthManager } from "../auth/authManager.js";
import { LocalStore } from "../storage/localStore.js";
import { DebridProviders } from "../debrid/debridProviders.js";
import { DebridSettingsStore } from "../../data/local/debridSettingsStore.js";
import { MdbListSettingsStore } from "../../data/local/mdbListSettingsStore.js";
import { AnimeSkipSettingsStore } from "../../data/local/animeSkipSettingsStore.js";
import { TmdbSettingsStore } from "../../data/local/tmdbSettingsStore.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { ProfileManager } from "./profileManager.js";
import { getSyncClientId } from "../sync/syncClientIdentity.js";

const SEED_RPC = "sync_seed_provider_credentials";
const PUSH_RPC = "sync_push_provider_credentials";
const PULL_RPC = "sync_pull_provider_credentials";
const PENDING_KEY = "providerCredentialSyncPendingProfiles";
const PUSH_DEBOUNCE_MS = 500;
export const PROVIDER_CREDENTIAL_FOREGROUND_DELAY_MS = 2500;
export const PROVIDER_CREDENTIAL_FOREGROUND_MIN_INTERVAL_MS = 60000;
const API_KEY_FIELD = "api_key";
const CLIENT_ID_FIELD = "client_id";
const MDBLIST_PROVIDER = "mdblist";
const ANIMESKIP_PROVIDER = "animeskip";
const TMDB_PROVIDER = "tmdb";

const pushTimers = new Map();
let syncInFlight = Promise.resolve();

function resolveProfileId(profileId = null) {
  const value = Number(profileId ?? ProfileManager.getActiveProfileId() ?? 1);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 1;
}

function providerName(providerId) {
  return `debrid:${String(providerId || "")
    .trim()
    .toLowerCase()}`;
}

function readPendingProfiles() {
  const value = LocalStore.get(PENDING_KEY, {}) || {};
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function scopeKey(scope) {
  return `${String(scope?.ownerId || "").trim()}:${resolveProfileId(scope?.profileId)}`;
}

function markPending(scope) {
  const pending = readPendingProfiles();
  pending[scopeKey(scope)] = Date.now();
  LocalStore.set(PENDING_KEY, pending);
}

function clearPending(scope) {
  const pending = readPendingProfiles();
  delete pending[scopeKey(scope)];
  delete pending[String(resolveProfileId(scope?.profileId))];
  LocalStore.set(PENDING_KEY, pending);
}

function isPending(scope) {
  return Object.prototype.hasOwnProperty.call(readPendingProfiles(), scopeKey(scope));
}

export function buildProviderCredentialSnapshot(
  profileId,
  { debridSettings = {}, mdbListSettings = {}, animeSkipSettings = {}, tmdbSettings = {} } = {}
) {
  const resolvedProfileId = resolveProfileId(profileId);
  return {
    profileId: resolvedProfileId,
    values: [
      ...DebridProviders.all().map((provider) => ({
        provider: providerName(provider.id),
        field: API_KEY_FIELD,
        value: DebridProviders.apiKeyFor(debridSettings, provider.id)
      })),
      {
        provider: MDBLIST_PROVIDER,
        field: API_KEY_FIELD,
        value: String(mdbListSettings.apiKey || "").trim()
      },
      {
        provider: ANIMESKIP_PROVIDER,
        field: CLIENT_ID_FIELD,
        value: String(animeSkipSettings.clientId || "").trim()
      },
      {
        provider: TMDB_PROVIDER,
        field: API_KEY_FIELD,
        value: String(tmdbSettings.apiKey || "").trim()
      }
    ]
  };
}

function snapshotFromLocal(profileId) {
  const resolvedProfileId = resolveProfileId(profileId);
  return buildProviderCredentialSnapshot(resolvedProfileId, {
    debridSettings: DebridSettingsStore.getForProfile(resolvedProfileId),
    mdbListSettings: MdbListSettingsStore.getForProfile(resolvedProfileId),
    animeSkipSettings: AnimeSkipSettingsStore.getForProfile(resolvedProfileId),
    tmdbSettings: TmdbSettingsStore.getForProfile(resolvedProfileId)
  });
}

function credentialJson(entry) {
  return { [entry.field]: String(entry.value || "").trim() };
}

export function providerCredentialParams(snapshot, originClientId = getSyncClientId()) {
  return {
    p_profile_id: snapshot.profileId,
    p_origin_client_id: originClientId,
    p_credentials: snapshot.values.map((entry) => ({
      provider: entry.provider,
      credential_json: credentialJson(entry)
    }))
  };
}

function parseCredentialJson(value) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" ? value : null;
}

export function mergeProviderCredentialRows(snapshot, rows = []) {
  const remoteByProvider = new Map(
    (Array.isArray(rows) ? rows : []).map((row) => [
      String(row?.provider || "")
        .trim()
        .toLowerCase(),
      row
    ])
  );
  return {
    ...snapshot,
    values: snapshot.values.map((local) => {
      const remote = remoteByProvider.get(local.provider);
      if (!remote) return local;
      const payload = parseCredentialJson(remote.credential_json ?? remote.credentialJson);
      if (!payload || typeof payload[local.field] !== "string") {
        throw new Error(`Invalid credential payload for ${local.provider}`);
      }
      return { ...local, value: payload[local.field].trim() };
    })
  };
}

function snapshotsEqual(left, right) {
  return JSON.stringify(left?.values || []) === JSON.stringify(right?.values || []);
}

async function withSyncLock(task) {
  const previous = syncInFlight;
  let release;
  syncInFlight = new Promise((resolve) => {
    release = resolve;
  });
  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    release();
  }
}

async function currentScope(profileId) {
  if (!AuthManager.isAuthenticated) return null;
  const resolvedProfileId = resolveProfileId(profileId);
  if (String(ProfileManager.getActiveProfileId()) !== String(resolvedProfileId)) return null;
  const ownerId = String(await AuthManager.getEffectiveUserId());
  return { ownerId, profileId: resolvedProfileId };
}

async function requireCurrentScope(expected) {
  const current = await currentScope(expected.profileId);
  if (!current || current.ownerId !== expected.ownerId) {
    throw new Error("Provider credential sync target changed");
  }
}

async function pushSnapshot(snapshot) {
  await SupabaseApi.rpc(PUSH_RPC, providerCredentialParams(snapshot), true);
}

async function seedSnapshot(snapshot) {
  await SupabaseApi.rpc(SEED_RPC, providerCredentialParams(snapshot), true);
}

async function pullRows(profileId) {
  const rows = await SupabaseApi.rpc(PULL_RPC, { p_profile_id: resolveProfileId(profileId) }, true);
  return Array.isArray(rows) ? rows : [];
}

function applySnapshot(snapshot) {
  snapshot.values.forEach((entry) => {
    if (entry.provider.startsWith("debrid:")) {
      const providerId = entry.provider.slice("debrid:".length);
      if (!providerId) return;
      DebridSettingsStore.setProviderApiKeyForProfile(snapshot.profileId, providerId, entry.value, {
        silentSync: true,
        silentCredentialSync: true
      });
    } else if (entry.provider === MDBLIST_PROVIDER) {
      MdbListSettingsStore.setForProfile(
        snapshot.profileId,
        { apiKey: entry.value },
        { silentSync: true, silentCredentialSync: true }
      );
    } else if (entry.provider === ANIMESKIP_PROVIDER) {
      AnimeSkipSettingsStore.setForProfile(
        snapshot.profileId,
        { clientId: entry.value },
        { silentSync: true, silentCredentialSync: true }
      );
    } else if (entry.provider === TMDB_PROVIDER) {
      TmdbSettingsStore.setApiKeyForProfile(snapshot.profileId, entry.value, {
        silentSync: true,
        silentCredentialSync: true
      });
    }
  });
}

export const ProviderCredentialSyncService = {
  foregroundPullTimer: null,
  foregroundPullInFlight: false,
  lastForegroundPullAtMs: 0,

  queuePush(profileId = null) {
    if (!AuthManager.isAuthenticated) return;
    const resolvedProfileId = resolveProfileId(profileId);
    void currentScope(resolvedProfileId)
      .then((scope) => {
        if (!scope) return;
        const key = scopeKey(scope);
        markPending(scope);
        const existing = pushTimers.get(key);
        if (existing) clearTimeout(existing);
        pushTimers.set(
          key,
          setTimeout(() => {
            pushTimers.delete(key);
            void this.pushCurrentToRemote(resolvedProfileId);
          }, PUSH_DEBOUNCE_MS)
        );
      })
      .catch((error) => console.warn("Provider credential sync scope lookup failed", error));
  },

  async pushCurrentToRemote(profileId = null) {
    return withSyncLock(async () => {
      try {
        const scope = await currentScope(profileId);
        if (!scope) return false;
        const snapshot = snapshotFromLocal(scope.profileId);
        await pushSnapshot(snapshot);
        await requireCurrentScope(scope);
        clearPending(scope);
        return true;
      } catch (error) {
        console.warn("Provider credential sync push failed", error);
        return false;
      }
    });
  },

  async syncFromRemote(profileId = null) {
    return withSyncLock(async () => {
      try {
        const scope = await currentScope(profileId);
        if (!scope) return false;
        const localSnapshot = snapshotFromLocal(scope.profileId);
        if (isPending(scope)) {
          await pushSnapshot(localSnapshot);
          clearPending(scope);
        }
        await seedSnapshot(localSnapshot);
        const rows = await pullRows(scope.profileId);
        await requireCurrentScope(scope);
        const remoteSnapshot = mergeProviderCredentialRows(localSnapshot, rows);
        const applied = !snapshotsEqual(localSnapshot, remoteSnapshot);
        if (applied) applySnapshot(remoteSnapshot);
        await requireCurrentScope(scope);
        this.lastForegroundPullAtMs = Date.now();
        return applied;
      } catch (error) {
        console.warn("Provider credential sync failed; keeping local credentials", error);
        return false;
      }
    });
  },

  requestForegroundPull(force = false) {
    if (!AuthManager.isAuthenticated) return false;
    const now = Date.now();
    if (!force && (this.foregroundPullTimer || this.foregroundPullInFlight)) return false;
    if (
      !force &&
      now - Number(this.lastForegroundPullAtMs || 0) <
        PROVIDER_CREDENTIAL_FOREGROUND_MIN_INTERVAL_MS
    ) {
      return false;
    }
    if (this.foregroundPullTimer) clearTimeout(this.foregroundPullTimer);
    const delayMs = force ? 0 : PROVIDER_CREDENTIAL_FOREGROUND_DELAY_MS;
    this.foregroundPullTimer = setTimeout(() => {
      this.foregroundPullTimer = null;
      if (!AuthManager.isAuthenticated) return;
      this.foregroundPullInFlight = true;
      void this.syncFromRemote(ProfileManager.getActiveProfileId()).finally(() => {
        this.foregroundPullInFlight = false;
      });
    }, delayMs);
    return true;
  },

  cancelForegroundPull() {
    if (this.foregroundPullTimer) {
      clearTimeout(this.foregroundPullTimer);
      this.foregroundPullTimer = null;
    }
  }
};
