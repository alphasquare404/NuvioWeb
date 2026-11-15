import { DebridSettingsStore } from "../local/debridSettingsStore.js";
import { DebridApi } from "../remote/api/debridApi.js";
import {
  MediaConnectionsStore,
  mediaItemFilename,
  mediaServerItems,
  mediaServerPlaybackUrl,
  selectedMediaLibraries
} from "../../core/media/mediaConnections.js";
import { mediaCatalogLibraries } from "./mediaServerCatalogRepository.js";
import {
  DEBRID_CAPABILITIES,
  DEBRID_PROVIDER_IDS,
  DebridProviders
} from "../../core/debrid/debridProviders.js";
import {
  CLOUD_LIBRARY_ITEM_TYPES,
  mapPremiumizeCloudItems,
  mapTorboxCloudItems
} from "../../core/cloud/cloudLibraryModels.js";

function responseError(response = {}) {
  return String(
    response?.data?.detail ||
      response?.data?.error ||
      response?.data?.message ||
      response?.data?.code ||
      response?.error?.message ||
      `HTTP ${Number(response?.status || 0) || "error"}`
  );
}

async function listProviderItems(credential) {
  const { provider, apiKey } = credential;
  if (provider.id === DEBRID_PROVIDER_IDS.TORBOX) {
    const definitions = [
      ["v1/api/torrents/mylist", CLOUD_LIBRARY_ITEM_TYPES.TORRENT],
      ["v1/api/usenet/mylist", CLOUD_LIBRARY_ITEM_TYPES.USENET],
      ["v1/api/webdl/mylist", CLOUD_LIBRARY_ITEM_TYPES.WEB_DOWNLOAD]
    ];
    const items = [];
    for (const [path, type] of definitions) {
      const response = await DebridApi.torboxListCloudItems(apiKey, path);
      if (!response.ok || response.data?.success === false)
        throw new Error(responseError(response));
      items.push(
        ...mapTorboxCloudItems(response.data?.data, {
          providerId: provider.id,
          providerName: provider.displayName,
          type
        })
      );
    }
    return items;
  }
  if (provider.id === DEBRID_PROVIDER_IDS.PREMIUMIZE) {
    const response = await DebridApi.premiumizeListCloudItems(apiKey);
    if (!response.ok || String(response.data?.status || "").toLowerCase() === "error") {
      throw new Error(responseError(response));
    }
    return mapPremiumizeCloudItems(response.data?.files, {
      providerId: provider.id,
      providerName: provider.displayName
    });
  }
  throw new Error(`Cloud library provider unavailable: ${provider.displayName}`);
}

export function cloudLibrarySettingsSignature(settings = DebridSettingsStore.get()) {
  return JSON.stringify({
    enabled: settings.cloudLibraryEnabled === true,
    torboxApiKey: String(settings.torboxApiKey || "").trim(),
    premiumizeApiKey: String(settings.premiumizeApiKey || "").trim(),
    servers: MediaConnectionsStore.get().servers.map(({ id, name, libraryIds, enabled }) => [
      id,
      name,
      libraryIds,
      enabled
    ])
  });
}

// The Cloud tab is a single list, so a server library contributes its titles to
// that list rather than standing as a section of its own. Only libraries that
// still exist on the server are used.
export function mediaServerSources(servers = [], librariesByServer = {}) {
  return servers
    .filter(({ enabled }) => enabled !== false)
    .map((server) => {
      const libraries = selectedMediaLibraries(server, librariesByServer[server.id] || [])
        .filter(({ kind }) => kind && kind !== "collection")
        .map(({ id, name, kind }) => ({ id, name, kind }));
      return libraries.length ? { id: server.id, name: server.name, libraries } : null;
    })
    .filter(Boolean);
}

function mediaServerImage(server, id, tag) {
  return id && tag
    ? `${server.url}/Items/${encodeURIComponent(id)}/Images/Primary?tag=${encodeURIComponent(tag)}`
    : null;
}

// A playable unit from a server, shaped like the debrid rows around it: the
// library it came from lets the picker narrow the list without a second fetch.
export function mediaServerCloudItem(server, library, item = {}) {
  return {
    providerId: server.id,
    providerName: server.name,
    libraryId: library?.id || "",
    libraryName: library?.name || "",
    id: item.Id,
    type: CLOUD_LIBRARY_ITEM_TYPES.FILE,
    kind: item.Type === "Movie" ? "movie" : "series",
    name: item.SeriesName ? `${item.SeriesName} – ${item.Name}` : item.Name,
    poster:
      mediaServerImage(server, item.Id, item.ImageTags?.Primary) ||
      mediaServerImage(server, item.SeriesId, item.SeriesPrimaryImageTag) ||
      mediaServerImage(server, item.ParentId, item.ParentPrimaryImageTag),
    stableKey: `${server.id}:${item.Id}`,
    resumePositionMs: Math.floor((Number(item.UserData?.PlaybackPositionTicks) || 0) / 10000),
    files: [
      {
        id: item.Id,
        name: mediaItemFilename(item),
        stableKey: item.Id,
        playable: true
      }
    ],
    progressFraction: Number.isFinite(item.UserData?.PlayedPercentage)
      ? item.UserData.PlayedPercentage / 100
      : null
  };
}

async function mediaServerLibraryItems(server, library) {
  const items = [];
  const limit = 100;
  for (let index = 0; ; index += limit) {
    const page = await mediaServerItems(server, {
      ParentId: library.id,
      IncludeItemTypes: "Movie,Episode",
      Fields: "ProviderIds,Container,ImageTags,SeriesPrimaryImageTag,ParentPrimaryImageTag",
      SortBy: "SortName",
      StartIndex: String(index),
      Limit: String(limit)
    });
    const rows = Array.isArray(page?.Items) ? page.Items : [];
    items.push(
      ...rows.filter((row) => row?.Id).map((row) => mediaServerCloudItem(server, library, row))
    );
    if (rows.length < limit || index + rows.length >= Number(page?.TotalRecordCount)) break;
  }
  return items;
}

export const cloudLibraryRepository = {
  async refresh() {
    const settings = DebridSettingsStore.get();
    const servers = MediaConnectionsStore.get().servers.filter(({ enabled }) => enabled !== false);
    if (!settings.cloudLibraryEnabled && !servers.length) {
      return {
        isLoaded: true,
        isEnabled: false,
        isRefreshing: false,
        providers: [],
        items: [],
        serverSources: []
      };
    }
    const credentials = (
      settings.cloudLibraryEnabled ? DebridProviders.configuredServices(settings) : []
    ).filter((credential) =>
      DebridProviders.supports(credential.provider.id, DEBRID_CAPABILITIES.CLOUD_LIBRARY)
    );
    const librariesByServer = Object.fromEntries(
      await Promise.all(
        servers.map(async (server) => [
          server.id,
          await mediaCatalogLibraries(server).catch(() => [])
        ])
      )
    );
    const serverSources = mediaServerSources(servers, librariesByServer);
    const serverItems = (
      await Promise.all(
        serverSources.map(async (source) => {
          const server = servers.find(({ id }) => id === source.id);
          const pages = await Promise.all(
            source.libraries.map((library) =>
              mediaServerLibraryItems(server, library).catch(() => [])
            )
          );
          return pages.flat();
        })
      )
    ).flat();
    const providers = [];
    for (const credential of credentials) {
      try {
        const items = await listProviderItems(credential);
        providers.push({
          provider: credential.provider,
          providerId: credential.provider.id,
          items,
          errorMessage: null
        });
      } catch (error) {
        providers.push({
          provider: credential.provider,
          providerId: credential.provider.id,
          items: [],
          errorMessage: String(error?.message || error || "") || null
        });
      }
    }
    return {
      isLoaded: true,
      isEnabled: true,
      isRefreshing: false,
      providers,
      items: [...serverItems, ...providers.flatMap((provider) => provider.items)],
      serverSources
    };
  },

  async resolvePlayback(item, file) {
    if (!file?.playable) return { status: "notPlayable" };
    if (item?.libraryId) {
      const server = MediaConnectionsStore.get().servers.find(({ id }) => id === item.providerId);
      return server
        ? {
            status: "success",
            url: mediaServerPlaybackUrl(server, file.id),
            filename: file.name,
            mediaServer: { connectionId: server.id, itemId: file.id },
            resumePositionMs: item.resumePositionMs
          }
        : { status: "missingCredentials" };
    }
    const settings = DebridSettingsStore.get();
    if (!settings.cloudLibraryEnabled) return { status: "disabled" };
    const apiKey = DebridProviders.apiKeyFor(settings, item?.providerId);
    if (!apiKey) return { status: "missingCredentials" };
    if (item.providerId === DEBRID_PROVIDER_IDS.PREMIUMIZE) {
      if (file.playbackUrl) {
        return {
          status: "success",
          url: file.playbackUrl,
          filename: file.name,
          videoSizeBytes: file.sizeBytes
        };
      }
      if (!file.id) return { status: "failed" };
      const response = await DebridApi.premiumizeCloudItemDetails(apiKey, file.id);
      const url = String(response.data?.link || "").trim();
      return response.ok && String(response.data?.status || "").toLowerCase() !== "error" && url
        ? {
            status: "success",
            url,
            filename: String(response.data?.name || file.name || "").trim() || null,
            videoSizeBytes: Number(response.data?.size || file.sizeBytes || 0) || null
          }
        : { status: "failed", message: responseError(response) };
    }
    if (item.providerId === DEBRID_PROVIDER_IDS.TORBOX) {
      const response = await DebridApi.torboxRequestCloudDownloadLink(
        apiKey,
        item.type,
        item.id,
        file.id
      );
      const url = typeof response.data?.data === "string" ? response.data.data.trim() : "";
      return response.ok && response.data?.success !== false && url
        ? {
            status: "success",
            url,
            filename: file.name || null,
            videoSizeBytes: file.sizeBytes || null
          }
        : { status: "failed", message: responseError(response) };
    }
    return { status: "failed" };
  }
};
