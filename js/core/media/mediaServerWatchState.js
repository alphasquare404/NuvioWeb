import { WatchProgressStore } from "../../data/local/watchProgressStore.js";
import { WatchedItemsStore } from "../../data/local/watchedItemsStore.js";
import { ProfileManager } from "../profile/profileManager.js";
import { mediaTitleId } from "./mediaConnections.js";

function activeProfileId() {
  return String(ProfileManager.getActiveProfileId() || "1");
}

export function serverUserState(item) {
  const user = item?.UserData || {};
  const positionMs = Number(user.PlaybackPositionTicks) / 10000;
  const durationMs = Number(item?.RunTimeTicks) / 10000;
  const lastPlayed = Date.parse(user.LastPlayedDate || "");
  return {
    played: user.Played === true,
    positionMs: Number.isFinite(positionMs) && positionMs > 0 ? positionMs : 0,
    durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0,
    updatedAt: Number.isFinite(lastPlayed) ? lastPlayed : null
  };
}

export function newerServerResume(state, saved, startFromBeginning = false) {
  if (
    startFromBeginning ||
    !state ||
    state.played ||
    !(state.positionMs > 0) ||
    !(state.durationMs > 0) ||
    !(state.updatedAt > 0)
  ) {
    return null;
  }
  if (saved && Number(saved.updatedAt || 0) >= state.updatedAt) return null;
  return state;
}

// The server knows what its own user watched, including playback that happened
// in the Jellyfin/Emby app. Titles keep the server's identity, so importing the
// state means writing the same local rows a playback here would have written.
export function projectServerWatchState({ server, meta, items = [] } = {}) {
  if (!server?.importWatchState) return 0;
  const metaId = String(meta?.id || "");
  if (!metaId.startsWith("server:")) return 0;
  const series = meta.type === "series";
  const profileId = activeProfileId();
  const progress = WatchProgressStore.listForProfile(profileId);
  const watched = WatchedItemsStore.listForProfile(profileId);
  let applied = 0;
  for (const item of items) {
    if (!item?.Id) continue;
    const season = series ? Number(item.ParentIndexNumber) : null;
    const episode = series ? Number(item.IndexNumber) : null;
    if (series && (!Number.isInteger(season) || !Number.isInteger(episode))) continue;
    const state = serverUserState(item);
    const matches = (entry) =>
      String(entry?.contentId || "") === metaId &&
      (series ? Number(entry.season) === season && Number(entry.episode) === episode : true);
    const existing = progress.find(matches);
    const resume = newerServerResume(state, existing);
    if (resume) {
      WatchProgressStore.upsert(
        {
          contentId: metaId,
          contentType: meta.type || "movie",
          videoId: series ? mediaTitleId(server, item.Id) : metaId,
          season,
          episode,
          title: meta.name || null,
          poster: meta.poster || null,
          background: meta.background || null,
          logo: meta.logo || null,
          episodeTitle: series ? item.Name || null : null,
          positionMs: Math.round(resume.positionMs),
          durationMs: Math.round(resume.durationMs),
          updatedAt: resume.updatedAt,
          source: "media_server"
        },
        profileId,
        { authoritative: true }
      );
      applied += 1;
    }
    const locallyWatched = watched.some(matches);
    if (state.played && !locallyWatched) {
      WatchedItemsStore.upsert(
        {
          contentId: metaId,
          contentType: meta.type || "movie",
          title: meta.name || null,
          videoId: series ? mediaTitleId(server, item.Id) : metaId,
          season,
          episode,
          watchedAt: state.updatedAt || Date.now(),
          source: "media_server"
        },
        profileId,
        { authoritative: true }
      );
      applied += 1;
    } else if (!state.played && locallyWatched && item.UserData) {
      WatchedItemsStore.remove(
        metaId,
        profileId,
        series ? { season, episode } : { rootOnly: true }
      );
      applied += 1;
    }
  }
  return applied;
}
