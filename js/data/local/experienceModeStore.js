import { createProfileScopedStore } from "./profileScopedStore.js";

const VALID_MODES = new Set(["ESSENTIAL", "ADVANCED"]);

function normalizeQuickSetupVersion(value) {
  const version = Number(value);
  return Number.isFinite(version) && version > 0 ? Math.trunc(version) : 0;
}

function normalize(value = {}) {
  const mode = String(value?.mode || "")
    .trim()
    .toUpperCase();
  return {
    mode: VALID_MODES.has(mode) ? mode : null,
    addonSetupSkipped: Boolean(value?.addonSetupSkipped),
    quickSetupVersion: normalizeQuickSetupVersion(value?.quickSetupVersion)
  };
}

const store = createProfileScopedStore({
  key: "experienceMode",
  normalize
});

export const ExperienceModeStore = {
  getForProfile(profileId) {
    return store.getForProfile(profileId);
  },

  get() {
    return store.get();
  },

  setForProfile(profileId, partial, options = {}) {
    return store.setForProfile(profileId, partial, options);
  },

  set(partial, options = {}) {
    return store.set(partial, options);
  },

  isEssential(profileId = null) {
    const settings = profileId == null ? this.get() : this.getForProfile(profileId);
    return settings.mode === "ESSENTIAL";
  }
};
