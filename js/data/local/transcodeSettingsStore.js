import { createProfileScopedStore } from "./profileScopedStore.js";

// The shared secret a deployment's transcode endpoint asks for, kept per profile.
//
// Per profile because that is where the person who owns the device enters it, and
// because a second profile on a shared television should not inherit the right to
// spend someone else's CPU.
//
// Deliberately *not* part of the cloud-synced settings blob: this unlocks a server
// that one person runs, not an account. Copying it to the cloud would put a
// deployment's secret somewhere that outlives the deployment and is readable from
// any other device that signs in. Writes are therefore silent -- the store still
// scopes by profile, it just never queues a sync.

const KEY = "transcodeSettings";

export const DEFAULT_TRANSCODE_SETTINGS = Object.freeze({ token: "" });

export function normalizeTranscodeSettings(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    token: String(source.token ?? source.transcodeToken ?? source.transcode_token ?? "").trim()
  };
}

const store = createProfileScopedStore({
  key: KEY,
  normalize: normalizeTranscodeSettings
});

export const TranscodeSettingsStore = {
  get() {
    return store.get();
  },

  getForProfile(profileId) {
    return store.getForProfile(profileId);
  },

  set(partial = {}) {
    return store.set(partial, { silentSync: true });
  },

  setForProfile(profileId, partial = {}) {
    return store.setForProfile(profileId, partial, { silentSync: true });
  },

  setToken(token) {
    return this.set({ token: normalizeTranscodeSettings({ token }).token });
  },

  clearToken() {
    return this.set({ token: "" });
  }
};

export { KEY as TRANSCODE_SETTINGS_KEY };
