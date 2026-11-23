import { AuthManager } from "../auth/authManager.js";
import { captureAccountScope, isAccountScopeCurrent } from "../auth/accountScope.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { SimklAuthStore } from "../../data/local/simklAuthStore.js";
import { ProfileManager } from "./profileManager.js";
import { getSyncClientId } from "../sync/syncClientIdentity.js";

const PROVIDER = "simkl";
const PULL_RPC = "sync_pull_provider_credentials";
const PUSH_RPC = "sync_push_provider_credentials";
const DELETE_RPC = "sync_delete_provider_credentials";
let syncInFlight = Promise.resolve();

function resolveProfileId(profileId = null) {
  const value = Number(profileId ?? ProfileManager.getActiveProfileId() ?? 1);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 1;
}

function parseCredential(value) {
  let credential = value;
  if (typeof credential === "string") {
    try {
      credential = JSON.parse(credential);
    } catch (_) {
      return null;
    }
  }
  if (!credential || typeof credential !== "object") return null;
  const accessToken = String(credential.access_token || credential.accessToken || "").trim();
  if (!accessToken) return null;
  return {
    accessToken,
    username: String(credential.username || "") || null,
    accountId:
      credential.account_id == null && credential.accountId == null
        ? null
        : Number(credential.account_id ?? credential.accountId)
  };
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

export const SimklCredentialSyncService = {
  async pushCurrentToRemote(profileId = null) {
    return withSyncLock(async () => {
      try {
        if (!AuthManager.isAuthenticated) return false;
        const resolvedProfileId = resolveProfileId(profileId);
        const state = SimklAuthStore.get(resolvedProfileId);
        if (!state.accessToken) return false;
        const credential = { access_token: state.accessToken };
        if (state.username) credential.username = state.username;
        if (state.accountId != null) credential.account_id = state.accountId;
        await SupabaseApi.rpc(
          PUSH_RPC,
          {
            p_profile_id: resolvedProfileId,
            p_origin_client_id: getSyncClientId(),
            p_credentials: [{ provider: PROVIDER, credential_json: credential }]
          },
          true
        );
        return true;
      } catch (error) {
        console.warn("Simkl credential sync push failed", error);
        return false;
      }
    });
  },

  async pullFromRemote(profileId = null) {
    return withSyncLock(async () => {
      try {
        if (!AuthManager.isAuthenticated) return false;
        const resolvedProfileId = resolveProfileId(profileId);
        const scope = captureAccountScope(resolvedProfileId);
        const credentials = await SupabaseApi.rpc(
          PULL_RPC,
          { p_profile_id: resolvedProfileId },
          true
        );
        if (!isAccountScopeCurrent(scope)) {
          return false;
        }
        const row = (Array.isArray(credentials) ? credentials : []).find(
          (entry) => String(entry?.provider || "").toLowerCase() === PROVIDER
        );
        const remote = parseCredential(row?.credential_json || row?.credentialJson || null);
        if (!remote) return false;
        const local = SimklAuthStore.get(resolvedProfileId);
        if (
          local.accessToken === remote.accessToken &&
          local.username === remote.username &&
          local.accountId === remote.accountId
        ) {
          return false;
        }
        SimklAuthStore.saveToken(remote.accessToken, resolvedProfileId);
        SimklAuthStore.saveIdentity(remote, resolvedProfileId);
        return true;
      } catch (error) {
        console.warn("Simkl credential sync pull failed", error);
        return false;
      }
    });
  },

  async deleteRemote(profileId = null) {
    return withSyncLock(async () => {
      try {
        if (!AuthManager.isAuthenticated) return false;
        await SupabaseApi.rpc(
          DELETE_RPC,
          {
            p_profile_id: resolveProfileId(profileId),
            p_origin_client_id: getSyncClientId(),
            p_provider: PROVIDER
          },
          true
        );
        return true;
      } catch (error) {
        console.warn("Simkl credential sync delete failed", error);
        return false;
      }
    });
  }
};
