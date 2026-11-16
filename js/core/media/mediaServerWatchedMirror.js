import {
  MediaConnectionsStore,
  findMediaServerStreams,
  mediaServerItems,
  mediaServerPlayed,
  mediaTitleRef
} from "./mediaConnections.js";

function externalIdentity(item = {}) {
  const raw = String(item.contentId || item.id || "").trim();
  const imdbFromId = /^tt\d+/.exec(raw)?.[0] || null;
  const tmdbFromId = /^tmdb:(\d+)$/i.exec(raw)?.[1] || null;
  return {
    imdbId: String(item.imdbId || imdbFromId || "").trim() || null,
    tmdbId: String(item.tmdbId || tmdbFromId || "").trim() || null,
    title: String(item.title || item.name || "").trim()
  };
}

async function episodeTarget(server, seriesId, season, episode) {
  const page = await mediaServerItems(
    server,
    {
      ParentId: seriesId,
      IncludeItemTypes: "Episode",
      Limit: "1000",
      EnableImages: "false",
      EnableUserData: "false"
    },
    undefined
  ).catch(() => null);
  return (
    (page?.Items || []).find(
      (entry) =>
        Number(entry.ParentIndexNumber) === Number(season) &&
        Number(entry.IndexNumber) === Number(episode)
    ) || null
  );
}

// A title that lives on the server keeps its mark on the server, so the next
// client (or the Jellyfin/Emby app itself) sees the same state. Native server
// ids address the item directly; add-on identities mirror only through servers
// that opted into catalog metadata, matching by IMDb/TMDB like upstream does.
export async function mirrorWatchedToServers(item = {}, played) {
  const servers = MediaConnectionsStore.get().servers.filter(({ enabled }) => enabled !== false);
  if (!servers.length) return { marked: 0, skipped: true };
  const ref = mediaTitleRef(item.contentId) || mediaTitleRef(item.id);
  let marked = 0;
  if (ref) {
    const server = servers.find(({ id }) => id === ref.connectionId);
    if (!server) return { marked: 0, skipped: true };
    const isEpisode = item.episode != null || item.season != null;
    let targetId = ref.itemId;
    if (isEpisode && mediaTitleRef(item.videoId)?.connectionId === server.id) {
      targetId = mediaTitleRef(item.videoId).itemId;
    } else if (isEpisode && item.season != null && item.episode != null) {
      const episode = await episodeTarget(server, ref.itemId, item.season, item.episode);
      targetId = episode?.Id || null;
    }
    if (!targetId) return { marked: 0, skipped: false };
    await mediaServerPlayed(server, targetId, played);
    return { marked: 1, skipped: false };
  }
  const identity = externalIdentity(item);
  if (!identity.imdbId && !identity.tmdbId) return { marked: 0, skipped: true };
  const type = item.episode != null || item.season != null ? "series" : "movie";
  for (const server of servers.filter(({ useCatalogMetadata }) => useCatalogMetadata)) {
    const matches = await findMediaServerStreams(server, type, item.contentId || item.id, {
      imdbId: identity.imdbId,
      tmdbId: identity.tmdbId,
      season: item.season,
      episode: item.episode,
      title: identity.title
    }).catch(() => []);
    for (const match of matches) {
      if (!match?.Id) continue;
      await mediaServerPlayed(server, match.Id, played);
      marked += 1;
    }
  }
  return { marked, skipped: false };
}
