import { createProfileScopedStore } from "./profileScopedStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";

const KEY = "homeCatalogPrefs";

const DEFAULTS = {
  order: [],
  disabled: [],
  customTitles: {}
};

function unique(array) {
  return Array.from(new Set(array || []));
}

function sameArray(left = [], right = []) {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((entry, index) => entry === right[index]);
}

function normalizeCustomTitles(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.entries(value).reduce((accumulator, [key, title]) => {
    const normalizedKey = String(key || "").trim();
    const normalizedTitle = String(title || "").trim();
    if (normalizedKey && normalizedTitle) {
      accumulator[normalizedKey] = normalizedTitle;
    }
    return accumulator;
  }, {});
}

function sameObject(left = {}, right = {}) {
  const leftKeys = Object.keys(left || {}).sort();
  const rightKeys = Object.keys(right || {}).sort();
  if (!sameArray(leftKeys, rightKeys)) {
    return false;
  }
  return leftKeys.every((key) => left[key] === right[key]);
}

function normalizeHomeCatalogPrefs(value = {}) {
  return {
    order: unique(Array.isArray(value.order) ? value.order : []),
    disabled: unique(Array.isArray(value.disabled) ? value.disabled : []),
    customTitles: normalizeCustomTitles(value.customTitles || value.custom_titles)
  };
}

const store = createProfileScopedStore({
  key: KEY,
  normalize: normalizeHomeCatalogPrefs
});
const changeListeners = new Set();

function notifyChange(profileId, reason) {
  const payload = {
    profileId: String(profileId || "1"),
    reason: String(reason || "update")
  };
  changeListeners.forEach((listener) => {
    try {
      listener(payload);
    } catch (error) {
      console.warn("Home catalog store change listener failed", error);
    }
  });
}

function queueHomeCatalogSettingsSync(profileId = null) {
  return import("../../core/profile/homeCatalogSettingsSyncService.js")
    .then(({ HomeCatalogSettingsSyncService }) =>
      HomeCatalogSettingsSyncService.triggerPush(profileId)
    )
    .catch((error) => {
      console.warn("Home catalog settings sync enqueue failed", error);
      return false;
    });
}

export const HomeCatalogStore = {
  subscribe(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    changeListeners.add(listener);
    return () => changeListeners.delete(listener);
  },

  getForProfile(profileId) {
    return store.getForProfile(profileId);
  },

  get() {
    return store.get();
  },

  setForProfile(profileId, partial, options = {}) {
    const current = this.getForProfile(profileId);
    const next = normalizeHomeCatalogPrefs({
      ...current,
      ...(partial || {})
    });
    if (
      sameArray(current.order, next.order) &&
      sameArray(current.disabled, next.disabled) &&
      sameObject(current.customTitles, next.customTitles)
    ) {
      return Promise.resolve(null);
    }
    const resolvedProfileId = String(profileId ?? ProfileManager.getActiveProfileId() ?? "1");
    store.replaceForProfile(profileId, next, options);
    if (!options.silentNotify) {
      notifyChange(resolvedProfileId, options.reason || "set");
    }
    if (!options.silentSync) {
      return queueHomeCatalogSettingsSync(profileId);
    }
    return Promise.resolve(null);
  },

  set(partial, { silentSync = false, silentNotify = false, profileId = null, reason } = {}) {
    return this.setForProfile(profileId, partial, { silentSync, silentNotify, reason });
  },

  isDisabled(key) {
    return this.get().disabled.includes(key);
  },

  toggleDisabled(key, options = {}) {
    const current = this.get();
    const disabled = current.disabled.includes(key)
      ? current.disabled.filter((item) => item !== key)
      : [...current.disabled, key];
    return this.set({ disabled }, options);
  },

  setOrder(order, options = {}) {
    return this.set({ order: unique(order || []) }, options);
  },

  setCustomTitles(customTitles, options = {}) {
    return this.set({ customTitles: normalizeCustomTitles(customTitles) }, options);
  },

  ensureOrderKeys(keys) {
    const current = this.get();
    const saved = unique(current.order || []).filter(Boolean);
    const savedSet = new Set(saved);
    const missing = unique(keys || []).filter((key) => key && !savedSet.has(key));
    const next = [...saved, ...missing];
    if (!sameArray(current.order, next)) {
      this.set({ order: next }, { silentSync: true, silentNotify: true });
    }
    return next;
  },

  reset(options = {}) {
    store.replaceForProfile(options.profileId || null, DEFAULTS, {
      silentSync: Boolean(options.silentSync)
    });
  }
};
