import { MdbListAuthService } from "./mdbListAuthService.js";
import { ProfileManager } from "../../core/profile/profileManager.js";

const WATCHLIST_KEY = "watchlist";
const LIBRARY_TTL_MS = 60_000;

let cache = null;
let inFlight = null;

function activeProfileId() {
  return String(ProfileManager.getActiveProfileId() || "1");
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function imageUrl(value, size) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (normalized.startsWith("/") && !normalized.startsWith("//")) {
    return `https://image.tmdb.org/t/p/${size}${normalized}`;
  }
  return "";
}

function itemSource(row = {}) {
  const movie = row.movie && typeof row.movie === "object" ? row.movie : null;
  const show = row.show && typeof row.show === "object" ? row.show : null;
  const source = movie || show || row;
  const declared = String(
    row.mediatype || row.media_type || row.type || (movie ? "movie" : show ? "show" : "")
  ).toLowerCase();
  const contentType = ["show", "series", "tv", "anime"].includes(declared) ? "series" : "movie";
  return { source, contentType };
}

function canonicalContentId(row = {}, source = {}) {
  const ids = source.ids && typeof source.ids === "object" ? source.ids : row.ids || {};
  const imdb = firstNonEmpty(
    row.imdb_id,
    row.imdbId,
    source.imdb_id,
    source.imdbId,
    ids.imdb,
    ids.imdbid
  );
  const tmdb = numberOrNull(
    row.id ?? row.tmdb_id ?? source.id ?? source.tmdb_id ?? ids.tmdb ?? ids.tmdbid
  );
  const trakt = numberOrNull(row.trakt_id ?? source.trakt_id ?? ids.trakt);
  if (/^tt\d+$/i.test(imdb)) {
    return { contentId: imdb, imdb, tmdb: tmdb > 0 ? tmdb : null, trakt: trakt > 0 ? trakt : null };
  }
  if (tmdb > 0) return { contentId: `tmdb:${tmdb}`, imdb: null, tmdb, trakt: null };
  if (trakt > 0) return { contentId: `trakt:${trakt}`, imdb: null, tmdb: null, trakt };
  const tvdb = numberOrNull(row.tvdb_id ?? source.tvdb_id ?? ids.tvdb ?? ids.tvdbid);
  if (tvdb > 0) return { contentId: `tvdb:${tvdb}`, imdb: null, tmdb: null, trakt: null };
  const mdblist = firstNonEmpty(ids.mdblist);
  if (mdblist) return { contentId: `mdblist:${mdblist}`, imdb: null, tmdb: null, trakt: null };
  return null;
}

function parseDate(value) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseMdbListWatchlist(payload, listKey = WATCHLIST_KEY) {
  const root = payload;
  const rows = Array.isArray(root)
    ? root
    : root && typeof root === "object"
      ? Array.isArray(root.items)
        ? root.items
        : [
            ...(Array.isArray(root.movies) ? root.movies : []),
            ...(Array.isArray(root.shows) ? root.shows : [])
          ]
      : [];
  return rows
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const { source, contentType } = itemSource(row);
      const ids = canonicalContentId(row, source);
      if (!ids) return null;
      const title = firstNonEmpty(source.title, source.name, row.title, row.name, ids.contentId);
      const year = numberOrNull(source.release_year ?? source.year ?? row.release_year ?? row.year);
      const listedAt =
        parseDate(
          row.listed_at ??
            row.added_at ??
            row.watchlist_at ??
            row.last_updated_at ??
            source.listed_at
        ) || Date.now();
      return {
        id: ids.contentId,
        type: contentType,
        contentId: ids.contentId,
        contentType,
        title,
        name: title,
        year,
        releaseInfo: year ? String(year) : "",
        poster: imageUrl(source.poster ?? row.poster, "w500"),
        background: imageUrl(source.backdrop ?? source.background ?? row.backdrop, "w1280"),
        description: firstNonEmpty(
          source.description,
          source.overview,
          row.description,
          row.overview
        ),
        imdbRating: null,
        genres: Array.isArray(row.genres)
          ? row.genres
              .map((genre) =>
                typeof genre === "string" ? genre : firstNonEmpty(genre?.name, genre?.slug)
              )
              .filter(Boolean)
          : [],
        addonBaseUrl: null,
        imdbId: ids.imdb,
        tmdbId: ids.tmdb,
        traktId: ids.trakt,
        source: "mdblist_library",
        listedAt,
        updatedAt: listedAt,
        listKeys: [listKey],
        listMeta: { [listKey]: { listedAt, traktRank: null } }
      };
    })
    .filter(Boolean);
}

export function parseMdbListUserLists(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray(payload.lists)
      ? payload.lists
      : [];
  return rows
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const id = numberOrNull(row.id ?? row.list_id);
      if (!(id > 0)) return null;
      const type = String(row.type || "static").toLowerCase();
      if (type && type !== "static") return null;
      const title = firstNonEmpty(row.name, row.title, `List ${id}`);
      return {
        key: `list:${id}`,
        listId: id,
        title,
        type: "personal",
        description: firstNonEmpty(row.description),
        privacy: row.private === true ? "private" : "public",
        sortBy: firstNonEmpty(row.sort_by, "ranked") || null,
        sortHow: firstNonEmpty(row.sort_how, "asc") || null,
        updatedAt: parseDate(row.updated_at ?? row.last_updated_at ?? row.created_at)
      };
    })
    .filter(Boolean);
}

function membershipBody(item = {}, { watchlist = true } = {}) {
  const contentId = String(item.itemId || item.id || item.contentId || "").trim();
  const imdb = firstNonEmpty(
    item.imdbId,
    item.imdb_id,
    /^tt\d+$/i.test(contentId) ? contentId : ""
  );
  const tmdb = numberOrNull(
    item.tmdbId ?? item.tmdb_id ?? (contentId.match(/^tmdb:(\d+)$/i)?.[1] || null)
  );
  const trakt = numberOrNull(
    item.traktId ?? item.trakt_id ?? (contentId.match(/^trakt:(\d+)$/i)?.[1] || null)
  );
  const ids = {
    ...(imdb ? { imdb } : {}),
    ...(tmdb > 0 ? { tmdb } : {}),
    ...(trakt > 0 ? { trakt } : {})
  };
  if (!Object.keys(ids).length) return null;
  const isSeries = ["series", "show", "tv"].includes(
    String(item.itemType || item.type || "movie").toLowerCase()
  );
  return {
    [isSeries ? "shows" : "movies"]: [watchlist ? { ids } : ids]
  };
}

function normalizeMembership(changes = {}) {
  return changes && typeof changes === "object" ? changes : {};
}

function listQuery() {
  return {
    limit: 1000,
    unified: "true",
    append_to_response: "poster,description,genres"
  };
}

async function fetchWatchlist() {
  const { response, payload } = await MdbListAuthService.apiRequest("/watchlist/items", {
    query: listQuery()
  });
  if (!response.ok) {
    console.warn("[LIB] MDBList watchlist fetch failed", response.status);
    return [];
  }
  return parseMdbListWatchlist(payload);
}

async function fetchUserLists() {
  const { response, payload } = await MdbListAuthService.apiRequest("/lists/user", {
    query: { unified: "false", sort: "ranked" }
  });
  if (!response.ok) {
    console.warn("[LIB] MDBList lists fetch failed", response.status);
    return [];
  }
  return parseMdbListUserLists(payload);
}

async function fetchListItems(list) {
  const { response, payload } = await MdbListAuthService.apiRequest(`/lists/${list.listId}/items`, {
    query: listQuery()
  });
  if (!response.ok) {
    console.warn("[LIB] MDBList list items fetch failed", response.status);
    return [];
  }
  return parseMdbListWatchlist(payload, list.key);
}

function mergeLibraryItems(entries) {
  const merged = new Map();
  entries.forEach((entry) => {
    const key = `${entry.type}:${entry.contentId}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, entry);
      return;
    }
    entry.listKeys.forEach((listKey) => {
      if (!existing.listKeys.includes(listKey)) existing.listKeys.push(listKey);
      existing.listMeta[listKey] = entry.listMeta[listKey];
    });
    existing.listedAt = Math.max(Number(existing.listedAt || 0), Number(entry.listedAt || 0));
  });
  return [...merged.values()];
}

async function fetchLibrary() {
  const lists = await fetchUserLists();
  const [watchlistItems, ...listItems] = await Promise.all([
    fetchWatchlist(),
    ...lists.map((list) => fetchListItems(list))
  ]);
  const tabs = [
    {
      key: WATCHLIST_KEY,
      title: "Watchlist",
      type: "watchlist",
      traktListId: null,
      slug: null,
      description: null,
      privacy: null,
      sortBy: null,
      sortHow: null
    },
    ...lists.map((list) => ({
      key: list.key,
      title: list.title,
      type: "personal",
      traktListId: null,
      slug: null,
      description: list.description,
      privacy: list.privacy,
      sortBy: list.sortBy,
      sortHow: list.sortHow
    }))
  ];
  return {
    tabs,
    items: mergeLibraryItems([...watchlistItems, ...listItems.flat()])
  };
}

async function ensureLibrary({ maxAgeMs = LIBRARY_TTL_MS } = {}) {
  if (!MdbListAuthService.isAuthenticated()) {
    return { items: [], tabs: [] };
  }
  if (
    cache &&
    cache.profileId === activeProfileId() &&
    Date.now() - Number(cache.fetchedAt || 0) < maxAgeMs
  ) {
    return cache;
  }
  if (inFlight) return inFlight;
  inFlight = fetchLibrary()
    .then((library) => {
      cache = {
        profileId: activeProfileId(),
        fetchedAt: Date.now(),
        items: library.items,
        tabs: library.tabs
      };
      return cache;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

function itemMatches(entry, item) {
  const contentId = String(item.itemId || item.id || item.contentId || "").trim();
  const imdb = firstNonEmpty(item.imdbId, item.imdb_id);
  const tmdb = numberOrNull(item.tmdbId ?? item.tmdb_id);
  const trakt = numberOrNull(item.traktId ?? item.trakt_id);
  if (entry.contentId === contentId) return true;
  if (imdb && entry.imdbId === imdb) return true;
  if (tmdb > 0 && Number(entry.tmdbId) === tmdb) return true;
  if (trakt > 0 && Number(entry.traktId) === trakt) return true;
  return false;
}

export const MdbListLibraryService = {
  async getItems({ maxAgeMs = LIBRARY_TTL_MS } = {}) {
    return (await ensureLibrary({ maxAgeMs })).items || [];
  },

  async getListTabs({ maxAgeMs = LIBRARY_TTL_MS } = {}) {
    return (await ensureLibrary({ maxAgeMs })).tabs || [];
  },

  async refresh() {
    cache = null;
    return this.getItems({ maxAgeMs: 0 });
  },

  clearCache() {
    cache = null;
  },

  async getMembershipSnapshot(item = {}) {
    const [{ items }, tabs] = await Promise.all([ensureLibrary(), this.getListTabs()]);
    const matched = items.find((entry) => itemMatches(entry, item));
    return {
      listMembership: Object.fromEntries(
        tabs.map((tab) => [tab.key, Boolean(matched?.listKeys?.includes(tab.key))])
      )
    };
  },

  async applyMembershipChanges(item = {}, changes = {}) {
    const desired = normalizeMembership(changes).desiredMembership || {};
    const keys = Object.keys(desired);
    if (!keys.length) return;
    for (const key of keys) {
      const adding = Boolean(desired[key]);
      const listId = key.startsWith("list:") ? Number(key.slice(5)) : null;
      if (key !== WATCHLIST_KEY && !(listId > 0)) continue;
      const body = membershipBody(item, { watchlist: key === WATCHLIST_KEY });
      if (!body) throw new Error("An external movie or show ID is required");
      const path =
        key === WATCHLIST_KEY
          ? `/watchlist/items/${adding ? "add" : "remove"}`
          : `/lists/${listId}/items/${adding ? "add" : "remove"}`;
      const { response } = await MdbListAuthService.apiRequest(path, {
        method: "POST",
        body
      });
      if (!response.ok) {
        throw new Error(
          `Could not ${adding ? "add" : "remove"} MDBList ${key === WATCHLIST_KEY ? "watchlist" : "list"} item`
        );
      }
    }
    cache = null;
  },

  parseWatchlist: parseMdbListWatchlist,
  parseUserLists: parseMdbListUserLists
};
