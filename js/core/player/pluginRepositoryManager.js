import { PluginStore, getEffectivePluginProfileId } from "../../data/local/pluginStore.js";
import { PluginCodeStore } from "../../data/local/pluginCodeStore.js";
import { PluginProviderPlaysStore } from "../../data/local/pluginProviderPlaysStore.js";
import { registerAccountRuntimeResetHandler } from "../auth/accountLocalDataReset.js";
import { emitPluginDiagnosticEvent } from "../diagnostics/pluginDiagnostics.js";
import { pluginBingeGroup } from "../streams/pluginBingeGroup.js";
import { PluginExecutionFlight } from "./pluginExecutionFlight.js";
import { fetchPluginResource } from "./pluginFetch.js";
import {
  androidJsScraperId,
  canonicalizePluginUrl,
  isExecutableScraper,
  isPluginShortCode,
  normalizeExternalRepositoryMetadata,
  normalizePluginManifest,
  PLUGIN_REPOSITORY_TYPES,
  pluginSupportsType,
  repositoryIdForUrl,
  sanitizePluginRepositoryInput
} from "./pluginModels.js";
import { planPluginRun, pluginProviderPlayStats } from "./pluginProviderPriority.js";
import { ensurePluginRuntime, executePlugin, PLUGIN_LIMITS } from "./pluginWorkerRuntime.js";

const { NUVIO_JS, EXTERNAL_DEX, UNKNOWN } = PLUGIN_REPOSITORY_TYPES;
const searchFlight = new PluginExecutionFlight();
const repositoryFlight = new PluginExecutionFlight();
const accountRequests = new Set();
let accountGeneration = 0;
let running = 0;
const queued = [];

registerAccountRuntimeResetHandler(async () => {
  accountGeneration++;
  for (const request of accountRequests) request.abort();
  await PluginCodeStore.clearAll();
});

function runBounded(task, signal) {
  return new Promise((resolve, reject) => {
    const start = async () => {
      if (signal?.aborted) {
        resolve([]);
        queued.shift()?.();
        return;
      }
      running++;
      try {
        resolve(await task());
      } catch (error) {
        reject(error);
      } finally {
        running--;
        queued.shift()?.();
      }
    };
    if (running < PLUGIN_LIMITS.maxConcurrent) void start();
    else queued.push(start);
  });
}

async function readResource(url, maxResponseBytes, signal) {
  const result = await fetchPluginResource({ url, maxResponseBytes, signal });
  if (!result.ok) throw new Error("Plugin resource returned HTTP " + result.status);
  if (result.truncated) throw new Error("Plugin resource exceeds its size limit");
  return result;
}

function executable(state, mediaType) {
  return state.scrapers.filter((scraper) => {
    const repo = state.repositories.find((candidate) => candidate.id === scraper.repositoryId);
    return (
      repo?.enabled !== false &&
      isExecutableScraper(scraper, repo) &&
      pluginSupportsType(scraper.supportedTypes, mediaType)
    );
  });
}

function stringHeaders(headers) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return null;
  const entries = Object.entries(headers).filter(([, value]) => typeof value === "string");
  return entries.length ? Object.fromEntries(entries) : null;
}

function pluginMediaUrl(value, allowedProtocols = ["http:", "https:"]) {
  if (typeof value !== "string" || !value.trim() || value.includes("[object")) return "";
  try {
    return allowedProtocols.includes(new URL(value).protocol) ? value.trim() : "";
  } catch {
    return "";
  }
}

export function mapPluginResult(result, scraper) {
  const rawUrl = typeof result?.url === "string" ? result.url : result?.url?.url;
  const url = pluginMediaUrl(rawUrl, ["http:", "https:", "magnet:"]);
  if (!url) return null;
  const quality = String(result.quality ?? "").trim();
  const title = String(result.title ?? result.name ?? scraper.name).trim() || scraper.name;
  const name = String(result.name ?? title).trim() || title;
  const label = quality || "Unknown";
  const language = result.language == null ? "" : String(result.language);
  const headers = stringHeaders(result.headers);
  const subtitles = (Array.isArray(result.subtitles) ? result.subtitles : [])
    .filter((entry) => pluginMediaUrl(entry?.url))
    .map((entry) => ({
      id: entry.id || entry.url,
      url: entry.url,
      lang: entry.language || entry.lang || "Unknown",
      headers: stringHeaders(entry.headers || entry.behaviorHints?.proxyHeaders?.request),
      addonName: entry.name || "Plugin",
      isStreamProvided: true
    }));
  return {
    title,
    name: name.includes(label) ? name : name + " - " + label,
    description: [result.size, language].filter(Boolean).join(" • ") || null,
    url,
    quality: quality || null,
    infoHash: typeof result.infoHash === "string" ? result.infoHash : null,
    pluginSourceName: scraper.name,
    behaviorHints: {
      bingeGroup: pluginBingeGroup({ scraperId: scraper.id, name, title, language, quality }),
      ...(headers ? { proxyHeaders: { request: headers, response: null } } : {})
    },
    subtitles
  };
}

async function loadRepository(input, signal) {
  const cleaned = sanitizePluginRepositoryInput(input);
  const rawUrl = isPluginShortCode(cleaned)
    ? (
        await readResource(
          "https://cutt.ly/" + encodeURIComponent(cleaned),
          PLUGIN_LIMITS.maxManifestBytes,
          signal
        )
      ).url
    : cleaned;
  if (/\.cs3(?:$|[?#])/i.test(rawUrl)) {
    return {
      url: canonicalizePluginUrl(new URL(rawUrl).href),
      name: new URL(rawUrl).pathname.split("/").at(-1),
      type: EXTERNAL_DEX,
      scrapers: []
    };
  }

  const url = canonicalizePluginUrl(rawUrl);
  if (!url) throw new Error("Enter a plugin repository URL");
  const candidates = [...new Set([canonicalizePluginUrl(url, { manifest: true }), url])];
  let failure;
  for (const candidate of candidates) {
    try {
      const resource = await readResource(candidate, PLUGIN_LIMITS.maxManifestBytes, signal);
      const document = JSON.parse(resource.body);
      const manifest = normalizePluginManifest(document, resource.url);
      if (manifest) {
        return {
          url: canonicalizePluginUrl(resource.url),
          name: manifest.name,
          description: manifest.description,
          type: NUVIO_JS,
          scrapers: manifest.scrapers
        };
      }
      const metadata = normalizeExternalRepositoryMetadata(document, resource.url);
      if (metadata) {
        const urls = [...new Set(metadata.pluginLists)].filter(
          (value) => !/\.cs3(?:$|[?#])/i.test(value)
        );
        for (const listUrl of urls.slice(0, 8)) {
          try {
            const list = JSON.parse(
              (await readResource(listUrl, PLUGIN_LIMITS.maxManifestBytes, signal)).body
            );
            const entries = Array.isArray(list) ? list : list?.plugins;
            if (Array.isArray(entries))
              metadata.plugins.push(...entries.slice(0, 512 - metadata.plugins.length));
          } catch (error) {
            if (signal?.aborted) throw error;
          }
          if (metadata.plugins.length >= 512) break;
        }
        return {
          url: canonicalizePluginUrl(resource.url),
          name: metadata.name,
          description: metadata.description,
          type: EXTERNAL_DEX,
          metadata,
          scrapers: []
        };
      }
      failure = new Error("Invalid plugin manifest");
    } catch (error) {
      if (signal?.aborted) throw error;
      failure = error;
    }
  }
  throw failure || new Error("Invalid plugin repository URL");
}

async function getCode(scraper, profileId, signal) {
  const cached = await PluginCodeStore.get(scraper.id, profileId);
  if (cached?.version === scraper.version && cached?.url === scraper.codeUrl) return cached.code;
  try {
    const resource = await readResource(scraper.codeUrl, PLUGIN_LIMITS.maxCodeBytes, signal);
    if (!resource.body.trim()) throw new Error("Plugin scraper is empty");
    signal?.throwIfAborted();
    await PluginCodeStore.save(
      scraper.id,
      resource.body,
      { url: scraper.codeUrl, version: scraper.version },
      { maxBytes: PLUGIN_LIMITS.maxCacheBytes, profile: profileId }
    );
    return resource.body;
  } catch (error) {
    if (signal?.aborted || !cached?.code) throw error;
    return cached.code;
  }
}

function requireEditable() {
  if (!PluginStore.canEdit()) throw new Error("Plugin settings are read-only for this profile");
}

async function install(input, repositoryId, profileId) {
  const generation = accountGeneration;
  const request = new AbortController();
  accountRequests.add(request);
  try {
    const source = await loadRepository(input, request.signal);
    const current = PluginStore.get(profileId);
    const previous = current.repositories.find(
      (repo) => repo.id === repositoryId || repo.url === source.url
    );
    if (repositoryId && !previous) throw new Error("Repository was removed");
    if (!repositoryId && previous) return previous;
    const id = previous?.id || repositoryIdForUrl(source.url);
    const existing = current.scrapers.filter((scraper) => scraper.repositoryId === id);
    const scrapers = source.scrapers.map((entry) => {
      const old = existing.find((scraper) => scraper.manifestId === entry.id);
      return {
        ...entry,
        repositoryId: id,
        manifestId: entry.id,
        id: old?.id || androidJsScraperId(id, entry.id),
        enabled: old?.enabled ?? entry.enabled,
        manifestEnabled: entry.enabled,
        type: NUVIO_JS
      };
    });
    await Promise.allSettled(
      scrapers.map((scraper) =>
        runBounded(() => getCode(scraper, profileId, request.signal), request.signal)
      )
    );
    request.signal.throwIfAborted();
    if (generation !== accountGeneration) throw new Error("Plugin profile changed");

    const latest = PluginStore.get(profileId);
    const live = latest.repositories.find((repo) => repo.id === id || repo.url === source.url);
    if (repositoryId && !live) throw new Error("Repository was removed");
    if (!repositoryId && live) return live;
    const { scrapers: sourceScrapers, ...metadata } = source;
    const repository = {
      ...metadata,
      id,
      enabled: live?.enabled ?? true,
      lastUpdated: Date.now(),
      scraperCount: sourceScrapers.length || source.metadata?.plugins?.length || 0,
      hydrated: true
    };
    const repositories = live
      ? latest.repositories.map((repo) => (repo.id === id ? repository : repo))
      : [...latest.repositories, repository];
    PluginStore.replace(
      {
        ...latest,
        repositories,
        scrapers: [
          ...latest.scrapers.filter((scraper) => scraper.repositoryId !== id),
          ...scrapers.map((scraper) => ({
            ...scraper,
            enabled:
              latest.scrapers.find((entry) => entry.id === scraper.id)?.enabled ?? scraper.enabled
          }))
        ]
      },
      profileId
    );
    const kept = new Set(scrapers.map((scraper) => scraper.id));
    await Promise.allSettled(
      existing
        .filter((scraper) => !kept.has(scraper.id))
        .map((scraper) => PluginCodeStore.remove(scraper.id, profileId))
    );
    return repository;
  } finally {
    accountRequests.delete(request);
  }
}

async function runScraper(scraper, state, args, profileId, signal, onRequestFailure) {
  const settings = state.settings.scraperSettings[scraper.id] || {};
  const run = (executionSignal) =>
    runBounded(async () => {
      const code = await getCode(scraper, profileId, executionSignal);
      return executePlugin({
        code,
        filename: scraper.filename,
        scraperId: scraper.id,
        args,
        settings,
        signal: executionSignal,
        onRequestFailure
      });
    }, executionSignal);
  if (onRequestFailure) return run(signal);
  const key = JSON.stringify([
    accountGeneration,
    profileId,
    scraper.id,
    scraper.version,
    settings,
    args
  ]);
  return searchFlight.run(key, run, { signal });
}

export const PluginRepositoryManager = {
  listRepositories() {
    return PluginStore.get().repositories;
  },
  listScrapers(repositoryId) {
    return PluginStore.get().scrapers.filter(
      (scraper) => !repositoryId || scraper.repositoryId === repositoryId
    );
  },
  listStreamSourceNames(mediaType) {
    const state = PluginStore.get();
    if (!state.settings.pluginsEnabled) return [];
    const byRepository = state.settings.groupStreamsByRepository;
    const repositories = new Map(
      state.repositories.map((repository) => [repository.id, repository])
    );
    const names = executable(state, mediaType).map((scraper) =>
      byRepository ? repositories.get(scraper.repositoryId).name : scraper.name
    );
    if (byRepository) {
      for (const repository of state.repositories) {
        if (
          [NUVIO_JS, UNKNOWN].includes(repository.type) &&
          repository.enabled &&
          !repository.hydrated
        ) {
          names.push(repository.name);
        }
      }
    }
    return [...new Set(names.filter(Boolean))];
  },
  canEdit() {
    return PluginStore.canEdit();
  },
  get groupStreamsByRepository() {
    return PluginStore.get().settings.groupStreamsByRepository;
  },
  setGroupStreamsByRepository(enabled) {
    requireEditable();
    const state = PluginStore.get();
    PluginStore.replace({
      ...state,
      settings: { ...state.settings, groupStreamsByRepository: Boolean(enabled) }
    });
  },
  addRepository(url) {
    requireEditable();
    const profileId = getEffectivePluginProfileId();
    return repositoryFlight.run(JSON.stringify([accountGeneration, profileId, url]), () =>
      install(url, null, profileId)
    );
  },
  refreshRepository(id) {
    requireEditable();
    const repository = this.listRepositories().find((entry) => entry.id === id);
    if (!repository) throw new Error("Repository not found");
    const profileId = getEffectivePluginProfileId();
    return repositoryFlight.run(JSON.stringify([accountGeneration, profileId, id]), () =>
      install(repository.url, id, profileId)
    );
  },
  async removeRepository(id) {
    requireEditable();
    const profileId = getEffectivePluginProfileId();
    const state = PluginStore.get(profileId);
    PluginStore.replace(
      {
        ...state,
        repositories: state.repositories.filter((entry) => entry.id !== id),
        scrapers: state.scrapers.filter((entry) => entry.repositoryId !== id)
      },
      profileId
    );
    await Promise.allSettled(
      state.scrapers
        .filter((entry) => entry.repositoryId === id)
        .map((entry) => PluginCodeStore.remove(entry.id, profileId))
    );
  },
  setRepositoryEnabled(id, enabled) {
    requireEditable();
    const state = PluginStore.get();
    PluginStore.replace({
      ...state,
      repositories: state.repositories.map((entry) =>
        entry.id === id ? { ...entry, enabled } : entry
      )
    });
  },
  setRepositoryScrapersEnabled(repositoryId, enabled) {
    requireEditable();
    const state = PluginStore.get();
    PluginStore.replace({
      ...state,
      scrapers: state.scrapers.map((entry) =>
        entry.repositoryId === repositoryId ? { ...entry, enabled } : entry
      )
    });
  },
  setScraperEnabled(id, enabled) {
    requireEditable();
    const state = PluginStore.get();
    PluginStore.replace({
      ...state,
      scrapers: state.scrapers.map((entry) => (entry.id === id ? { ...entry, enabled } : entry))
    });
  },
  setScraperSettings(id, settings) {
    requireEditable();
    const state = PluginStore.get();
    PluginStore.replace({
      ...state,
      settings: {
        ...state.settings,
        scraperSettings: { ...state.settings.scraperSettings, [id]: settings }
      }
    });
  },
  getScraperSettings(id) {
    return PluginStore.get().settings.scraperSettings[id] || {};
  },
  async testScraper(id, { tmdbId = "603", signal, onRequestFailure } = {}) {
    const profileId = getEffectivePluginProfileId();
    const state = PluginStore.get(profileId);
    const scraper = state.scrapers.find((entry) => entry.id === id && entry.type === NUVIO_JS);
    const repository = state.repositories.find((entry) => entry.id === scraper?.repositoryId);
    if (!repository?.enabled || !isExecutableScraper(scraper, repository)) {
      throw new Error("Scraper is unavailable");
    }
    const isMovie = pluginSupportsType(scraper.supportedTypes, "movie");
    await ensurePluginRuntime();
    return runScraper(
      scraper,
      state,
      {
        tmdbId: String(tmdbId),
        mediaType: isMovie ? "movie" : "tv",
        season: isMovie ? null : 1,
        episode: isMovie ? null : 1
      },
      profileId,
      signal,
      onRequestFailure
    );
  },
  async search({
    tmdbId,
    mediaType,
    season = null,
    episode = null,
    onGroup,
    signal,
    priorityBingeGroup,
    preferredPluginOnly
  } = {}) {
    const profileId = getEffectivePluginProfileId();
    const generation = accountGeneration;
    await Promise.allSettled(
      PluginStore.get(profileId)
        .repositories.filter(
          (repo) =>
            repo.enabled !== false && [NUVIO_JS, UNKNOWN].includes(repo.type) && !repo.hydrated
        )
        .map((repo) =>
          repositoryFlight.run(
            JSON.stringify([generation, profileId, repo.id]),
            () => install(repo.url, repo.id, profileId),
            { signal }
          )
        )
    );
    if (signal?.aborted || generation !== accountGeneration) return [];
    const state = PluginStore.get(profileId);
    const eligible = executable(state, mediaType);
    if (!eligible.length || signal?.aborted) return [];
    await ensurePluginRuntime();
    const plan = planPluginRun(eligible, {
      id: (scraper) => scraper.id,
      priorityBingeGroup,
      preferredOnly: preferredPluginOnly,
      stats: pluginProviderPlayStats(PluginProviderPlaysStore.get())
    });
    const args = { tmdbId: String(tmdbId), mediaType, season, episode };
    const groups = new Map();
    let count = 0;
    const run = async (scraper) => {
      let results;
      try {
        results = await runScraper(scraper, state, args, profileId, signal);
      } catch (error) {
        if (!signal?.aborted)
          emitPluginDiagnosticEvent("Plugin scraper failed", {
            scraperId: scraper.id,
            error: error.message
          });
        return false;
      }
      if (signal?.aborted || profileId !== getEffectivePluginProfileId()) return false;
      const streams = (results || [])
        .map((result) => mapPluginResult(result, scraper))
        .filter(Boolean)
        .slice(0, Math.max(0, PLUGIN_LIMITS.maxResults - count));
      if (!streams.length) return false;
      count += streams.length;
      const repository = state.repositories.find((entry) => entry.id === scraper.repositoryId);
      const groupByRepository = state.settings.groupStreamsByRepository;
      const sourceId = groupByRepository ? repository.id : scraper.id;
      const group = {
        sourceId,
        sourceName: groupByRepository ? repository.name : scraper.name,
        repositoryId: repository.id,
        repositoryName: repository.name,
        streams
      };
      const previous = groups.get(sourceId);
      groups.set(
        sourceId,
        previous ? { ...group, streams: [...previous.streams, ...streams] } : group
      );
      onGroup?.(group);
      return true;
    };
    if (!plan.preferred || !(await run(plan.preferred))) await Promise.all(plan.others.map(run));
    return signal?.aborted ? [] : [...groups.values()];
  }
};
