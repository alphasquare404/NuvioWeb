import { projectServerWatchState } from "../../core/media/mediaServerWatchState.js";
import {
  MediaConnectionsStore,
  mediaServerItem,
  mediaServerItems,
  mediaServerLibraries,
  mediaServerResume,
  mediaProviderIds,
  mediaTitleId,
  mediaTitleRef,
  selectedMediaLibraries
} from "../../core/media/mediaConnections.js";

const basePrefix = "nuvio-server://";
const pageSize = 100;
const titleTypes = {
  movie: "Movie",
  series: "Series",
  mixed: "Movie,Series",
  collection: "BoxSet"
};
const libraryCache = new Map();

export function mediaCatalogLibraries(server, { refresh = false } = {}) {
  const cached = libraryCache.get(server.id);
  if (!refresh && cached?.token === server.token) return cached.task;
  const task = mediaServerLibraries(server).catch((error) => {
    if (libraryCache.get(server.id)?.task === task) libraryCache.delete(server.id);
    throw error;
  });
  libraryCache.set(server.id, { token: server.token, task });
  return task;
}

MediaConnectionsStore.subscribe(({ previousValue, value }) => {
  for (const server of previousValue?.servers || []) {
    if (!value?.servers.some(({ id, token }) => id === server.id && token === server.token)) {
      libraryCache.delete(server.id);
    }
  }
});

export const isMediaCatalogBase = (base) => String(base || "").startsWith(basePrefix);

export async function mediaCatalogAddons({ search = false, resumeLabel = "Resume" } = {}) {
  const { servers } = MediaConnectionsStore.get();
  const built = await Promise.all(
    servers
      .filter(({ enabled }) => enabled !== false)
      .map(async (server) => {
        const libraries = selectedMediaLibraries(
          server,
          await mediaCatalogLibraries(server).catch(() => [])
        );
        if (!libraries.length) return null;
        const kinds = [
          ...new Set(
            libraries.flatMap(({ kind }) =>
              kind === "mixed" ? ["movie", "series"] : kind === "collection" ? [] : [kind]
            )
          )
        ];
        const catalogs = search
          ? kinds.map((kind) => ({
              id: `search-${kind}`,
              name: server.name,
              apiType: kind,
              extra: [{ name: "search", isRequired: true }]
            }))
          : [
              ...(kinds.length
                ? [{ id: "resume", name: resumeLabel, apiType: "movie", extra: [] }]
                : []),
              ...libraries.map(({ id, kind, name }) => ({
                id: `library-${id}`,
                name,
                apiType: kind === "mixed" ? "movie" : kind,
                extra: [{ name: "skip", isRequired: false }]
              }))
            ];
        return {
          id: server.id,
          name: server.name,
          displayName: server.name,
          baseUrl: basePrefix + encodeURIComponent(server.id),
          catalogs
        };
      })
  );
  const current = MediaConnectionsStore.get().servers.filter(({ enabled }) => enabled !== false);
  return built.filter((addon) => addon && current.some(({ id }) => id === addon.id));
}

function image(server, id, kind, tag) {
  return id && tag
    ? `${server.url}/Items/${encodeURIComponent(id)}/Images/${kind}?tag=${encodeURIComponent(tag)}`
    : null;
}

function mapTitle(server, item) {
  const external = mediaProviderIds(item);
  // Catalog-metadata servers keep the add-on identity for the same title, so
  // resume/watched written elsewhere lands on the row the person just opened.
  const catalogId =
    server.useCatalogMetadata && item.Type !== "BoxSet"
      ? external.imdbId || (external.tmdbId ? `tmdb:${external.tmdbId}` : null)
      : null;
  return {
    id: catalogId || mediaTitleId(server, item.Id),
    name:
      item.Type === "Episode"
        ? `${item.SeriesName || ""} · ${item.Name}`.replace(/^ · /, "")
        : item.Name,
    type: item.Type === "Series" ? "series" : item.Type === "BoxSet" ? "collection" : "movie",
    poster: image(server, item.Id, "Primary", item.ImageTags?.Primary),
    background: image(server, item.Id, "Backdrop", item.BackdropImageTags?.[0]),
    logo:
      image(server, item.Id, "Logo", item.ImageTags?.Logo) ||
      image(server, item.ParentLogoItemId, "Logo", item.ParentLogoImageTag),
    description: item.Overview,
    releaseInfo: item.ProductionYear ? String(item.ProductionYear) : null,
    releaseDate: item.PremiereDate,
    genres: item.Genres,
    ...mediaProviderIds(item)
  };
}
export async function loadMediaCatalog({
  addonBaseUrl,
  addonId,
  addonName,
  catalogId,
  catalogName,
  type,
  skip,
  extraArgs,
  signal
}) {
  const server = MediaConnectionsStore.get().servers.find(
    ({ id }) => basePrefix + encodeURIComponent(id) === addonBaseUrl
  );
  if (!server) throw new Error("Media server disconnected.");
  const libraries = selectedMediaLibraries(server, await mediaCatalogLibraries(server));
  let records = [];
  let hasMore = false;
  const search = String(extraArgs.search || "").trim();
  if (catalogId === "resume" && skip === 0) {
    // Per-library scope can be applied to the server's Resume query too.
    const pages = await Promise.all(
      libraries
        .filter(({ kind }) => kind !== "collection")
        .map(({ id }) => mediaServerResume(server, signal, id))
    );
    records = pages.flatMap((page) => page?.Items || []);
  } else if (catalogId.startsWith("search-") && search && skip === 0) {
    const kind = catalogId.slice("search-".length);
    const scopes = libraries.filter((library) => library.kind === kind || library.kind === "mixed");
    const pages = await Promise.allSettled(
      scopes.map(({ id }) =>
        mediaServerItems(
          server,
          {
            ParentId: id,
            IncludeItemTypes: titleTypes[kind],
            SearchTerm: search,
            Limit: String(pageSize)
          },
          signal
        )
      )
    );
    records = pages.flatMap((page) => (page.status === "fulfilled" ? page.value?.Items || [] : []));
  } else {
    const library = libraries.find(({ id }) => catalogId === `library-${id}`);
    if (library) {
      const result = await mediaServerItems(
        server,
        {
          ParentId: library.id,
          IncludeItemTypes: titleTypes[library.kind],
          SortBy: "SortName",
          StartIndex: String(skip),
          Limit: String(pageSize),
          Fields: "ProviderIds,Container,UserData,RunTimeTicks",
          EnableTotalRecordCount: "true"
        },
        signal
      );
      records = result?.Items || [];
      hasMore = Number.isFinite(Number(result?.TotalRecordCount))
        ? skip + records.length < Number(result.TotalRecordCount)
        : records.length === pageSize;
    }
  }
  // Movie rows carry their own server state, so a library shelf can show the
  // same ticks and watched badges Detail will show.
  for (const record of records) {
    if (record?.Type === "Movie") {
      projectServerWatchState({ server, meta: mapTitle(server, record), items: [record] });
    }
  }
  const items = [
    ...new Map(
      records.filter((item) => item.Id && item.Name).map((item) => [item.Id, item])
    ).values()
  ].map((item) => ({
    ...mapTitle(server, item),
    addonId,
    addonBaseUrl,
    addonName,
    catalogType: type
  }));
  return {
    addonBaseUrl,
    addonId,
    addonName,
    catalogId,
    catalogName,
    apiType: type,
    items,
    hasMore,
    isLoading: false,
    supportsSkip: catalogId.startsWith("library-"),
    currentPage: Math.floor(skip / pageSize),
    nextSkip: skip + pageSize
  };
}

export async function loadMediaTitle(id) {
  const ref = mediaTitleRef(id);
  const server =
    ref && MediaConnectionsStore.get().servers.find(({ id }) => id === ref.connectionId);
  if (!server) throw new Error("Media server disconnected.");
  const item = await mediaServerItem(server, ref.itemId);
  if (!item?.Id) throw new Error("Title unavailable.");
  const meta = mapTitle(server, item);
  const available =
    item.Type === "Series"
      ? await mediaServerItems(server, {
          ParentId: item.Id,
          IncludeItemTypes: "Episode",
          Fields: "UserData,RunTimeTicks,ProviderIds",
          EnableImages: "true",
          EnableImageTypes: "Primary",
          SortBy: "ParentIndexNumber,IndexNumber"
        })
      : null;
  const result = {
    ...meta,
    runtime: item.RunTimeTicks ? `${Math.round(item.RunTimeTicks / 600000000)} min` : null,
    videos: (available?.Items || [])
      .filter((episode) => episode.Id && Number.isInteger(episode.IndexNumber))
      .map((episode) => ({
        id: mediaTitleId(server, episode.Id),
        title: episode.Name,
        season: episode.ParentIndexNumber ?? 0,
        episode: episode.IndexNumber,
        released: episode.PremiereDate,
        overview: episode.Overview,
        thumbnail: image(server, episode.Id, "Primary", episode.ImageTags?.Primary)
      }))
  };
  // Native-identity titles carry the server's own resume/watched state into the
  // same local stores the rest of the app reads.
  projectServerWatchState({
    server,
    meta: result,
    items: item.Type === "Series" ? available?.Items || [] : [item]
  });
  return result;
}
