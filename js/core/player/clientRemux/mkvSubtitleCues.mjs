// Optional Matroska subtitle index. No video-index lookback guesses.
export const CUE_LIMITS = Object.freeze({
  cueRecords: 16384,
  cueIndexBytes: 4 * 1024 ** 2,
  cueElements: 200000,
  cueResolvedEntries: 512,
  seekHeads: 4
});
const C = {
  seekHead: 0x114d9b74,
  seek: 0x4dbb,
  id: 0x53ab,
  position: 0x53ac,
  cues: 0x1c53bb6b,
  point: 0xbb,
  time: 0xb3,
  positions: 0xb7,
  track: 0xf7,
  cluster: 0xf1,
  relative: 0xf0,
  duration: 0xb2,
  codecState: 0xea
};
const FIELDS = 6,
  invalid = () => {
    throw Error("subtitle-cues-invalid");
  };
export class MkvSubtitleCues {
  constructor(reader) {
    this.reader = reader;
    this.heads = [];
    this.position = null;
    this.loaded = false;
    this.trackId = null;
    this.data = null;
    this.storage = null;
    this.records = 0;
    this.reasons = new Map();
    this.resolved = new Map();
    this.reason = null;
  }
  absolute(relative) {
    const at = this.reader.segmentStart + relative;
    if (!Number.isSafeInteger(at) || at < this.reader.segmentStart || at >= this.reader.end)
      invalid();
    return at;
  }
  async head(parent, signal) {
    const r = this.reader;
    for (let at = parent.start; at < parent.end;) {
      const e = await r.header(at, parent.end, signal);
      at = e.end;
      if (e.id !== C.seek) continue;
      let id = null,
        pos = null;
      for (let p = e.start; p < e.end;) {
        const c = await r.header(p, e.end, signal);
        p = c.end;
        if (c.id === C.id) id = await r.uint(c, signal);
        else if (c.id === C.position) pos = await r.uint(c, signal);
      }
      if (pos === null) continue;
      if (id === C.cues) this.locate(this.absolute(pos));
      else if (id === C.seekHead) {
        if (this.heads.length >= CUE_LIMITS.seekHeads) throw Error("subtitle-seekhead-budget");
        this.heads.push(this.absolute(pos));
      }
    }
  }
  locate(at) {
    if (this.position !== null && this.position !== at) invalid();
    this.position = at;
  }
  async load(signal, trackId) {
    signal?.throwIfAborted();
    const track = this.reader.tracks.find((t) => t.id === trackId && t.supported);
    if (!track) throw Error("subtitle-track-unsupported");
    if (this.loaded && this.trackId === trackId) return;
    // Exactly one catalog allocation. Reuse its storage across language changes;
    // unpublished/aborted contents cannot be mistaken for a complete catalog.
    this.loaded = false;
    this.trackId = trackId;
    this.data = null;
    this.records = 0;
    this.reasons.clear();
    this.resolved.clear();
    this.reason = null;
    const r = this.reader,
      priorElements = r.elements,
      priorLimit = r.elementLimit,
      started = r.stats.bytes || 0,
      headsBefore = [...this.heads],
      positionBefore = this.position;
    let attempts = 0;
    const visited = new Set();
    r.stats.subtitleCueSkippedPositions = 0;
    r.elements = 0;
    r.elementLimit = CUE_LIMITS.cueElements;
    try {
      while (this.position === null && this.heads.length) {
        const at = this.heads.shift();
        if (visited.has(at)) continue;
        visited.add(at);
        if (++attempts > CUE_LIMITS.seekHeads) throw Error("subtitle-seekhead-budget");
        const h = await r.header(at, r.end, signal);
        if (h.id !== C.seekHead || h.unknown) invalid();
        await this.head(h, signal);
      }
      if (this.position === null) {
        this.reason = "subtitle-cues-missing";
        this.loaded = true;
        return;
      }
      const parent = await r.header(this.position, r.end, signal);
      if (parent.id !== C.cues || parent.unknown) invalid();
      if (parent.end - parent.at > CUE_LIMITS.cueIndexBytes)
        throw Error("subtitle-cues-byte-budget");
      const data = (this.storage ??= new Float64Array(CUE_LIMITS.cueRecords * FIELDS));
      let records = 0,
        skipped = 0;
      const reasons = new Map();
      for (let at = parent.start; at < parent.end;) {
        const e = await r.header(at, parent.end, signal);
        at = e.end;
        if (e.unknown) invalid();
        if (e.id !== C.point) continue;
        let time = null,
          positionCount = 0;
        const positions = [];
        for (let p = e.start; p < e.end;) {
          const c = await r.header(p, e.end, signal);
          p = c.end;
          if (c.unknown) invalid();
          if (c.id === C.time) {
            if (time !== null) invalid();
            time = await r.uint(c, signal);
          } else if (c.id === C.positions) {
            if (++positionCount > 128) throw Error("subtitle-cues-point-budget");
            const pos = await this.trackPosition(c, signal, trackId);
            if (pos) positions.push(pos);
            else skipped++;
          }
        }
        if (time === null) invalid();
        for (const pos of positions) {
          if (pos.cluster === undefined) invalid();
          if (!(pos.duration > 0) || pos.relative === undefined || pos.codecState) {
            reasons.set(
              pos.track,
              !(pos.duration > 0)
                ? "subtitle-cue-duration-missing"
                : pos.relative === undefined
                  ? "subtitle-cue-position-missing"
                  : "subtitle-cue-codec-state"
            );
            continue;
          }
          if (records >= CUE_LIMITS.cueRecords) throw Error("subtitle-cues-record-budget");
          const start = time * r.scale - track.delay,
            end = start + pos.duration * r.scale;
          if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) invalid();
          data.set(
            [pos.track, start, end, this.absolute(pos.cluster), pos.relative, time],
            records++ * FIELDS
          );
        }
      }
      signal?.throwIfAborted();
      this.data = records ? data : null;
      if (!records) this.storage = null;
      this.reason = records ? null : "subtitle-track-cues-missing";
      this.records = records;
      this.reasons = reasons;
      this.loaded = true;
      r.stats.subtitleCueSkippedPositions = skipped;
    } catch (error) {
      // Optional malformed/oversized catalog falls back to the proven scanner.
      // Transport and abort failures retain their meaning; never hide them.
      if (error.name === "AbortError" || !/^subtitle-/.test(error.message)) {
        this.heads = headsBefore;
        this.position = positionBefore;
        throw error;
      }
      this.reason = error.message;
      this.data = null;
      this.storage = null;
      this.records = 0;
      this.loaded = true;
    } finally {
      r.stats.subtitleCueIndexReadBytes = (r.stats.bytes || 0) - started;
      r.stats.subtitleCueIndexElements = r.elements;
      r.elements = priorElements;
      r.elementLimit = priorLimit;
    }
  }
  async trackPosition(parent, signal, trackId) {
    const r = this.reader,
      pos = {},
      pending = new Map(),
      fields = new Map([
        [C.cluster, "cluster"],
        [C.relative, "relative"],
        [C.duration, "duration"],
        [C.codecState, "codecState"]
      ]);
    for (let at = parent.start; at < parent.end;) {
      const e = await r.header(at, parent.end, signal);
      at = e.end;
      if (e.unknown) invalid();
      if (e.id === C.track) {
        if (pos.track !== undefined) invalid();
        pos.track = await r.uint(e, signal);
        if (!pos.track) invalid();
        if (pos.track !== trackId) return null;
      } else {
        const key = fields.get(e.id);
        if (key) {
          if (pending.has(key)) invalid();
          pending.set(key, e);
        }
      }
    }
    if (!pos.track || !pending.has("cluster")) invalid();
    // Track may appear after the other fields. Decode those fields only after
    // selection is known; EBML field ordering is not assumed.
    for (const [key, e] of pending) pos[key] = await r.uint(e, signal);
    return pos;
  }
  availability(track) {
    if (track !== this.trackId) return "subtitle-track-cues-not-loaded";
    if (this.reasons.has(track)) return this.reasons.get(track);
    if (!this.data) return this.reason || "subtitle-cues-missing";
    return this.records ? null : "subtitle-track-cues-missing";
  }
  candidates(track, from, to) {
    const selected = [];
    for (let i = 0; i < this.records; i++) {
      const n = i * FIELDS;
      if (this.data[n] === track && this.data[n + 2] > from && this.data[n + 1] < to) {
        if (selected.length >= 512) throw Error("subtitle-window-budget");
        selected.push(i);
      }
    }
    return selected;
  }
  async resolve(index, track, signal) {
    signal?.throwIfAborted();
    if (this.resolved.has(index)) {
      const value = this.resolved.get(index);
      this.resolved.delete(index);
      this.resolved.set(index, value);
      return value;
    }
    const r = this.reader,
      n = index * FIELDS,
      [, expectedStart, expectedEnd, clusterAt, relative] = this.data.subarray(n, n + FIELDS),
      cluster = await r.header(clusterAt, r.end, signal);
    if (cluster.id !== 0x1f43b675 || cluster.unknown) invalid();
    let timestamp = null;
    for (let at = cluster.start; at < cluster.end;) {
      const e = await r.header(at, cluster.end, signal);
      at = e.end;
      if (e.id === 0xe7) {
        timestamp = await r.uint(e, signal);
        break;
      }
      if (e.id === 0xa3 || e.id === 0xa0 || e.unknown) invalid();
    }
    if (
      timestamp === null ||
      !Number.isSafeInteger(cluster.start + relative) ||
      cluster.start + relative >= cluster.end
    )
      invalid();
    const e = await r.header(cluster.start + relative, cluster.end, signal);
    if (e.id !== 0xa0 && e.id !== 0xa3) invalid();
    if (e.unknown) invalid();
    let block = e,
      duration = track.defaultDuration;
    if (e.id === 0xa0) {
      block = null;
      for (let at = e.start; at < e.end;) {
        const c = await r.header(at, e.end, signal);
        at = c.end;
        if (c.id === 0xa1) block = c;
        else if (c.id === 0x9b) duration = (await r.uint(c, signal)) * r.scale;
      }
      if (!block) invalid();
    }
    // Use the same bounded block parser as the sequential path, then verify the
    // catalog against actual track, timestamp and duration before trusting it.
    const record = await r.blockRecord(block, duration, timestamp, signal);
    if (
      !record ||
      record[0] !== track.id ||
      Math.abs(record[1] - expectedStart) > 1e-6 ||
      Math.abs(record[2] - expectedEnd) > 1e-6
    )
      throw Error("subtitle-cue-timing-mismatch");
    if (this.resolved.size >= CUE_LIMITS.cueResolvedEntries)
      this.resolved.delete(this.resolved.keys().next().value);
    this.resolved.set(index, record);
    return record;
  }
}
