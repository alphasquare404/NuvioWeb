import { createProfileScopedStore } from "../../data/local/profileScopedStore.js";
import { registerPrivateMediaOrigin } from "../streams/privateMediaSource.js";

export const MEDIA_CONNECTIONS_KEY = "mediaConnections";
export const MediaConnectionsStore = createProfileScopedStore({
  key: MEDIA_CONNECTIONS_KEY,
  seedFromPrimary: false,
  normalize: (value) => ({
    servers: Array.isArray(value.servers)
      ? value.servers.filter(
          (server) => server?.id && server?.url && server?.userId && server?.token
        )
      : [],
    seerr: value.seerr?.url && value.seerr?.userId ? value.seerr : null
  })
});

export function mediaConnectionBase(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("Enter the server's base URL.");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Enter the server's base URL.");
  }
  return url.href.replace(/\/+$/, "");
}

async function request(
  base,
  route,
  { body, token, credentials = "omit", signal, authorization, method } = {}
) {
  registerPrivateMediaOrigin(base);
  const requestMethod = method || (body === undefined ? "GET" : "POST");
  const response = await fetch(base + route, {
    method: requestMethod,
    redirect: "error",
    referrerPolicy: "no-referrer",
    credentials,
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
      : AbortSignal.timeout(10000),
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { "X-Emby-Token": token } : {}),
      ...(authorization ? { "X-Emby-Authorization": authorization } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (!response.ok) {
    const error = new Error(`Server returned HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  const payload = await response.text();
  return payload ? JSON.parse(payload) : null;
}

const client = 'Client="NuvioWeb", Device="Web", DeviceId="nuvioweb", Version="0.2.2"';
const segment = encodeURIComponent;

export function mediaServerAddress(kind, url) {
  const base = mediaConnectionBase(url);
  return kind === "emby" ? base.replace(/\/emby$/i, "") : base;
}

export function mediaServerApiUrl(kind, address) {
  return kind === "emby" ? address + "/emby" : address;
}

export async function connectMediaServer({ kind, name, url, username, password }) {
  if (kind !== "jellyfin" && kind !== "emby") throw new Error("Unknown media server type.");
  const base = mediaConnectionBase(url);
  const address = mediaServerAddress(kind, base);
  const api = mediaServerApiUrl(kind, address);
  const data = await request(api, "/Users/AuthenticateByName", {
    body: { Username: username.trim(), Pw: password },
    authorization: `${kind === "emby" ? "Emby" : "MediaBrowser"} ${client}`
  });
  if (!data?.User?.Id || !data.AccessToken)
    throw new Error("The server did not return a user session.");
  return {
    id: `media:${kind}:${base}:${data.User.Id}`,
    kind,
    name: name.trim() || data.ServerName || (kind === "emby" ? "Emby" : "Jellyfin"),
    url: api,
    userId: data.User.Id,
    token: data.AccessToken,
    remoteServerId: data.ServerId || data.User.ServerId || "",
    userName: data.User.Name || username.trim()
  };
}

export async function readMediaServerSyncDetails(server) {
  const [info, user, libraries] = await Promise.all([
    server.remoteServerId ? null : request(server.url, "/System/Info/Public").catch(() => null),
    server.userName ? null : mediaServerItemUser(server).catch(() => null),
    Array.isArray(server.libraries) ? null : mediaServerLibraries(server).catch(() => null)
  ]);
  return {
    ...server,
    remoteServerId: server.remoteServerId || info?.Id || user?.ServerId || "",
    userName: server.userName || user?.Name || "",
    libraries: server.libraries || libraries || undefined
  };
}

function mediaServerItemUser(server) {
  return request(server.url, `/Users/${segment(server.userId)}`, { token: server.token });
}

export function mediaServerItems(server, params, signal) {
  const query = new URLSearchParams({
    Recursive: "true",
    Fields: "ProviderIds,Container",
    ...params
  });
  return request(server.url, `/Users/${segment(server.userId)}/Items?${query}`, {
    token: server.token,
    signal
  });
}

export async function mediaServerLibraries(server, signal) {
  const result = await request(server.url, `/Users/${segment(server.userId)}/Views`, {
    token: server.token,
    signal
  });
  return (result?.Items || []).flatMap((item) => {
    const collection = String(item.CollectionType || "").toLowerCase();
    const kind =
      { movies: "movie", tvshows: "series", mixed: "mixed", boxsets: "collection" }[collection] ||
      (collection ? "" : "mixed");
    return item.Id && item.Name && kind ? [{ id: String(item.Id), name: item.Name, kind }] : [];
  });
}

export const selectedMediaLibraries = (server, libraries) =>
  libraries.filter(({ id }) => !Array.isArray(server.libraryIds) || server.libraryIds.includes(id));

export const mediaTitleId = (server, itemId) => `server:${segment(server.id)}:${segment(itemId)}`;

export function mediaTitleRef(value) {
  const match = /^server:([^:]+):([^:]+)$/.exec(String(value || ""));
  if (!match) return null;
  try {
    return { connectionId: decodeURIComponent(match[1]), itemId: decodeURIComponent(match[2]) };
  } catch {
    return null;
  }
}

export function mediaServerItem(server, id, signal) {
  return request(server.url, `/Users/${segment(server.userId)}/Items/${segment(id)}`, {
    token: server.token,
    signal
  });
}

export function mediaServerResume(server, signal, parentId) {
  const query = new URLSearchParams({ MediaTypes: "Video", Limit: "100", ParentId: parentId });
  return request(server.url, `/Users/${segment(server.userId)}/Items/Resume?${query}`, {
    token: server.token,
    signal
  });
}

export function mediaServerPlaybackUrl(server, itemId) {
  registerPrivateMediaOrigin(server.url);
  const query = new URLSearchParams({ Static: "true", api_key: server.token });
  return `${server.url}/Videos/${segment(itemId)}/stream?${query}`;
}

export function mediaItemFilename(item) {
  const title = String(
    item.SeriesName ? `${item.SeriesName} - ${item.Name}` : item.Name || item.Id
  );
  const extension = String(item.Container || "").split(",")[0];
  return /^[a-z0-9]+$/i.test(extension) ? `${title}.${extension}` : title;
}

const seerrRequest = (connection, route, options = {}) =>
  request(connection.url, `/api/v1${route}`, { ...options, credentials: "include" });

export async function connectSeerr({ url, username, password, method = "local" }) {
  const base = mediaConnectionBase(url);
  const target = { url: base };
  const jellyfin = method === "jellyfin";
  const user = await seerrRequest(target, jellyfin ? "/auth/jellyfin" : "/auth/local", {
    body: { [jellyfin ? "username" : "email"]: username.trim(), password }
  });
  const session = await seerrRequest(target, "/auth/me");
  if (!user?.id || session?.id !== user.id)
    throw new Error("Seerr did not establish a browser session.");
  return { ...target, userId: user.id, name: user.displayName || user.email || "Seerr" };
}

export async function listSeerrRequests(connection) {
  const session = await seerrRequest(connection, "/auth/me");
  if (session?.id !== connection.userId)
    throw new Error("Sign in to the connected Seerr account again.");
  const result = await seerrRequest(
    connection,
    `/user/${segment(connection.userId)}/requests?take=30&skip=0`
  );
  const rows = Array.isArray(result?.results) ? result.results : [];
  const titles = new Map();
  const resolveTitle = async (row) => {
    const existing = row.media?.title || row.media?.name;
    if (existing) return existing;
    const type = row.type || row.mediaType || row.media?.mediaType;
    const id = Number(row.media?.tmdbId);
    if (!["movie", "tv"].includes(type) || !Number.isSafeInteger(id) || id < 1) return "";
    const route = `/${type}/${id}`;
    if (!titles.has(route)) {
      titles.set(
        route,
        seerrRequest(connection, route)
          .then((details) => details?.title || details?.name || "")
          .catch(() => "")
      );
    }
    return titles.get(route);
  };
  const requests = [];
  for (let index = 0; index < rows.length; index += 5) {
    const batch = rows.slice(index, index + 5);
    requests.push(
      ...(await Promise.all(
        batch.map(async (row) => ({
          ...row,
          title: await resolveTitle(row)
        }))
      ))
    );
  }
  return requests;
}

export function reportMediaServerProgress(connectionId, itemId, seconds, paused) {
  const server = MediaConnectionsStore.get().servers.find(({ id }) => id === connectionId);
  if (!server || !itemId) return;
  return request(server.url, "/Sessions/Playing/Progress", {
    token: server.token,
    body: {
      ItemId: itemId,
      PositionTicks: Math.round(seconds * 10000000),
      IsPaused: paused,
      PlayMethod: "DirectPlay"
    }
  }).catch(() => {});
}

// Jellyfin/Emby keep their own resume point for the next client that opens the
// title, so a stop is a real write, not cleanup. Sent in the same shape as the
// periodic progress call, with a session id the server can group them by.
export function reportMediaServerSession(
  server,
  { itemId, seconds = 0, paused = false, playSessionId = "", event = "progress" } = {}
) {
  if (!server || !itemId) return Promise.resolve();
  const route =
    event === "start"
      ? "/Sessions/Playing"
      : event === "stop"
        ? "/Sessions/Playing/Stopped"
        : "/Sessions/Playing/Progress";
  return request(server.url, route, {
    token: server.token,
    body: {
      ItemId: itemId,
      PositionTicks: Math.max(0, Math.round(Number(seconds || 0) * 10000000)),
      IsPaused: Boolean(paused),
      PlayMethod: "DirectPlay",
      CanSeek: true,
      ...(playSessionId ? { PlaySessionId: playSessionId } : {}),
      ...(event === "pause"
        ? { EventName: "Pause" }
        : event === "resume"
          ? { EventName: "Unpause" }
          : event === "progress"
            ? { EventName: "TimeUpdate" }
            : {})
    }
  }).catch(() => {});
}

export function mediaServerPlayed(server, itemId, played) {
  if (!server?.url || !itemId) return Promise.resolve();
  return request(server.url, `/Users/${segment(server.userId)}/PlayedItems/${segment(itemId)}`, {
    token: server.token,
    method: played ? "POST" : "DELETE"
  }).catch(() => {});
}

export function mediaProviderIds(item) {
  const ids = new Map(
    Object.entries(item?.ProviderIds || {}).map(([key, value]) => [
      key.toLowerCase(),
      String(value)
    ])
  );
  return { imdbId: ids.get("imdb"), tmdbId: ids.get("tmdb"), tvdbId: ids.get("tvdb") };
}

export async function readMediaTitleIdentity(ref, signal) {
  const server = MediaConnectionsStore.get().servers.find(({ id }) => id === ref.connectionId);
  if (!server) return {};
  const item = await mediaServerItem(server, ref.itemId, signal);
  const title =
    item?.Type === "Episode" && item.SeriesId
      ? await mediaServerItem(server, item.SeriesId, signal)
      : item;
  return {
    ...mediaProviderIds(title),
    title: title?.Name,
    season: item?.Type === "Episode" ? item.ParentIndexNumber : undefined,
    episode: item?.Type === "Episode" ? item.IndexNumber : undefined
  };
}

const jellyfinTitleIndexes = new Map();
const titleIndexPageSize = 500;
const titleIndexTtlMs = 10 * 60 * 1000;
MediaConnectionsStore.subscribe(({ previousValue }) => {
  for (const { id } of previousValue?.servers || []) jellyfinTitleIndexes.delete(id);
});

function jellyfinTitleIndex(server, type, libraryId) {
  const indexes = jellyfinTitleIndexes.get(server.id) || new Map();
  jellyfinTitleIndexes.set(server.id, indexes);
  const key = JSON.stringify([server.url, type, libraryId]);
  const cached = indexes.get(key);
  if (cached?.token === server.token && cached.expiresAt > Date.now()) return cached.task;
  const task = (async () => {
    const items = new Map();
    for (let offset = 0; ; offset += titleIndexPageSize) {
      const page = await mediaServerItems(server, {
        IncludeItemTypes: type,
        Fields: "ProviderIds",
        StartIndex: String(offset),
        Limit: String(titleIndexPageSize),
        EnableTotalRecordCount: "false",
        EnableImages: "false",
        EnableUserData: "false",
        ...(libraryId ? { ParentId: libraryId } : {})
      });
      const entries = page?.Items || [];
      const previousSize = items.size;
      entries.forEach((item) => items.set(item.Id, item));
      if (entries.length < titleIndexPageSize || items.size === previousSize) break;
    }
    return { Items: [...items.values()] };
  })().catch((error) => {
    if (indexes.get(key)?.task === task) indexes.delete(key);
    throw error;
  });
  indexes.set(key, { token: server.token, expiresAt: Date.now() + titleIndexTtlMs, task });
  return task;
}

export async function findMediaServerStreams(server, type, videoId, options = {}) {
  const own = mediaTitleRef(videoId) || mediaTitleRef(options.itemId);
  if (own?.connectionId === server.id && (type === "movie" || mediaTitleRef(videoId))) {
    const item = await mediaServerItem(server, own.itemId, options.signal).catch(() => null);
    if (item?.Id && ["Movie", "Episode", "Video"].includes(item.Type)) return [item];
  }
  const movie = type === "movie";
  if (!movie && !["series", "tv"].includes(type)) return [];
  const imdb = /^tt\d+$/.test(String(options.imdbId || ""))
    ? options.imdbId
    : /^tt\d+/.exec(String(videoId || ""))?.[0];
  const tmdb = /^\d+$/.test(String(options.tmdbId || "")) ? options.tmdbId : null;
  const tvdb = /^\d+$/.test(String(options.tvdbId || "")) ? options.tvdbId : null;
  const ids = [imdb && `imdb.${imdb}`, tmdb && `tmdb.${tmdb}`, tvdb && `tvdb.${tvdb}`].filter(
    Boolean
  );
  if (!ids.length) return [];
  const libraries = Array.isArray(server.libraryIds) ? server.libraryIds : [null];
  const title = String(options.title || "").trim();
  const itemType = movie ? "Movie" : "Series";
  const matchedById = (item) => {
    const external = mediaProviderIds(item);
    return (
      (imdb && external.imdbId === String(imdb)) ||
      (tmdb && external.tmdbId === String(tmdb)) ||
      (tvdb && external.tvdbId === String(tvdb))
    );
  };
  const search = (searchTerm) =>
    Promise.allSettled(
      libraries.map((id) =>
        mediaServerItems(
          server,
          {
            IncludeItemTypes: itemType,
            AnyProviderIdEquals: ids.join(","),
            Limit: searchTerm ? "100" : "20",
            ...(searchTerm ? { SearchTerm: searchTerm } : {}),
            ...(id ? { ParentId: id } : {})
          },
          options.signal
        )
      )
    );
  // Stock Jellyfin ignores AnyProviderIdEquals. Narrow by title there, then
  // require an exact provider ID so a different series with the same name cannot match.
  const searchByTitle = server.kind === "jellyfin" && title;
  const matchedItems = (pages) =>
    Array.from(
      new Map(
        pages
          .flatMap((page) => page.value?.Items || [])
          .filter(matchedById)
          .map((item) => [item.Id, item])
      ).values()
    );
  let matches = matchedItems(await search(searchByTitle));
  if (!matches.length && server.kind === "jellyfin" && !options.signal?.aborted) {
    const pages = await Promise.allSettled(
      libraries.map((libraryId) => jellyfinTitleIndex(server, itemType, libraryId))
    );
    if (options.signal?.aborted) return [];
    matches = matchedItems(pages);
  }
  if (movie) return matches;
  const episodeParts = /:(\d+):(\d+)$/.exec(String(videoId || ""));
  const season = Number(options.season ?? episodeParts?.[1]);
  const episode = Number(options.episode ?? episodeParts?.[2]);
  if (!Number.isInteger(season) || season < 0 || !episode) return [];
  const episodes = await Promise.allSettled(
    matches.map((item) =>
      mediaServerItems(
        server,
        {
          ParentId: item.Id,
          IncludeItemTypes: "Episode",
          ParentIndexNumber: String(season),
          IndexNumber: String(episode),
          Filters: "",
          Limit: "1000"
        },
        options.signal
      )
    )
  );
  return episodes
    .flatMap((page) => page.value?.Items || [])
    .filter(
      (item) => Number(item.ParentIndexNumber) === season && Number(item.IndexNumber) === episode
    );
}

export async function requestSeerrMedia(connection, mediaType, mediaId, seasons) {
  const session = await seerrRequest(connection, "/auth/me");
  if (session?.id !== connection.userId)
    throw new Error("Sign in to the connected Seerr account again.");
  return seerrRequest(connection, "/request", {
    body: { mediaType, mediaId, ...(mediaType === "tv" ? { seasons } : {}) }
  });
}
