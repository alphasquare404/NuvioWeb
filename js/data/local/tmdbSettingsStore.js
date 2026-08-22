import { createProfileScopedStore } from "./profileScopedStore.js";
import { TMDB_API_KEY } from "../../config.js";

const KEY = "tmdbSettings";

const DEFAULTS = {
  enabled: false,
  apiKey: "",
  modernHomeEnabled: false,
  enrichContinueWatching: true,
  language: "en",
  useArtwork: true,
  useBasicInfo: true,
  useDetails: true,
  useReleaseDates: false,
  useCredits: true,
  useProductions: true,
  useNetworks: true,
  useEpisodes: true,
  useTrailers: true,
  useMoreLikeThis: true,
  useCollections: true
};

export function normalizeTmdbLanguageCode(value = DEFAULTS.language) {
  const normalized = String(value || DEFAULTS.language)
    .trim()
    .replace(/_/g, "-");
  if (!normalized) {
    return DEFAULTS.language;
  }

  const [rawLanguage = DEFAULTS.language, rawRegion = ""] = normalized.split("-", 2);
  const language = rawLanguage.toLowerCase() || DEFAULTS.language;
  const region = /^[a-z]{2}$/i.test(rawRegion) ? rawRegion.toUpperCase() : rawRegion;
  return region ? `${language}-${region}` : language;
}

function normalizeTmdbSettings(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    enabled: Boolean(source.enabled),
    apiKey: String(source.apiKey || "").trim(),
    modernHomeEnabled: Boolean(source.modernHomeEnabled),
    enrichContinueWatching: source.enrichContinueWatching !== false,
    language: normalizeTmdbLanguageCode(source.language),
    useArtwork: source.useArtwork !== false,
    useBasicInfo: source.useBasicInfo !== false,
    useDetails: source.useDetails !== false,
    useReleaseDates: source.useReleaseDates === true,
    useCredits: source.useCredits !== false,
    useProductions: source.useProductions !== false,
    useNetworks: source.useNetworks !== false,
    useEpisodes: source.useEpisodes !== false,
    useTrailers: source.useTrailers !== false,
    useMoreLikeThis: source.useMoreLikeThis !== false,
    useCollections: source.useCollections !== false
  };
}

const store = createProfileScopedStore({
  key: KEY,
  normalize: normalizeTmdbSettings
});

function queueProviderCredentialPush(profileId) {
  void import("../../core/profile/providerCredentialSyncService.js")
    .then(({ ProviderCredentialSyncService }) => ProviderCredentialSyncService.queuePush(profileId))
    .catch((error) => console.warn("TMDB credential sync enqueue failed", error));
}

function queueIfCredentialChanged(profileId, previous, next, options = {}) {
  if (
    !options.silentCredentialSync &&
    String(previous?.apiKey || "") !== String(next?.apiKey || "")
  ) {
    queueProviderCredentialPush(profileId);
  }
}

export const TmdbSettingsStore = {
  getForProfile(profileId) {
    return store.getForProfile(profileId);
  },

  get() {
    return store.get();
  },

  replaceForProfile(profileId, nextValue, options = {}) {
    const previous = store.getForProfile(profileId);
    const saved = store.replaceForProfile(profileId, nextValue, options);
    queueIfCredentialChanged(profileId, previous, saved, options);
    return saved;
  },

  setForProfile(profileId, partial, options = {}) {
    const previous = store.getForProfile(profileId);
    const saved = store.setForProfile(profileId, partial, options);
    queueIfCredentialChanged(profileId, previous, saved, options);
    return saved;
  },

  set(partial, options = {}) {
    return this.setForProfile(options.profileId, partial, options);
  },

  setApiKeyForProfile(profileId, value, options = {}) {
    return this.setForProfile(
      profileId,
      { apiKey: String(value || "").trim() },
      { ...options, silentSync: true }
    );
  },

  setApiKey(value, options = {}) {
    return this.setApiKeyForProfile(options.profileId, value, options);
  },

  clearApiKey(options = {}) {
    return this.setApiKey("", options);
  }
};

// Use this instead of reading Config.TMDB_API_KEY at individual call sites.
// The synced, profile-scoped credential cache takes precedence over deployment
// runtime configuration. It is intentionally excluded from profile-settings
// sync because provider credential sync owns this value.
export function getEffectiveTmdbApiKey() {
  return String(TmdbSettingsStore.get().apiKey || "").trim() || String(TMDB_API_KEY || "").trim();
}
