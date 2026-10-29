import { readRange } from "./range.mjs";
import { MkvSubtitleCues, CUE_LIMITS } from "./mkvSubtitleCues.mjs";
// Deliberately narrow subtitle demuxer. Never reads an entire movie into RAM.
export const SUBTITLE_LIMITS = Object.freeze({
  pageBytes: 256 * 1024,
  pages: 2,
  scanBytes: 8 * 1024 ** 2,
  elements: 30000,
  cues: 512,
  cueBytes: 64 * 1024,
  windowTextBytes: 256 * 1024,
  tracks: 128,
  indexRecords: 16384,
  textCacheBytes: 256 * 1024,
  textCacheEntries: 512,
  ...CUE_LIMITS
});
// Fixed-width descriptors, not movie payload: track/start/end/offset/size/id/error.
const RECORD_FIELDS = 7;
const I = {
  segment: 0x18538067,
  info: 0x1549a966,
  tracks: 0x1654ae6b,
  cluster: 0x1f43b675,
  entry: 0xae,
  scale: 0x2ad7b1,
  number: 0xd7,
  type: 0x83,
  codec: 0x86,
  name: 0x536e,
  lang: 0x22b59c,
  ietf: 0x22b59d,
  default: 0x88,
  forced: 0x55aa,
  enabled: 0xb9,
  encoding: 0x6d80,
  defaultDuration: 0x23e383,
  delay: 0x56aa,
  trackScale: 0x23314f,
  time: 0xe7,
  simple: 0xa3,
  group: 0xa0,
  block: 0xa1,
  duration: 0x9b
};
const supported = new Set(["S_TEXT/UTF8", "S_TEXT/ASS", "S_TEXT/SSA", "S_TEXT/WEBVTT"]);
const invalid = () => {
  throw Error("subtitle-matroska-invalid");
};
export function vint(bytes, at = 0, { id = false } = {}) {
  const first = bytes[at];
  if (!first) invalid();
  let length = 1,
    mask = 128;
  while (!(first & mask)) {
    length++;
    mask >>= 1;
  }
  if (length > (id ? 4 : 8) || at + length > bytes.length) invalid();
  let value = id ? first : first & (mask - 1),
    unknown = !id && value === mask - 1;
  for (let i = 1; i < length; i++) {
    value = value * 256 + bytes[at + i];
    unknown = unknown && bytes[at + i] === 255;
  }
  if (!unknown && !Number.isSafeInteger(value)) invalid();
  return { value: unknown ? null : value, length };
}
export function plainSubtitle(text, codec = "S_TEXT/UTF8") {
  if (codec === "S_TEXT/ASS" || codec === "S_TEXT/SSA") {
    const fields = text.split(",");
    if (fields.length < 9) throw Error("subtitle-ass-packet-invalid");
    text = fields.slice(8).join(",");
  }
  return (
    text
      .replace(/\{[^}]*\}/g, "")
      .replace(/\\[Nn]/g, "\n")
      .replace(/\\h/g, " ")
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<[^>]*>/g, "")
      // Strip control bytes intentionally, retaining subtitle whitespace.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
      .trim()
  );
}
export const cueText = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export class MkvTextSubtitles {
  constructor({ url, fetcher = fetch, stats = {} }) {
    this.url = url;
    this.fetcher = fetcher;
    this.stats = stats;
    this.pages = new Map();
    this.scale = 0.001;
    this.tracks = [];
    this.initialized = false;
    this.recordCount = 0;
    this.textCache = new Map();
    this.textCacheBytes = 0;
    this.indexedBefore = -Infinity;
    this.indexComplete = false;
  }
  async bytes(at, length, signal) {
    signal?.throwIfAborted();
    if (
      !Number.isSafeInteger(at) ||
      at < 0 ||
      length < 0 ||
      length > SUBTITLE_LIMITS.cueBytes ||
      at + length > this.stats.size
    )
      invalid();
    const out = new Uint8Array(length);
    for (let n = 0; n < length;) {
      signal?.throwIfAborted();
      const base = Math.floor((at + n) / SUBTITLE_LIMITS.pageBytes) * SUBTITLE_LIMITS.pageBytes;
      let page = this.pages.get(base);
      if (!page) {
        const end = Math.min(base + SUBTITLE_LIMITS.pageBytes, this.stats.size);
        if ((this.stats.bytes || 0) - this.readStart + end - base > SUBTITLE_LIMITS.scanBytes)
          throw Error("subtitle-scan-budget");
        if (this.pages.size === SUBTITLE_LIMITS.pages)
          this.pages.delete(this.pages.keys().next().value);
        page = await readRange(this.url, base, end, signal, this.stats, this.fetcher);
        signal?.throwIfAborted();
        this.pages.set(base, page);
        this.stats.subtitlePeakPageBytes = Math.max(
          this.stats.subtitlePeakPageBytes || 0,
          [...this.pages.values()].reduce((s, p) => s + p.length, 0)
        );
      } else {
        this.pages.delete(base);
        this.pages.set(base, page);
      }
      const amount = Math.min(length - n, page.length - (at + n - base));
      out.set(page.subarray(at + n - base, at + n - base + amount), n);
      n += amount;
    }
    return out;
  }
  budget() {
    if (++this.elements > (this.elementLimit ?? SUBTITLE_LIMITS.elements))
      throw Error("subtitle-element-budget");
  }
  async header(at, parentEnd, signal) {
    this.budget();
    const bytes = await this.bytes(at, Math.min(12, parentEnd - at), signal),
      id = vint(bytes, 0, { id: true }),
      size = vint(bytes, id.length),
      start = at + id.length + size.length,
      end = size.value === null ? parentEnd : start + size.value;
    if (start > parentEnd || end > parentEnd || end < start) invalid();
    return { id: id.value, at, start, end, unknown: size.value === null };
  }
  async uint(e, signal) {
    const b = await this.bytes(e.start, e.end - e.start, signal);
    if (!b.length || b.length > 8) invalid();
    let value = 0;
    for (const n of b) value = value * 256 + n;
    if (!Number.isSafeInteger(value)) invalid();
    return value;
  }
  async text(e, signal) {
    this.metadataBytes = (this.metadataBytes || 0) + e.end - e.start;
    if (e.end - e.start > 4096 || this.metadataBytes > 64 * 1024)
      throw Error("subtitle-metadata-budget");
    return new TextDecoder("utf-8", { fatal: true })
      .decode(await this.bytes(e.start, e.end - e.start, signal))
      .replace(/\0+$/, "");
  }
  async open(signal) {
    this.elements = 0;
    this.readStart = this.stats.bytes || 0;
    await readRange(this.url, 0, 1, signal, this.stats, this.fetcher);
    let segment;
    for (let at = 0; at < this.stats.size;) {
      const e = await this.header(at, this.stats.size, signal);
      if (e.id === I.segment) {
        segment = e;
        break;
      }
      if (e.unknown) invalid();
      at = e.end;
    }
    if (!segment) invalid();
    this.end = segment.end;
    this.segmentStart = segment.start;
    this.cueIndex = new MkvSubtitleCues(this);
    for (let at = segment.start; at < segment.end;) {
      const e = await this.header(at, segment.end, signal);
      if (e.id === I.info) {
        for (let p = e.start; p < e.end;) {
          const c = await this.header(p, e.end, signal);
          if (c.id === I.scale) {
            this.scale = (await this.uint(c, signal)) / 1e9;
            if (!(this.scale > 0)) invalid();
          }
          p = c.end;
        }
      } else if (e.id === I.tracks) {
        await this.readTracks(e, signal);
      } else if (e.id === 0x114d9b74) {
        await this.cueIndex.head(e, signal);
      } else if (e.id === 0x1c53bb6b) {
        this.cueIndex.locate(e.at);
      } else if (e.id === I.cluster) {
        this.firstCluster = e.at;
        break;
      }
      if (e.unknown) invalid();
      at = e.end;
    }
    if (this.firstCluster === undefined) throw Error("subtitle-clusters-unavailable");
    this.nextCluster = this.firstCluster;
    this.updateIndexStats();
    this.initialized = true;
    return this.tracks;
  }
  async readTracks(parent, signal) {
    for (let at = parent.start; at < parent.end;) {
      const entry = await this.header(at, parent.end, signal);
      at = entry.end;
      if (entry.id !== I.entry) continue;
      const t = {
        id: 0,
        type: 0,
        codec: "",
        language: "und",
        name: "",
        default: true,
        forced: false,
        enabled: true,
        defaultDuration: 0,
        delay: 0,
        encoded: false,
        scaled: false
      };
      for (let p = entry.start; p < entry.end;) {
        const e = await this.header(p, entry.end, signal);
        p = e.end;
        if (e.id === I.number) t.id = await this.uint(e, signal);
        else if (e.id === I.type) t.type = await this.uint(e, signal);
        else if (e.id === I.codec) t.codec = await this.text(e, signal);
        else if (e.id === I.name) t.name = await this.text(e, signal);
        else if (e.id === I.ietf) {
          t.language = await this.text(e, signal);
          t.ietf = true;
        } else if (e.id === I.lang && !t.ietf) t.language = await this.text(e, signal);
        else if (e.id === I.default) t.default = !!(await this.uint(e, signal));
        else if (e.id === I.forced) t.forced = !!(await this.uint(e, signal));
        else if (e.id === I.enabled) t.enabled = !!(await this.uint(e, signal));
        else if (e.id === I.defaultDuration) t.defaultDuration = (await this.uint(e, signal)) / 1e9;
        else if (e.id === I.delay) t.delay = (await this.uint(e, signal)) / 1e9;
        else if (e.id === I.encoding) t.encoded = true;
        else if (e.id === I.trackScale) {
          const b = await this.bytes(e.start, e.end - e.start, signal);
          if (b.length !== 4 && b.length !== 8) invalid();
          t.scaled =
            (b.length === 4
              ? new DataView(b.buffer).getFloat32(0)
              : new DataView(b.buffer).getFloat64(0)) !== 1;
        }
      }
      if (t.type === 17 && t.enabled) {
        if (
          this.tracks.length >= SUBTITLE_LIMITS.tracks ||
          !t.id ||
          this.tracks.some((x) => x.id === t.id)
        )
          invalid();
        t.supported = supported.has(t.codec) && !t.encoded && !t.scaled;
        t.reason = t.supported
          ? null
          : t.encoded
            ? "content-encoding"
            : t.scaled
              ? "track-timestamp-scale"
              : "subtitle-format";
        this.tracks.push(t);
      }
    }
  }
  updateIndexStats() {
    const cueBytes = this.cueIndex?.storage?.byteLength || 0;
    Object.assign(this.stats, {
      subtitleIndexRecords: this.recordCount + (this.cueIndex?.records || 0),
      subtitleIndexBytes: (this.index?.byteLength || 0) + cueBytes,
      subtitleCueIndexBytes: cueBytes,
      subtitleCueIndexTrack: this.cueIndex?.trackId ?? null,
      subtitleCueResolvedEntries: this.cueIndex?.resolved.size || 0,
      subtitleIndexedBefore: Number.isFinite(this.indexedBefore)
        ? Math.max(0, this.indexedBefore)
        : 0,
      subtitleIndexComplete:
        !!(
          this.stats.subtitleIndexMethod === "container-cues" &&
          this.cueIndex?.loaded &&
          this.cueIndex?.data
        ) || this.indexComplete,
      subtitleTextCacheBytes: this.textCacheBytes,
      subtitleTextCacheEntries: this.textCache.size
    });
  }
  async blockRecord(block, duration, timestamp, signal) {
    const prefix = await this.bytes(block.start, Math.min(12, block.end - block.start), signal),
      number = vint(prefix),
      track = this.tracks.find((t) => t.id === number.value && t.supported);
    if (!track) return null;
    if (prefix.length < number.length + 3) invalid();
    const rel = new DataView(prefix.buffer).getInt16(number.length),
      flags = prefix[number.length + 2];
    duration ??= track.defaultDuration;
    const start = (timestamp + rel) * this.scale - track.delay,
      end = start + duration,
      offset = block.start + number.length + 3,
      size = block.end - offset;
    return [
      track.id,
      start,
      end,
      offset,
      size,
      block.at,
      flags & 6 ? 1 : !(duration > 0) ? 2 : size > SUBTITLE_LIMITS.cueBytes ? 3 : 0
    ];
  }
  async extendIndex(to, signal, { trackId, from }) {
    this.index ??= new Float64Array(SUBTITLE_LIMITS.indexRecords * RECORD_FIELDS);
    const maxDelay = Math.max(0, ...this.tracks.filter((t) => t.supported).map((t) => t.delay));
    while (!this.indexComplete && this.indexedBefore <= to) {
      signal?.throwIfAborted();
      if (this.nextCluster >= this.end) {
        this.indexComplete = true;
        break;
      }
      const cluster = await this.header(this.nextCluster, this.end, signal);
      if (cluster.id !== I.cluster) {
        if (cluster.unknown) invalid();
        this.nextCluster = cluster.end;
        continue;
      }
      if (cluster.unknown) throw Error("subtitle-unknown-cluster-size");
      // Only publish complete clusters. Aborted/failed scans resume at this cluster,
      // without duplicated records or claiming partially scanned time coverage.
      const committed = this.recordCount;
      try {
        let timestamp = null;
        for (let p = cluster.start; p < cluster.end;) {
          const e = await this.header(p, cluster.end, signal);
          p = e.end;
          if (e.id === I.time) {
            timestamp = await this.uint(e, signal);
            continue;
          }
          if (e.id !== I.simple && e.id !== I.group) continue;
          if (timestamp === null) invalid();
          let block = e,
            duration = null;
          if (e.id === I.group) {
            block = null;
            for (let q = e.start; q < e.end;) {
              const c = await this.header(q, e.end, signal);
              q = c.end;
              if (c.id === I.block) block = c;
              else if (c.id === I.duration) duration = (await this.uint(c, signal)) * this.scale;
            }
            if (!block) continue;
          }
          const record = await this.blockRecord(block, duration, timestamp, signal);
          if (!record) continue;
          const [id, start, end, , , , error] = record,
            track = this.tracks.find((t) => t.id === id);
          if (this.recordCount >= SUBTITLE_LIMITS.indexRecords)
            throw Error("subtitle-index-budget");
          this.index.set(record, this.recordCount++ * RECORD_FIELDS);
          // Read relevant text while its page is resident, avoiding a second pass over
          // the same pages on the first window. Other languages retain offsets only.
          if (!error && track.id === trackId && end > from && start < to)
            await this.textFor(
              this.index.subarray(
                (this.recordCount - 1) * RECORD_FIELDS,
                this.recordCount * RECORD_FIELDS
              ),
              track.codec,
              signal
            );
        }
        signal?.throwIfAborted();
        // Same ordered-cluster assumption as v13. All earlier descriptors remain,
        // including long cues whose start is far behind the requested window.
        if (timestamp !== null) this.indexedBefore = (timestamp - 32768) * this.scale - maxDelay;
        this.nextCluster = cluster.end;
        this.indexComplete = this.nextCluster === this.end;
        this.updateIndexStats();
      } catch (error) {
        this.recordCount = committed;
        this.updateIndexStats();
        throw error;
      }
    }
    this.updateIndexStats();
  }
  async textFor(record, codec, signal) {
    const [, , , offset, size, id] = record;
    let cached = this.textCache.get(id);
    if (cached) {
      this.textCache.delete(id);
      this.textCache.set(id, cached);
      this.stats.subtitleTextCacheHits++;
      return cached;
    }
    const text = plainSubtitle(
      new TextDecoder("utf-8", { fatal: true }).decode(await this.bytes(offset, size, signal)),
      codec
    );
    // Account UTF-16 storage conservatively as well as encoded transfer bytes.
    cached = { text, bytes: new TextEncoder().encode(text).length, memory: text.length * 2 };
    while (
      this.textCache.size &&
      (this.textCache.size >= SUBTITLE_LIMITS.textCacheEntries ||
        this.textCacheBytes + cached.memory > SUBTITLE_LIMITS.textCacheBytes)
    ) {
      const key = this.textCache.keys().next().value;
      this.textCacheBytes -= this.textCache.get(key).memory;
      this.textCache.delete(key);
    }
    if (cached.memory <= SUBTITLE_LIMITS.textCacheBytes) {
      this.textCache.set(id, cached);
      this.textCacheBytes += cached.memory;
      this.updateIndexStats();
    }
    return cached;
  }
  async window(trackId, time, { ahead = 25, behind = 2, signal } = {}) {
    signal?.throwIfAborted();
    if (!this.initialized) throw Error("subtitle-not-open");
    const track = this.tracks.find((t) => t.id === trackId);
    if (!track?.supported) throw Error("subtitle-track-unsupported");
    if (
      !Number.isFinite(time) ||
      time < 0 ||
      !Number.isFinite(ahead) ||
      ahead < 0 ||
      ahead > 60 ||
      !Number.isFinite(behind) ||
      behind < 0 ||
      behind > 10
    )
      invalid();
    this.elements = 0;
    this.readStart = this.stats.bytes || 0;
    const from = Math.max(0, time - behind),
      to = time + ahead,
      cues = [];
    let textBytes = 0;
    this.stats.subtitleIndexHit = this.indexComplete || this.indexedBefore > to;
    this.stats.subtitleTextCacheHits = 0;
    try {
      const hadCatalog = this.cueIndex.loaded && this.cueIndex.trackId === trackId;
      await this.cueIndex.load(signal, trackId);
      const fallback = this.cueIndex.availability(trackId);
      this.stats.subtitleCueIndexReason = fallback;
      this.stats.subtitleIndexMethod = fallback ? "sequential" : "container-cues";
      if (!fallback) {
        this.stats.subtitleIndexHit = hadCatalog;
        const seen = new Set();
        for (const candidate of this.cueIndex.candidates(trackId, from, to)) {
          const record = await this.cueIndex.resolve(candidate, track, signal);
          if (seen.has(record[5])) continue;
          seen.add(record[5]);
          const error = record[6];
          if (error)
            throw Error(
              error === 1
                ? "subtitle-lacing-unsupported"
                : error === 2
                  ? "subtitle-duration-unavailable"
                  : "subtitle-cue-budget"
            );
          const cached = await this.textFor(record, track.codec, signal);
          textBytes += cached.bytes;
          if (textBytes > SUBTITLE_LIMITS.windowTextBytes) throw Error("subtitle-window-budget");
          if (cached.text)
            cues.push({
              id: `${trackId}-${record[5]}`,
              start: Math.max(0, record[1]),
              end: record[2],
              text: cached.text
            });
        }
      } else {
        await this.extendIndex(to, signal, { trackId, from });
        for (let i = 0; i < this.recordCount; i++) {
          signal?.throwIfAborted();
          const record = this.index.subarray(i * RECORD_FIELDS, (i + 1) * RECORD_FIELDS),
            [id, start, end, , , , error] = record;
          if (id !== track.id) continue;
          if (error === 1) throw Error("subtitle-lacing-unsupported");
          if (error === 2) throw Error("subtitle-duration-unavailable");
          if (end <= from || start >= to) continue;
          if (error === 3) throw Error("subtitle-cue-budget");
          const cached = await this.textFor(record, track.codec, signal);
          textBytes += cached.bytes;
          if (cues.length >= SUBTITLE_LIMITS.cues || textBytes > SUBTITLE_LIMITS.windowTextBytes)
            throw Error("subtitle-window-budget");
          if (cached.text)
            cues.push({
              id: `${track.id}-${record[5]}`,
              start: Math.max(0, start),
              end,
              text: cached.text
            });
        }
      }
    } finally {
      this.updateIndexStats();
      this.stats.subtitleWindowReadBytes = (this.stats.bytes || 0) - this.readStart;
      this.stats.subtitleWindowElements = this.elements;
      this.stats.subtitleWindowTextBytes = textBytes;
    }
    return {
      from,
      to,
      cues: cues.sort((a, b) => a.start - b.start || a.end - b.end),
      complete: true,
      stats: { ...this.stats }
    };
  }
}
