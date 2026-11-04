export const PROBE_METADATA_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const PROBE_METADATA_MAX_ENTRIES = 1000;
const DATABASE = "nuvio-probe-metadata";
const STORE = "files";
let generation = 0;
export const probeMetadataCacheGeneration = () => generation;

// Persist only normalized file facts. Never retain URLs, credentials, device
// predictions, raw ffprobe output, or diagnostics supplied by a caller.
export function storedProbeFacts(value) {
  if (
    !value ||
    !value.videoCodec ||
    value.videoCodec === "unknown" ||
    !value.container ||
    value.container === "unknown"
  )
    return null;
  const facts = {};
  for (const key of [
    "container",
    "videoCodec",
    "videoTag",
    "audioCodec",
    "codecString",
    "videoProfile",
    "pixelFormat",
    "colorTransfer",
    "colorPrimaries"
  ]) {
    if (typeof value[key] === "string") facts[key] = value[key].slice(0, 128);
  }
  for (const key of [
    "audioChannels",
    "videoLevel",
    "bitDepth",
    "frameRate",
    "videoBitrate",
    "width",
    "height",
    "durationSeconds"
  ]) {
    if (typeof value[key] === "number" && Number.isFinite(value[key])) facts[key] = value[key];
  }
  if (typeof value.hasAudio === "boolean") facts.hasAudio = value.hasAudio;
  if (Array.isArray(value.audioStreams))
    facts.audioStreams = value.audioStreams.slice(0, 64).map((track) => {
      const result = {};
      for (const key of ["index", "channels", "sampleRate"])
        if (Number.isFinite(track[key])) result[key] = track[key];
      for (const key of ["codec", "profile", "language"])
        if (typeof track[key] === "string") result[key] = track[key].slice(0, 128);
      if (typeof track.default === "boolean") result.default = track.default;
      return result;
    });
  return facts;
}

export function createProbeMetadataCache({
  indexedDB = globalThis.indexedDB,
  now = Date.now,
  ttlMs = PROBE_METADATA_TTL_MS,
  maxEntries = PROBE_METADATA_MAX_ENTRIES
} = {}) {
  let databasePromise;
  const validKey = (key) => /^torrent-file:[a-f0-9]{40}:\d+$/.test(key);
  function open() {
    if (!indexedDB) return Promise.resolve(null);
    if (!databasePromise)
      databasePromise = new Promise((resolve) => {
        let request;
        try {
          request = indexedDB.open(DATABASE, 1);
        } catch {
          resolve(null);
          return;
        }
        let finished = false;
        const finish = (db) => {
          if (finished) {
            db?.close();
            return;
          }
          finished = true;
          clearTimeout(timer);
          resolve(db);
        };
        const timer = setTimeout(() => finish(null), 200);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE))
            request.result.createObjectStore(STORE, { keyPath: "key" });
        };
        request.onblocked = request.onerror = () => finish(null);
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            databasePromise = null;
          };
          finish(db);
        };
      });
    return databasePromise;
  }
  async function transact(mode, action) {
    try {
      const db = await open();
      if (!db) return null;
      return await new Promise((resolve) => {
        const transaction = db.transaction(STORE, mode);
        let result = null;
        const timer = setTimeout(() => {
          try {
            transaction.abort();
          } catch {
            /* Already complete. */
          }
          resolve(null);
        }, 200);
        transaction.oncomplete = () => {
          clearTimeout(timer);
          resolve(result);
        };
        transaction.onerror = transaction.onabort = () => {
          clearTimeout(timer);
          resolve(null);
        };
        action(transaction.objectStore(STORE), (value) => {
          result = value;
        });
      });
    } catch {
      return null;
    }
  }
  return {
    async get(key) {
      if (!validKey(key)) return null;
      return transact("readonly", (store, done) => {
        store.get(key).onsuccess = (event) => {
          const row = event.target.result;
          if (
            row?.version === 1 &&
            row.createdAt <= now() &&
            row.expiresAt > now() &&
            row.expiresAt - row.createdAt <= ttlMs
          )
            done(storedProbeFacts(row.facts));
        };
      });
    },
    async set(key, value, expectedGeneration = generation) {
      const facts = storedProbeFacts(value);
      if (!validKey(key) || !facts) return;
      await transact("readwrite", (store) => {
        if (expectedGeneration !== generation) return;
        const createdAt = now();
        store.put({ key, facts, version: 1, createdAt, expiresAt: createdAt + ttlMs });
        store.getAll().onsuccess = (event) => {
          const rows = event.target.result;
          const live = [];
          for (const row of rows) {
            if (row.version !== 1 || row.expiresAt <= createdAt) store.delete(row.key);
            else live.push(row);
          }
          live.sort((a, b) => a.createdAt - b.createdAt || a.key.localeCompare(b.key));
          for (const row of live.slice(0, Math.max(0, live.length - maxEntries)))
            store.delete(row.key);
        };
      });
    },
    async clear() {
      generation++;
      return transact("readwrite", (store, done) => {
        store.clear();
        done(true);
      });
    }
  };
}

// Lazy access: importing settings or a server-mode prober must not open a DB.
let shared;
export const probeMetadataCache = {
  get: (...args) => (shared ||= createProbeMetadataCache()).get(...args),
  set: (...args) => (shared ||= createProbeMetadataCache()).set(...args),
  clear: () => (shared ||= createProbeMetadataCache()).clear()
};
