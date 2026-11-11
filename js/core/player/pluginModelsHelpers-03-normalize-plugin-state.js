import {
  createDefaultPluginState,
  repositoryIdForUrl,
  androidJsScraperId,
  createLegacySource
} from "./pluginModelsHelpers-02-random-plugin-uuid.js";
import {
  MAX_PLUGIN_REPOSITORIES,
  canonicalizePluginUrl,
  normalizePluginRepositoryType,
  PLUGIN_REPOSITORY_TYPES,
  safePluginId,
  text,
  MAX_PLUGIN_SCRAPERS,
  stablePluginHash,
  list,
  PLUGIN_STATE_VERSION
} from "./pluginModelsHelpers-01-plugin-state-version.js";

export function normalizePluginState(raw) {
  const base = createDefaultPluginState();
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const repositoryUrls = new Set();
  const repositoryIds = new Set();
  const repositories = Array.isArray(value.repositories)
    ? value.repositories
        .slice(0, MAX_PLUGIN_REPOSITORIES)
        .map((entry, index) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const url = canonicalizePluginUrl(entry.url || entry.manifestUrl || entry.manifest_url);
          if (!url) {
            return null;
          }
          const declaredType = normalizePluginRepositoryType(
            entry.type || entry.repoType || entry.repo_type
          );
          const type = /\.cs3(?:$|[?#])/i.test(url)
            ? PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX
            : declaredType;
          const id = safePluginId(entry.id, repositoryIdForUrl(url));
          const urlKey = url.toLowerCase();
          const idKey = id.toLowerCase();
          if (repositoryUrls.has(urlKey) || repositoryIds.has(idKey)) return null;
          repositoryUrls.add(urlKey);
          repositoryIds.add(idKey);
          return {
            ...entry,
            id,
            name: text(entry.name, `Repository ${index + 1}`),
            url,
            description: text(entry.description),
            enabled: entry.enabled !== false,
            type,
            lastUpdated: Number(entry.lastUpdated || entry.last_updated || 0) || 0,
            scraperCount: Math.max(
              0,
              Math.trunc(Number(entry.scraperCount || entry.scraper_count || 0) || 0)
            ),
            metadata: entry.metadata && typeof entry.metadata === "object" ? entry.metadata : null
          };
        })
        .filter(Boolean)
    : [];
  const scraperById = new Map();
  const scraperIdentityKeys = new Set();
  const scrapers = Array.isArray(value.scrapers)
    ? value.scrapers
        .slice(0, MAX_PLUGIN_SCRAPERS)
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const repositoryId = safePluginId(entry.repositoryId || entry.repository_id, "repo");
          const identity =
            entry.manifestId ||
            entry.manifest_id ||
            entry.filename ||
            entry.sourceUrl ||
            entry.name ||
            stablePluginHash(JSON.stringify(entry));
          const identityKey =
            `${repositoryId}\n${identity}\n${entry.filename || entry.sourceUrl || ""}`.toLowerCase();
          if (scraperIdentityKeys.has(identityKey)) {
            return null;
          }
          scraperIdentityKeys.add(identityKey);
          // Preserve persisted IDs verbatim because they key the code and
          // settings stores. Newly normalized rows use Android's JS identity;
          // deterministic fallback IDs remain only for legacy repositories
          // whose data predates the Android-compatible identity.
          let id = text(entry.id) || androidJsScraperId(repositoryId, identity);
          if (scraperById.has(id)) {
            id = androidJsScraperId(
              repositoryId,
              `${identity}_${stablePluginHash(JSON.stringify(entry))}`
            );
          }
          if (scraperById.has(id)) {
            id = `${id}_${stablePluginHash(JSON.stringify(entry))}`;
          }
          const repository = repositories.find((candidate) => candidate.id === repositoryId);
          const repositoryType = repository?.type || PLUGIN_REPOSITORY_TYPES.NUVIO_JS;
          const declaredType = entry.type ?? entry.repoType ?? entry.repo_type;
          const scraperType =
            repositoryType === PLUGIN_REPOSITORY_TYPES.NUVIO_JS
              ? normalizePluginRepositoryType(declaredType, PLUGIN_REPOSITORY_TYPES.NUVIO_JS)
              : repositoryType;
          const normalized = {
            ...entry,
            id,
            repositoryId,
            name: text(entry.name, id),
            description: text(entry.description),
            version: text(entry.version, "1"),
            filename: text(entry.filename),
            supportedTypes: list(entry.supportedTypes || entry.supported_types || ["movie", "tv"]),
            enabled: entry.enabled !== false,
            manifestEnabled: entry.manifestEnabled !== false,
            logo: text(entry.logo) || null,
            contentLanguage: list(entry.contentLanguage || entry.content_language),
            supportedPlatforms: list(entry.supportedPlatforms || entry.supported_platforms),
            disabledPlatforms: list(entry.disabledPlatforms || entry.disabled_platforms),
            formats: list(entry.formats || entry.supportedFormats || entry.supported_formats),
            type: scraperType,
            manifestId: text(entry.manifestId || entry.manifest_id),
            codeUrl: text(entry.codeUrl || entry.code_url)
          };
          if (scraperById.has(id)) {
            return null;
          }
          scraperById.set(id, true);
          return normalized;
        })
        .filter(Boolean)
    : [];
  const legacyInput = Array.isArray(value.legacySources) ? value.legacySources : [];
  const settings = value.settings && typeof value.settings === "object" ? value.settings : {};
  const scraperSettings =
    settings.scraperSettings &&
    typeof settings.scraperSettings === "object" &&
    !Array.isArray(settings.scraperSettings)
      ? settings.scraperSettings
      : {};
  return {
    ...base,
    ...value,
    schemaVersion: PLUGIN_STATE_VERSION,
    repositories,
    scrapers,
    settings: {
      ...base.settings,
      ...settings,
      pluginsEnabled: settings.pluginsEnabled !== false,
      groupStreamsByRepository: settings.groupStreamsByRepository === true,
      scraperSettings
    },
    legacySources: legacyInput.map((entry, index) => createLegacySource(entry, index)),
    unknownRemoteRows: Array.isArray(value.unknownRemoteRows)
      ? value.unknownRemoteRows.slice(0, MAX_PLUGIN_REPOSITORIES)
      : [],
    rawRemoteRows: Array.isArray(value.rawRemoteRows)
      ? value.rawRemoteRows.slice(0, MAX_PLUGIN_REPOSITORIES)
      : [],
    syncDirty: value.syncDirty === true,
    runtime: {
      ...base.runtime,
      ...(value.runtime && typeof value.runtime === "object" ? value.runtime : {})
    }
  };
}

export function isExecutablePluginRepository(repository) {
  return (
    normalizePluginRepositoryType(repository?.type) === PLUGIN_REPOSITORY_TYPES.NUVIO_JS &&
    !/\.cs3(?:$|[?#])/i.test(String(repository?.url || ""))
  );
}

export function isExecutableScraper(scraper, repository, platformId = "") {
  if (
    !isExecutablePluginRepository(repository) ||
    normalizePluginRepositoryType(scraper?.type) !== PLUGIN_REPOSITORY_TYPES.NUVIO_JS
  ) {
    return false;
  }
  if (scraper?.enabled === false) {
    return false;
  }
  // Android currently persists manifest/platform flags as metadata but does
  // not gate execution on them. Preserve the fields for display/sync while
  // matching Android's actual JS behavior.
  void platformId;
  return true;
}
