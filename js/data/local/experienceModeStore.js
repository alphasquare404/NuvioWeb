import { createProfileScopedStore } from "./profileScopedStore.js";

const VALID_MODES = new Set(["ESSENTIAL", "ADVANCED"]);

// The Quick Setup a profile has already been through. A number rather than a
// flag, so that a later step worth showing to people who have already been
// through it once is a matter of raising this by one -- which is what the issue
// means by "selected upgrades". A profile that has never seen it reads 0.
export const QUICK_SETUP_VERSION = 1;

function normalizeQuickSetupVersion(value) {
  const version = Number(value);
  return Number.isFinite(version) && version > 0 ? Math.trunc(version) : 0;
}

function normalize(value = {}) {
  const mode = String(value?.mode || "").trim().toUpperCase();
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
  },

  needsQuickSetup(profileId = null) {
    const settings = profileId == null ? this.get() : this.getForProfile(profileId);
    return settings.quickSetupVersion < QUICK_SETUP_VERSION;
  },

  // Finishing and skipping record the same thing. A skip that recorded nothing
  // would bring the flow back on the next launch, which is the one behaviour
  // the issue rules out.
  markQuickSetupSeen(profileId = null, options = {}) {
    return this.setForProfile(
      profileId,
      { quickSetupVersion: QUICK_SETUP_VERSION },
      { syncSource: "onboarding", ...options }
    );
  }
};
