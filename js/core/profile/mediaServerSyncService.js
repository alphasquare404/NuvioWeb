import { AuthManager } from "../auth/authManager.js";
import { SUPABASE_URL } from "../../config.js";
import {
  MediaConnectionsStore,
  mediaServerAddress,
  mediaServerApiUrl,
  readMediaServerSyncDetails
} from "../media/mediaConnections.js";
import { LocalStore } from "../storage/localStore.js";
import { registerPrivateMediaOrigin } from "../streams/privateMediaSource.js";
import { getSyncClientId } from "../sync/syncClientIdentity.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { ProfileManager } from "./profileManager.js";

const STATE_KEY = "mediaServerSyncState";
const running = new Map();
const supported = (kind) => kind === "jellyfin" || kind === "emby";
const keyFor = ({ kind, remoteServerId, userId }) => JSON.stringify([kind, remoteServerId, userId]);
const addressKeyFor = ({ kind, url, userId }) => JSON.stringify([kind, url, userId]);
const matches = (left, right) =>
  left.kind === right.kind &&
  left.userId === right.userId &&
  (left.remoteServerId && right.remoteServerId
    ? left.remoteServerId === right.remoteServerId
    : left.url === right.url);

export function decodeMediaServer(row, localServers = []) {
  const kind = row?.provider_id;
  if (!supported(kind) || !row.remote_server_id || !row.remote_user_id || !row.token || !row.id) {
    throw new Error("Invalid media server sync record");
  }
  const server = {
    id: `media:${kind}:${row.id}`,
    syncId: row.id,
    kind,
    name: row.name || (kind === "emby" ? "Emby" : "Jellyfin"),
    url: mediaServerApiUrl(kind, mediaServerAddress(kind, row.address)),
    userId: row.remote_user_id,
    userName: row.user_name,
    remoteServerId: row.remote_server_id,
    token: row.token,
    enabled: row.enabled !== false,
    useCatalogMetadata: row.use_catalog_metadata === true,
    importWatchState: row.import_watch_state,
    libraries: row.libraries || []
  };
  registerPrivateMediaOrigin(server.url);
  const local = localServers.find((entry) => matches(entry, server));
  return {
    ...server,
    id: local?.id || server.id,
    importWatchState: server.importWatchState ?? local?.importWatchState,
    libraryIds: server.libraries.length
      ? server.libraries.filter(({ selected }) => selected).map(({ id }) => id)
      : local?.libraryIds
  };
}

export function encodeMediaServer(server) {
  return {
    id: server.syncId,
    provider_id: server.kind,
    name: server.name || "",
    address: mediaServerAddress(server.kind, server.url),
    remote_server_id: server.remoteServerId,
    remote_user_id: server.userId,
    user_name: server.userName,
    token: server.token,
    libraries: (server.libraries || []).map(({ id, name, kind, selected }) => ({
      id,
      name,
      kind,
      selected: Array.isArray(server.libraryIds)
        ? server.libraryIds.includes(id)
        : selected !== false
    })),
    enabled: server.enabled !== false,
    use_catalog_metadata: server.useCatalogMetadata === true,
    ...(typeof server.importWatchState === "boolean"
      ? { import_watch_state: server.importWatchState }
      : {})
  };
}

export function mergeMediaServers(local, remote, state = {}) {
  const changed = new Set(state.changed || []);
  const removed = new Set(state.removed || []);
  const known = new Set(state.known || []);
  const merged = remote.flatMap((server) => {
    const key = keyFor(server);
    if (removed.has(key) || removed.has(addressKeyFor(server))) return [];
    const previous = local.find((entry) => matches(entry, server));
    if (!previous || !changed.has(previous.id)) return [server];
    return [
      {
        ...server,
        ...previous,
        syncId: server.syncId,
        remoteServerId: previous.remoteServerId || server.remoteServerId,
        userName: previous.userName || server.userName
      }
    ];
  });
  for (const server of local) {
    if (remote.some((entry) => matches(entry, server))) continue;
    if (changed.has(server.id) || !known.has(keyFor(server))) merged.push(server);
  }
  return merged;
}

function stateFor(profileId) {
  return LocalStore.get(STATE_KEY, {})?.[profileId] || {};
}

function saveState(profileId, state) {
  LocalStore.set(STATE_KEY, { ...LocalStore.get(STATE_KEY, {}), [profileId]: state });
}

MediaConnectionsStore.subscribe(({ profileId, previousValue, value, syncSource }) => {
  if (syncSource === "media-server-cloud" || !value) return;
  const previous = previousValue.servers;
  const current = value.servers;
  const changes = current.filter((server) => {
    const old = previous.find(({ id }) => id === server.id);
    return JSON.stringify(old) !== JSON.stringify(server);
  });
  const removals = previous.filter((server) => !current.some(({ id }) => id === server.id));
  if (!changes.length && !removals.length) return;
  const state = stateFor(profileId);
  const removed = new Set(state.removed || []);
  removals.forEach((server) => {
    removed.add(addressKeyFor(server));
    if (server.remoteServerId) removed.add(keyFor(server));
  });
  changes.forEach((server) => {
    removed.delete(addressKeyFor(server));
    removed.delete(keyFor(server));
  });
  const changed = new Set(state.changed || []);
  removals.forEach(({ id }) => changed.delete(id));
  changes.forEach(({ id }) => changed.add(id));
  saveState(profileId, { ...state, changed: [...changed], removed: [...removed] });
  void MediaServerSyncService.sync(profileId);
});

async function synchronize(profileId, isCurrent) {
  const local = MediaConnectionsStore.getForProfile(profileId).servers;
  const state = stateFor(profileId);
  const unchanged = () =>
    isCurrent() &&
    JSON.stringify(stateFor(profileId)) === JSON.stringify(state) &&
    JSON.stringify(MediaConnectionsStore.getForProfile(profileId).servers) ===
      JSON.stringify(local);
  const rows = await SupabaseApi.rpc("sync_pull_media_servers", { p_profile_id: profileId }, true);
  if (!Array.isArray(rows) || (rows.length && !Array.isArray(rows[0]?.servers_json))) {
    throw new Error("Invalid media server sync response");
  }
  if (!unchanged()) return false;
  const remote = (rows[0]?.servers_json || []).map((row) => decodeMediaServer(row, local));
  const merged = mergeMediaServers(local, remote, state);
  const exported = await Promise.all(
    merged.map(async (server) => {
      if (server.syncId && !(state.changed || []).includes(server.id)) return server;
      const detailed = await readMediaServerSyncDetails(server);
      const syncId =
        detailed.syncId ||
        Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (byte) =>
          byte.toString(16).padStart(2, "0")
        ).join("");
      return { ...detailed, syncId };
    })
  );
  if (!unchanged()) return false;
  const ready = exported.filter(
    ({ remoteServerId, userName, libraries, libraryIds }) =>
      remoteServerId && userName && (!Array.isArray(libraryIds) || Array.isArray(libraries))
  );
  // A legacy connection may use another address for the same server. Match the
  // stable IDs after enrichment and keep the local ID used by saved items.
  const remoteByKey = new Map(remote.map((server) => [keyFor(server), server]));
  const unique = [
    ...new Map(
      ready.map((server) => {
        const key = keyFor(server);
        const cloud = remoteByKey.get(key);
        return [key, { ...server, syncId: cloud?.syncId || server.syncId }];
      })
    ).values()
  ];
  const payload = unique.map(encodeMediaServer);
  if (JSON.stringify(payload) !== JSON.stringify(remote.map(encodeMediaServer))) {
    await SupabaseApi.rpc(
      "sync_push_media_servers",
      { p_profile_id: profileId, p_servers: payload, p_origin_client_id: getSyncClientId() },
      true
    );
    if (!unchanged()) return false;
  }
  const waiting = exported.filter((server) => !ready.includes(server));
  const servers = [...payload.map((row) => decodeMediaServer(row, unique)), ...waiting];
  saveState(profileId, { known: unique.map(keyFor), changed: waiting.map(({ id }) => id) });
  if (JSON.stringify(servers) === JSON.stringify(local)) return false;
  MediaConnectionsStore.setForProfile(
    profileId,
    { servers },
    { silentSync: true, syncSource: "media-server-cloud" }
  );
  return true;
}

export const MediaServerSyncService = {
  sync(profileId = ProfileManager.getActiveProfileId()) {
    const id = Number(profileId);
    const generation = AuthManager.getSessionGeneration();
    const isCurrent = () =>
      AuthManager.isAuthenticated &&
      AuthManager.isSessionCurrent(generation) &&
      Number(ProfileManager.getActiveProfileId()) === id;
    if (!/^https?:\/\//i.test(SUPABASE_URL) || !Number.isInteger(id) || id < 1 || !isCurrent()) {
      return Promise.resolve(false);
    }
    const key = `${generation}:${id}`;
    const task = (running.get(key) || Promise.resolve())
      .then(() => (isCurrent() ? synchronize(id, isCurrent) : false))
      .catch((error) => {
        console.warn("Media server sync failed", { status: error?.status || 0 });
        return false;
      })
      .finally(() => {
        if (running.get(key) === task) running.delete(key);
      });
    running.set(key, task);
    return task;
  }
};
