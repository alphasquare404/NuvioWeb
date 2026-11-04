import { mergeRanges, includesTime } from "./mediaFragments.mjs";
export const MAX_CACHE_BYTES = 512 * 1024 * 1024,
  MIN_CACHE_BYTES = 128 * 1024 * 1024,
  MAX_INDEX_BYTES = 1024 * 1024,
  MAX_UNITS = 4096;
export function cacheBudget(estimate) {
  const { quota, usage } = estimate || {};
  if (!Number.isFinite(quota) || !Number.isFinite(usage) || usage < 0 || quota <= usage) return 0;
  const bytes = Math.min(MAX_CACHE_BYTES, Math.floor((quota - usage) / 4));
  return bytes >= MIN_CACHE_BYTES ? bytes : 0;
}
export class CacheIndex {
  constructor(limit = MAX_CACHE_BYTES) {
    this.limit = limit;
    this.entries = new Map();
    this.pending = new Map();
    this.clock = 0;
    this.evictions = 0;
  }
  get bytes() {
    return [...this.entries.values()].reduce((n, e) => n + e.bytes, 0);
  }
  get reserved() {
    return [...this.pending.values()].reduce((n, e) => n + e.bytes, 0);
  }
  get metadataBytes() {
    return [...this.entries.values(), ...this.pending.values()].reduce(
      (n, e) => n + e.metadataBytes,
      0
    );
  }
  descriptor(value) {
    if (
      !/^[a-z0-9-]{1,80}$/.test(value.id) ||
      !/^[a-z0-9-]{1,80}$/.test(value.runId) ||
      !["init", "media"].includes(value.kind) ||
      !Number.isSafeInteger(value.bytes) ||
      value.bytes <= 0 ||
      value.bytes > (value.kind === "init" ? 1024 * 1024 : 32 * 1024 * 1024)
    )
      throw Error("cache-entry-invalid");
    if (value.kind === "media") {
      const t = value.timing;
      if (
        !Number.isSafeInteger(value.seq) ||
        value.seq < 0 ||
        !t ||
        !Array.isArray(t.randomAccessPoints) ||
        t.randomAccessPoints.length > 4096 ||
        t.randomAccessPoints.some((x) => !Number.isFinite(x) || x < 0) ||
        !Number.isFinite(t.reorderGuardSeconds) ||
        t.reorderGuardSeconds < 0 ||
        t.reorderGuardSeconds > 30
      )
        throw Error("cache-entry-invalid");
      for (const key of ["video", "audio"])
        if (!Array.isArray(t[key]) || t[key].length > 64) throw Error("cache-entry-invalid");
        else mergeRanges(t[key]);
    }
    const e = { id: value.id, runId: value.runId, kind: value.kind, bytes: value.bytes };
    if (value.kind === "media") {
      e.seq = value.seq;
      e.timing = {
        video: mergeRanges(value.timing.video),
        audio: mergeRanges(value.timing.audio),
        randomAccessPoints: [...value.timing.randomAccessPoints],
        reorderGuardSeconds: value.timing.reorderGuardSeconds
      };
    } else if (value.info)
      e.info = Object.fromEntries(
        [
          "audioIndex",
          "audioTracks",
          "duration",
          "start",
          "requested",
          "mime",
          "video",
          "audio",
          "channels",
          "firstAudioTimestamp"
        ]
          .filter((key) => value.info[key] !== undefined)
          .map((key) => [key, value.info[key]])
      );
    e.pins = 0;
    e.used = ++this.clock;
    e.metadataBytes = new TextEncoder().encode(JSON.stringify(e)).length + 64;
    return e;
  }
  victim() {
    return (
      [...this.entries.values()]
        .filter((e) => !e.pins && e.kind === "media")
        .sort((a, b) => a.used - b.used)[0] ||
      [...this.entries.values()].find(
        (e) =>
          e.kind === "init" &&
          !e.pins &&
          ![...this.entries.values()].some((m) => m.kind === "media" && m.runId === e.runId)
      )
    );
  }
  fits(e) {
    return (
      this.bytes + this.reserved + e.bytes <= this.limit &&
      this.metadataBytes + e.metadataBytes <= MAX_INDEX_BYTES &&
      this.entries.size + this.pending.size < MAX_UNITS
    );
  }
  reserve(e) {
    if (this.entries.has(e.id) || this.pending.has(e.id) || !this.fits(e)) return false;
    this.pending.set(e.id, e);
    return true;
  }
  commit(id) {
    const e = this.pending.get(id);
    if (!e) throw Error("cache-reservation-missing");
    this.pending.delete(id);
    this.entries.set(id, e);
    return e;
  }
  pin(id) {
    const e = this.entries.get(id);
    if (!e || e.deleting) return false;
    e.pins++;
    e.used = ++this.clock;
    return true;
  }
  unpin(id) {
    const e = this.entries.get(id);
    if (e) e.pins = Math.max(0, e.pins - 1);
  }
  remove(id) {
    const e = this.entries.get(id);
    if (e?.pins) throw Error("cache-entry-pinned");
    this.entries.delete(id);
    this.pending.delete(id);
  }
  lookup(time) {
    const runs = [
      ...new Set([...this.entries.values()].filter((e) => e.kind === "media").map((e) => e.runId))
    ];
    for (const runId of runs.reverse()) {
      const init = [...this.entries.values()].find(
        (e) => e.kind === "init" && e.runId === runId && !e.deleting
      );
      if (!init) continue;
      const units = [...this.entries.values()]
        .filter((e) => e.kind === "media" && e.runId === runId && !e.deleting)
        .sort((a, b) => a.seq - b.seq);
      for (let at = units.length - 1; at >= 0; at--) {
        const first = units[at],
          rap = first.timing.randomAccessPoints[0];
        if (rap === undefined || rap > time + (time === 0 ? 0.05 : 0.0001)) continue;
        const chain = [first];
        for (let j = at + 1; j < units.length && units[j].seq === chain.at(-1).seq + 1; j++)
          chain.push(units[j]);
        const video = mergeRanges(chain.flatMap((e) => e.timing.video)),
          audio = mergeRanges(chain.flatMap((e) => e.timing.audio));
        const query = time === 0 ? Math.max(video[0]?.[0] || 0, audio[0]?.[0] || 0) : time;
        if (
          (time === 0 && query > 0.05) ||
          !includesTime(video, query) ||
          !includesTime(audio, query)
        )
          continue;
        const end = Math.min(
          video.find(([a, b]) => query >= a - 0.0001 && query < b - 0.0001)[1],
          audio.find(([a, b]) => query >= a - 0.0001 && query < b - 0.0001)[1]
        );
        const playable = chain.filter((e) =>
          [...e.timing.video, ...e.timing.audio].some(([start]) => start < end + 0.0001)
        );
        init.used = ++this.clock;
        playable.forEach((e) => (e.used = this.clock));
        return { runId, init, units: playable, end };
      }
    }
    return null;
  }
}
