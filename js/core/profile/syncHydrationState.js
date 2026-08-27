import { AuthManager } from "../auth/authManager.js";
import { ProfileManager } from "./profileManager.js";

export const SyncPullResult = Object.freeze({
  SUCCESS_WITH_DATA: "SUCCESS_WITH_DATA",
  SUCCESS_EMPTY: "SUCCESS_EMPTY",
  FAILED: "FAILED"
});

const states = new Map();
const pendingSettingsMutations = new Map();
let generation = 0;

function normalizeProfileId(profileId = null) {
  const value = String(profileId ?? ProfileManager.getActiveProfileId() ?? "1").trim();
  return value || "1";
}

function stateFor(context, domain) {
  return states.get(`${context.userId}:${context.profileId}:${domain}`) || "unknown";
}

function pendingSettingsKey(profileId) {
  return `${generation}:${normalizeProfileId(profileId)}`;
}

export const SyncHydrationState = {
  invalidate() {
    generation += 1;
    // A new auth/profile generation must never inherit authorization from an
    // earlier hydration, even when it resolves to the same user/profile key.
    states.clear();
    pendingSettingsMutations.clear();
    return generation;
  },

  async capture(profileId = null) {
    if (!AuthManager.isAuthenticated) return null;
    const userId = String(await AuthManager.getEffectiveUserId()).trim();
    if (!userId) return null;
    return {
      userId,
      profileId: normalizeProfileId(profileId),
      activeProfileId: normalizeProfileId(),
      generation
    };
  },

  async isCurrent(context) {
    if (!context || !AuthManager.isAuthenticated || context.generation !== generation) return false;
    if (normalizeProfileId() !== String(context.activeProfileId)) return false;
    try {
      return String(await AuthManager.getEffectiveUserId()) === String(context.userId);
    } catch (_) {
      return false;
    }
  },

  get(context, domain) {
    return stateFor(context, domain);
  },

  set(context, domain, state) {
    if (!context || !domain) return;
    states.set(`${context.userId}:${context.profileId}:${domain}`, state);
  },

  async beginPull(context, domain) {
    if (!(await this.isCurrent(context))) return false;
    this.set(context, domain, "pulling");
    return true;
  },

  async completePull(context, domain, result) {
    if (!(await this.isCurrent(context))) return false;
    this.set(
      context,
      domain,
      result === SyncPullResult.SUCCESS_EMPTY
        ? "remote-empty"
        : result === SyncPullResult.SUCCESS_WITH_DATA
          ? "hydrated"
          : "failed"
    );
    return true;
  },

  async allowsAutomaticPush(context, domain) {
    if (!(await this.isCurrent(context))) return false;
    return ["hydrated", "remote-empty"].includes(this.get(context, domain));
  },

  // Settings are stored in one remote blob, but most UI writes target a
  // single profile-scoped store. Keep those small local intentions separate
  // from bootstrap defaults so a pull can restore remote state first.
  recordPendingSettingsMutation(profileId, mutation) {
    if (!mutation || ["bootstrap", "default", "remote-pull"].includes(mutation.source)) {
      return;
    }
    const key = pendingSettingsKey(profileId);
    const entries = pendingSettingsMutations.get(key) || [];
    entries.push({ ...mutation });
    pendingSettingsMutations.set(key, entries);
  },

  getPendingSettingsMutations(context) {
    if (!context) return [];
    return [...(pendingSettingsMutations.get(pendingSettingsKey(context.profileId)) || [])];
  },

  clearPendingSettingsMutations(context) {
    if (!context) return;
    pendingSettingsMutations.delete(pendingSettingsKey(context.profileId));
  }
};
