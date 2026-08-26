import { createProfileScopedStore } from "./profileScopedStore.js";

export const WatchProgressSource = {
  TRAKT: "trakt",
  SIMKL: "simkl",
  NUVIO_SYNC: "nuvio_sync"
};

export const TraktLibrarySourceMode = {
  TRAKT: "trakt",
  SIMKL: "simkl",
  LOCAL: "local"
};

export const SimklAnimeIdPreference = {
  IMDB: "imdb",
  MAL: "mal",
  KITSU: "kitsu"
};

export const MoreLikeThisSourcePreference = {
  TRAKT: "trakt",
  TMDB: "tmdb"
};

export const TRAKT_CONTINUE_WATCHING_DAYS_CAP_ALL = 0;
export const TRAKT_DEFAULT_CONTINUE_WATCHING_DAYS_CAP = 60;

const STORE_KEY = "traktSettings";
const librarySourceListeners = new Set();

function notifyLibrarySourceChange() {
  librarySourceListeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.warn("Library source listener failed", error);
    }
  });
}

function normalizeWatchProgressSource(value) {
  const normalized = String(value || WatchProgressSource.TRAKT).toLowerCase();
  if (normalized === WatchProgressSource.NUVIO_SYNC) return WatchProgressSource.NUVIO_SYNC;
  if (normalized === WatchProgressSource.SIMKL) return WatchProgressSource.SIMKL;
  return WatchProgressSource.TRAKT;
}

function normalizeLibrarySourceMode(value) {
  const normalized = String(value || TraktLibrarySourceMode.TRAKT).toLowerCase();
  if (normalized === TraktLibrarySourceMode.LOCAL) return TraktLibrarySourceMode.LOCAL;
  if (normalized === TraktLibrarySourceMode.SIMKL) return TraktLibrarySourceMode.SIMKL;
  return TraktLibrarySourceMode.TRAKT;
}

function normalizeSimklAnimeIdPreference(value) {
  const normalized = String(value || SimklAnimeIdPreference.IMDB).toLowerCase();
  return Object.values(SimklAnimeIdPreference).includes(normalized)
    ? normalized
    : SimklAnimeIdPreference.IMDB;
}

function normalizeMoreLikeThisSource(value) {
  return String(value || MoreLikeThisSourcePreference.TRAKT).toLowerCase() ===
    MoreLikeThisSourcePreference.TMDB
    ? MoreLikeThisSourcePreference.TMDB
    : MoreLikeThisSourcePreference.TRAKT;
}

export function normalizeTraktContinueWatchingDaysCap(days) {
  const value = Number(days);
  if (value === TRAKT_CONTINUE_WATCHING_DAYS_CAP_ALL) {
    return TRAKT_CONTINUE_WATCHING_DAYS_CAP_ALL;
  }
  if (!Number.isFinite(value)) {
    return TRAKT_DEFAULT_CONTINUE_WATCHING_DAYS_CAP;
  }
  return Math.max(7, Math.min(365, Math.trunc(value)));
}

function normalize(settings = {}) {
  return {
    continueWatchingDaysCap: normalizeTraktContinueWatchingDaysCap(
      settings.continueWatchingDaysCap
    ),
    showMetaComments: settings.showMetaComments !== false,
    watchProgressSource: normalizeWatchProgressSource(settings.watchProgressSource),
    librarySourceMode: normalizeLibrarySourceMode(settings.librarySourceMode),
    simklAnimeIdPreference: normalizeSimklAnimeIdPreference(settings.simklAnimeIdPreference),
    moreLikeThisSource: normalizeMoreLikeThisSource(settings.moreLikeThisSource)
  };
}

const store = createProfileScopedStore({
  key: STORE_KEY,
  normalize
});

export const TraktSettingsStore = {
  get() {
    return store.get();
  },

  set(partial, options = {}) {
    return store.set(partial, options);
  },

  getForProfile(profileId) {
    return store.getForProfile(profileId);
  },

  setForProfile(profileId, partial, options = {}) {
    return store.setForProfile(profileId, partial, options);
  },

  setContinueWatchingDaysCap(days) {
    return this.set({ continueWatchingDaysCap: normalizeTraktContinueWatchingDaysCap(days) });
  },

  setShowMetaComments(enabled) {
    return this.set({ showMetaComments: Boolean(enabled) });
  },

  setWatchProgressSource(source) {
    return this.set({ watchProgressSource: normalizeWatchProgressSource(source) });
  },

  setLibrarySourceMode(mode) {
    // Library Source is a client-local preference. Persist it for this Web
    // browser/profile without scheduling a shared Profile Settings push.
    const previousMode = this.get().librarySourceMode;
    const next = this.set(
      { librarySourceMode: normalizeLibrarySourceMode(mode) },
      { silentSync: true }
    );
    if (next.librarySourceMode !== previousMode) {
      notifyLibrarySourceChange();
    }
    return next;
  },

  subscribeLibrarySource(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    librarySourceListeners.add(listener);
    return () => librarySourceListeners.delete(listener);
  },

  setSimklAnimeIdPreference(preference) {
    return this.set({
      simklAnimeIdPreference: normalizeSimklAnimeIdPreference(preference)
    });
  },

  setMoreLikeThisSource(source) {
    return this.set({ moreLikeThisSource: normalizeMoreLikeThisSource(source) });
  }
};
