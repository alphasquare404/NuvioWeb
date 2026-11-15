import { secureMediaUrl } from "../../core/streams/secureMediaUrl.js";
import {
  MediaConnectionsStore,
  findMediaServerStreams,
  mediaItemFilename,
  mediaServerPlaybackUrl,
  mediaTitleRef,
  readMediaTitleIdentity
} from "../../core/media/mediaConnections.js";
import { safeApiCall } from "../../core/network/safeApiCall.js";
import { addonRepository } from "./addonRepository.js";
import { StreamApi } from "../remote/api/streamApi.js";
import { MetaApi } from "../remote/api/metaApi.js";
import { PluginManager } from "../../core/player/pluginManager.js";
import {
  cleanLocalPluginVideoId,
  isLocalPluginVideoId,
  resolvePluginSeasonEpisode
} from "../../core/player/pluginModels.js";
import { PLUGIN_LIMITS } from "../../core/player/pluginWorkerRuntime.js";
import { TmdbService } from "../../core/tmdb/tmdbService.js";
import { LocalDebridAvailabilityService } from "../../core/debrid/localDebridAvailabilityService.js";
import { DebridStreamPresentation } from "../../core/debrid/directDebridStreamPresentation.js";

const matchingId = (values, expression) =>
  values.map((value) => expression.exec(String(value || "").trim())?.[1]).find(Boolean);

export function streamTitleIdentity(videoId, options = {}) {
  const episodeParts = /:(\d+):(\d+)$/.exec(String(videoId || ""));
  return {
    imdbId: matchingId([options.imdbId, options.itemId, videoId], /^(tt\d+)(?::|$)/i),
    tmdbId: matchingId([options.tmdbId, options.itemId, videoId], /^(?:tmdb:)?(\d+)(?::|$)/i),
    tvdbId:
      matchingId([options.tvdbId], /^(?:tvdb:)?(\d+)$/i) ||
      matchingId([options.itemId, videoId], /^tvdb:(\d+)(?::|$)/i),
    title: options.title || undefined,
    season: options.season ?? episodeParts?.[1],
    episode: options.episode ?? episodeParts?.[2]
  };
}

export function addonStreamIds({ imdbId, tmdbId, tvdbId, season, episode }, type) {
  const series = ["series", "tv", "show"].includes(type);
  if (
    series &&
    (season == null ||
      episode == null ||
      !Number.isInteger(Number(season)) ||
      Number(season) < 0 ||
      !Number.isInteger(Number(episode)) ||
      Number(episode) < 1)
  )
    return [];
  const suffix = series ? `:${Number(season)}:${Number(episode)}` : "";
  return [imdbId, tmdbId && `tmdb:${tmdbId}`, tvdbId && `tvdb:${tvdbId}`]
    .filter(Boolean)
    .map((id) => id + suffix);
}

class StreamRepository {
  async getStreamsFromAddon(baseUrl, type, videoId) {
    const url = this.buildStreamUrl(baseUrl, type, videoId);
    const result = await safeApiCall(() => StreamApi.getStreams(url));
    if (result.status !== "success") {
      return result;
    }

    const streams = (result.data?.streams || []).map((stream) => this.mapStream(stream));
    return { status: "success", data: streams };
  }

  async getStreamsFromAllAddons(type, videoId, options = {}) {
    const nativeRef = mediaTitleRef(options.itemId) || mediaTitleRef(videoId);
    const identity = streamTitleIdentity(videoId, options);
    let nativeIdentityTask;
    const baseIdentity = () => {
      if (!nativeRef) return Promise.resolve(identity);
      if (
        (identity.imdbId || identity.tmdbId || identity.tvdbId) &&
        (type === "movie" || (identity.season != null && identity.episode != null))
      ) {
        return Promise.resolve(identity);
      }
      nativeIdentityTask ||= readMediaTitleIdentity(
        mediaTitleRef(videoId) || nativeRef,
        options.signal
      )
        .catch(() => ({}))
        .then((ids) => ({
          ...ids,
          ...Object.fromEntries(Object.entries(identity).filter(([, value]) => value != null))
        }));
      return nativeIdentityTask;
    };
    let expandedIdentityTask;
    const expandedIdentity = () => {
      expandedIdentityTask ||= baseIdentity().then(async (ids) => {
        if (ids.tmdbId && ids.imdbId && (type === "movie" || ids.tvdbId)) return ids;
        const publicId = ids.imdbId || (ids.tvdbId && `tvdb:${ids.tvdbId}`);
        const tmdbId =
          ids.tmdbId ||
          (publicId &&
            (await TmdbService.ensureTmdbId(publicId, type, {
              requireEnabled: false,
              signal: options.signal
            }).catch(() => null)));
        if (!tmdbId) return ids;
        const external = await TmdbService.externalIds(tmdbId, type, {
          signal: options.signal
        }).catch(() => null);
        return {
          ...ids,
          tmdbId,
          imdbId: ids.imdbId || external?.imdbId,
          tvdbId: ids.tvdbId || external?.tvdbId
        };
      });
      return expandedIdentityTask;
    };
    const installedAddons = (await addonRepository.getInstalledAddons()).map((addon, index) => ({
      ...addon,
      orderIndex: index
    }));
    const onAddon = typeof options?.onAddon === "function" ? options.onAddon : null;

    const onChunk = typeof options?.onChunk === "function" ? options.onChunk : null;

    const notifyChunk = (group) => {
      if (!onChunk || !group?.streams?.length) {
        return;
      }
      try {
        onChunk({
          status: "success",
          data: [group]
        });
      } catch (error) {
        console.warn("Stream chunk callback failed", error);
      }
    };

    const notifyAddon = (addon, orderIndex) => {
      if (!onAddon || !addon) {
        return;
      }
      try {
        onAddon({ ...addon, orderIndex });
      } catch (error) {
        console.warn("Stream addon callback failed", error);
      }
    };

    const prepareDebridGroup = async (group) => {
      const checkingGroup =
        DebridStreamPresentation.apply(LocalDebridAvailabilityService.markChecking([group]))[0] ||
        group;
      const checkedGroup =
        (await LocalDebridAvailabilityService.annotateCachedAvailability([checkingGroup]))[0] ||
        checkingGroup;
      const presentedGroup = DebridStreamPresentation.apply([checkedGroup])[0] || checkedGroup;
      notifyChunk(presentedGroup);
      return presentedGroup;
    };

    const sourceAddons = options.preferredPluginOnly ? [] : installedAddons;
    const addonTasks = sourceAddons.map(async (addon) => {
      try {
        const tried = new Set();
        let announced = false;
        const orderIndex = Number(addon.orderIndex ?? Number.MAX_SAFE_INTEGER);
        const requestStreams = async (id) => {
          if (!id || options.signal?.aborted || tried.has(id)) return [];
          tried.add(id);
          // Secondary/aggregator catalogs sometimes expose a channel row while
          // the original addon owns the ID under `tv`. Exact type remains the
          // default; an explicit, unambiguous idPrefix may recover the owner type.
          const streamRequestType = addonRepository.resolveResourceRequestType(
            addon,
            "stream",
            type,
            id,
            { allowIdTypeFallback: true }
          );
          const metaRequestType = addonRepository.resolveResourceRequestType(
            addon,
            "meta",
            type,
            id,
            { allowIdTypeFallback: true }
          );
          const canStream = Boolean(streamRequestType);
          const canMeta = Boolean(metaRequestType);
          // Meta-only stream discovery is a compatibility path for debrid cloud
          // items, which are exposed through the `other` type. Regular movie/series
          // metadata addons must not be queried as stream sources.
          const canTryMetaOnlyStreams =
            canMeta &&
            String(type || "")
              .trim()
              .toLowerCase() === "other";
          if (!canStream && !canTryMetaOnlyStreams) {
            return [];
          }
          if (!announced) notifyAddon(addon, orderIndex);
          announced = true;
          let addonStreams = [];
          let streamRequestSucceeded = false;
          if (canStream) {
            const streamsResult = await this.getStreamsFromAddon(
              addon.baseUrl,
              streamRequestType,
              id
            );
            if (streamsResult.status === "success") {
              streamRequestSucceeded = true;
              if (streamsResult.data.length) {
                addonStreams = streamsResult.data;
              }
            }
          }
          // Match Android: when a declared stream endpoint succeeds with no
          // results, try the matching meta video's inline streams even if the
          // manifest omitted its meta resource. Keep the existing meta-only
          // compatibility path for debrid cloud `other` catalogs as well.
          if (
            addonStreams.length === 0 &&
            ((canStream && streamRequestSucceeded) || canTryMetaOnlyStreams)
          ) {
            addonStreams = await this.fetchInlineStreamsFromMeta(
              addon,
              canStream ? streamRequestType : metaRequestType,
              id
            );
          }
          return addonStreams;
        };
        let addonStreams = [];
        const initial = nativeRef ? addonStreamIds(await baseIdentity(), type) : [videoId];
        for (const id of initial) {
          addonStreams = await requestStreams(id);
          if (addonStreams.length) break;
        }
        if (nativeRef && !addonStreams.length) {
          for (const id of addonStreamIds(await expandedIdentity(), type)) {
            addonStreams = await requestStreams(id);
            if (addonStreams.length) break;
          }
        }
        if (addonStreams.length === 0) {
          return null;
        }

        const group = {
          addonId: addon.id,
          addonBaseUrl: addon.baseUrl,
          addonName: addon.displayName,
          addonLogo: addon.logo,
          addonOrderIndex: orderIndex,
          streamOrigin: {
            kind: "addon",
            addonId: addon.id,
            addonBaseUrl: addon.baseUrl,
            addonName: addon.displayName,
            addonOrderIndex: orderIndex
          },
          streams: addonStreams.map((stream) => ({
            ...stream,
            addonId: addon.id,
            addonBaseUrl: addon.baseUrl,
            addonName: addon.displayName,
            addonLogo: addon.logo,
            addonOrderIndex: orderIndex,
            streamOrigin: {
              ...(stream.streamOrigin || {}),
              kind: "addon",
              addonId: addon.id,
              addonBaseUrl: addon.baseUrl,
              addonName: addon.displayName,
              addonOrderIndex: orderIndex
            }
          }))
        };
        return prepareDebridGroup(group);
      } catch (_) {
        return null;
      }
    });

    const pluginTask = (async () => {
      const prepared = [];
      const controller = new AbortController();
      const abort = () => controller.abort();
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
      const timeout = setTimeout(abort, PLUGIN_LIMITS.globalTimeoutMs);
      try {
        const ids = nativeRef ? await baseIdentity() : identity;
        await this.getPluginStreams(type, videoId, {
          ...options,
          ...ids,
          signal: controller.signal,
          onGroup: (group) => prepared.push(prepareDebridGroup(group).catch(() => group))
        });
      } catch (error) {
        if (!controller.signal.aborted) console.warn("Plugin stream fetch failed", error);
      } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", abort);
      }
      const grouped = new Map();
      for (const group of await Promise.all(prepared)) {
        const previous = grouped.get(group.sourceProviderId);
        grouped.set(
          group.sourceProviderId,
          previous ? { ...previous, streams: [...previous.streams, ...group.streams] } : group
        );
      }
      return [...grouped.values()];
    })();

    const serverTask = Promise.all(
      (options.preferredPluginOnly ? [] : MediaConnectionsStore.get().servers)
        .filter(({ enabled }) => enabled !== false)
        .map(async (server) => {
          try {
            const own = mediaTitleRef(videoId) || nativeRef;
            const ids = own?.connectionId === server.id ? identity : await baseIdentity();
            let items = await findMediaServerStreams(server, type, videoId, { ...options, ...ids });
            if (!items.length && !options.signal?.aborted) {
              const fallback = await expandedIdentity();
              if (
                ["imdbId", "tmdbId", "tvdbId", "season", "episode"].some(
                  (key) => fallback[key] != null && fallback[key] !== ids[key]
                )
              ) {
                items = await findMediaServerStreams(server, type, videoId, {
                  ...options,
                  ...fallback
                });
              }
            }
            if (options.signal?.aborted || !items.length) return null;
            const group = {
              addonId: server.id,
              addonName: server.name,
              sourceProviderId: server.id,
              streams: items
                .filter((item) => item.Id)
                .map((item) => ({
                  id: `${server.id}:${item.Id}`,
                  name: server.name,
                  title: mediaItemFilename(item),
                  url: mediaServerPlaybackUrl(server, item.Id),
                  behaviorHints: { filename: mediaItemFilename(item) },
                  clientResolve: {
                    mediaServer: {
                      connectionId: server.id,
                      itemId: item.Id,
                      resumePositionMs: Math.floor(
                        (Number(item.UserData?.PlaybackPositionTicks) || 0) / 10000
                      )
                    }
                  }
                }))
            };
            notifyChunk(group);
            return group;
          } catch {
            return null;
          }
        })
    );
    const results = await Promise.all(addonTasks);
    const addonsWithStreams = results
      .filter(Boolean)
      .sort(
        (left, right) => Number(left.addonOrderIndex || 0) - Number(right.addonOrderIndex || 0)
      );
    const pluginStreams = await pluginTask;
    return {
      status: "success",
      data: [...addonsWithStreams, ...pluginStreams, ...(await serverTask).filter(Boolean)]
    };
  }

  async getPluginStreams(type, videoId, options = {}) {
    if (!PluginManager.pluginsEnabled || options.signal?.aborted) return [];
    const rawVideoId = String(videoId || "").trim();
    const localId = isLocalPluginVideoId(rawVideoId);
    const knownTmdbId = [options.tmdbId, options.itemId, rawVideoId]
      .map((id) => /^(?:(?:tmdb|movie|series):)*(\d+)(?::|$)/i.exec(String(id ?? "").trim())?.[1])
      .find(Boolean);
    const tmdbLookupId = localId
      ? rawVideoId
      : String(
          knownTmdbId ||
            options.imdbId ||
            (options.tvdbId && `tvdb:${options.tvdbId}`) ||
            options.itemId ||
            rawVideoId
        ).trim();
    const tmdbId = await TmdbService.ensureTmdbId(tmdbLookupId, type, {
      requireEnabled: false,
      signal: options.signal
    });
    const pluginId = tmdbId || (localId ? cleanLocalPluginVideoId(rawVideoId) : null);
    if (!pluginId) return [];
    const mapGroup = (result) => ({
      sourceProviderId: result.sourceId || result.sourceName || null,
      addonName: result.sourceName,
      addonLogo: null,
      streamOrigin: {
        kind: "plugin",
        sourceProviderId: result.sourceId || result.sourceName || null,
        addonName: result.sourceName || null
      },
      streams: (result.streams || []).map((stream) => ({
        ...stream,
        sourceProviderId: result.sourceId || result.sourceName || null,
        addonName: result.sourceName,
        addonLogo: null,
        streamOrigin: {
          ...(stream.streamOrigin || {}),
          kind: "plugin",
          sourceProviderId: result.sourceId || result.sourceName || null,
          addonName: result.sourceName || null
        }
      }))
    });
    const pluginResults = await PluginManager.executeScrapersStreaming({
      ...resolvePluginSeasonEpisode(rawVideoId, options.season, options.episode),
      tmdbId: pluginId,
      mediaType: tmdbId && (type === "series" || type === "show") ? "tv" : type,
      signal: options.signal,
      priorityBingeGroup: options.priorityBingeGroup,
      preferredPluginOnly: options.preferredPluginOnly,
      onGroup: options.onGroup ? (group) => options.onGroup(mapGroup(group)) : undefined
    });
    return pluginResults.map(mapGroup);
  }

  buildStreamUrl(baseUrl, type, videoId) {
    const cleanBaseUrl = addonRepository.canonicalizeUrl(baseUrl);
    const queryStart = cleanBaseUrl.indexOf("?");
    const basePath =
      queryStart >= 0 ? cleanBaseUrl.slice(0, queryStart).replace(/\/+$/, "") : cleanBaseUrl;
    const baseQuery = queryStart >= 0 ? cleanBaseUrl.slice(queryStart) : "";
    return `${basePath}/stream/${this.encode(type)}/${this.encode(videoId)}.json${baseQuery}`;
  }

  buildMetaUrl(baseUrl, type, id) {
    const cleanBaseUrl = addonRepository.canonicalizeUrl(baseUrl);
    const queryStart = cleanBaseUrl.indexOf("?");
    const basePath =
      queryStart >= 0 ? cleanBaseUrl.slice(0, queryStart).replace(/\/+$/, "") : cleanBaseUrl;
    const baseQuery = queryStart >= 0 ? cleanBaseUrl.slice(queryStart) : "";
    return `${basePath}/meta/${this.encode(type)}/${this.encode(id)}.json${baseQuery}`;
  }

  encode(value) {
    return encodeURIComponent(String(value || "")).replace(/\+/g, "%20");
  }

  mapStream(stream = {}) {
    const sidecarSubtitles = Array.isArray(stream.subtitles)
      ? stream.subtitles
          .filter((entry) => entry && entry.url)
          .map((entry) => ({
            id: entry.id || null,
            url: entry.url,
            lang: entry.lang || "unknown"
          }))
      : [];

    return {
      name: stream.name || null,
      title: stream.title || null,
      description: stream.description || null,
      url: stream.url ? secureMediaUrl(stream.url) : null,
      ytId: stream.ytId || null,
      infoHash: stream.infoHash || null,
      fileIdx: stream.fileIdx ?? null,
      externalUrl: stream.externalUrl || null,
      behaviorHints: stream.behaviorHints || null,
      sources: Array.isArray(stream.sources) ? stream.sources : [],
      quality: stream.quality || null,
      qualityValue: Number.isFinite(Number(stream.qualityValue)) ? Number(stream.qualityValue) : -1,
      clientResolve: stream.clientResolve || null,
      debridCacheStatus: stream.debridCacheStatus || null,
      subtitles: sidecarSubtitles
    };
  }

  async fetchInlineStreamsFromMeta(addon, type, videoId) {
    const rawVideoId = String(videoId || "").trim();
    if (!addon?.baseUrl || !rawVideoId) {
      return [];
    }

    // Try the content-level id (handles series episode ids like tt123:1:2)
    // and the raw id (handles content whose clicked id is the meta id itself,
    // e.g. debrid cloud "other" items keyed dmm:<torrentId>).
    const contentLevelId = this.buildContentLevelMetaId(rawVideoId);
    const candidateMetaIds = [];
    if (contentLevelId) {
      candidateMetaIds.push(contentLevelId);
    }
    if (rawVideoId && rawVideoId !== contentLevelId) {
      candidateMetaIds.push(rawVideoId);
    }

    for (const metaId of candidateMetaIds) {
      const url = this.buildMetaUrl(addon.baseUrl, type, metaId);
      const result = await safeApiCall(() => MetaApi.getMeta(url));

      if (result.status !== "success") {
        continue;
      }

      const meta = result.data?.meta || null;
      const videos = Array.isArray(meta?.videos) ? meta.videos : [];

      if (!videos.length) {
        continue;
      }

      const matchingVideo =
        videos.find((video) => String(video?.id || "") === rawVideoId) ||
        (type !== "series" && videos.length === 1 ? videos[0] : null);

      const streams = Array.isArray(matchingVideo?.streams) ? matchingVideo.streams : [];

      const mapped = streams
        .map((stream) => this.mapStream(stream))
        .filter(
          (stream) =>
            stream.url ||
            stream.externalUrl ||
            stream.ytId ||
            stream.clientResolve ||
            stream.infoHash
        );

      if (mapped.length) {
        return mapped;
      }
    }

    return [];
  }

  buildContentLevelMetaId(videoId) {
    const raw = String(videoId || "").trim();
    if (!raw) {
      return "";
    }
    const parts = raw.split(":");
    if (parts.length <= 1) {
      return raw;
    }
    let trailingNumericCount = 0;
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      if (!/^\d+$/.test(parts[index])) {
        break;
      }
      trailingNumericCount += 1;
    }
    const firstSegment = parts[0];
    const minSegments = /^tt/i.test(firstSegment) || /^\d+$/.test(firstSegment) ? 1 : 2;
    const segmentsToDrop = Math.min(trailingNumericCount, Math.max(0, parts.length - minSegments));
    return segmentsToDrop > 0 ? parts.slice(0, -segmentsToDrop).join(":") : raw;
  }
}

export const streamRepository = new StreamRepository();
