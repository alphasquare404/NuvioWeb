import { readVideoFragmentTiming } from "./fragmentTiming.mjs";
export const IO_BYTES = 256 * 1024,
  MAX_INIT_BYTES = 1024 * 1024;
const bad = () => {
  throw Error("cache-media-invalid");
};
export function boxes(bytes, start = 0, end = bytes.length) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    result = [];
  for (let at = start; at < end;) {
    if (at + 8 > end) bad();
    let size = view.getUint32(at),
      header = 8;
    if (size === 1) {
      if (at + 16 > end) bad();
      size = Number(view.getBigUint64(at + 8));
      header = 16;
    }
    if (!Number.isSafeInteger(size) || size < header || at + size > end) bad();
    result.push({
      type: String.fromCharCode(...bytes.subarray(at + 4, at + 8)),
      at,
      start: at + header,
      end: at + size
    });
    at += size;
  }
  return result;
}
export function readTracks(bytes) {
  if (bytes.length > MAX_INIT_BYTES) bad();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const child = (parent, type) =>
    boxes(bytes, parent.start, parent.end).find((b) => b.type === type) || bad();
  const moov = boxes(bytes).find((b) => b.type === "moov") || bad();
  return boxes(bytes, moov.start, moov.end)
    .filter((b) => b.type === "trak")
    .map((trak) => {
      const tkhd = child(trak, "tkhd"),
        mdia = child(trak, "mdia"),
        mdhd = child(mdia, "mdhd"),
        hdlr = child(mdia, "hdlr");
      const id = view.getUint32(tkhd.start + (view.getUint8(tkhd.start) === 1 ? 20 : 12));
      const timescale = view.getUint32(mdhd.start + (view.getUint8(mdhd.start) === 1 ? 20 : 12));
      const type = String.fromCharCode(...bytes.subarray(hdlr.start + 8, hdlr.start + 12));
      if (!id || !timescale || !["vide", "soun"].includes(type)) bad();
      return { id, timescale, type };
    });
}
export function mergeRanges(ranges) {
  const result = [];
  for (const [start, end] of ranges.slice().sort((a, b) => a[0] - b[0])) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) bad();
    // Matroska millisecond timestamps can leave sub-millisecond rounding seams.
    const last = result.at(-1);
    if (last && start <= last[1] + 0.002) last[1] = Math.max(last[1], end);
    else result.push([start, end]);
  }
  return result;
}
export const includesTime = (ranges, time) =>
  ranges.some(([a, b]) => time >= a - 0.0001 && time < b - 0.0001);
export function mediaTiming(moof, tracks) {
  const view = new DataView(moof.buffer, moof.byteOffset, moof.byteLength),
    root = boxes(moof).find((b) => b.type === "moof") || bad();
  const coverage = { video: [], audio: [] };
  for (const traf of boxes(moof, root.start, root.end).filter((b) => b.type === "traf")) {
    const children = boxes(moof, traf.start, traf.end),
      tfhd = children.find((b) => b.type === "tfhd") || bad(),
      tfdt = children.find((b) => b.type === "tfdt") || bad();
    const track = tracks.find((t) => t.id === view.getUint32(tfhd.start + 4)) || bad(),
      flags = view.getUint32(tfhd.start) & 0xffffff;
    let at = tfhd.start + 8;
    if (flags & 1) at += 8;
    if (flags & 2) at += 4;
    const duration = flags & 8 ? view.getUint32(at) : 0;
    if (flags & 8) at += 4;
    let decode =
      view.getUint8(tfdt.start) === 1
        ? Number(view.getBigUint64(tfdt.start + 4))
        : view.getUint32(tfdt.start + 4);
    const ranges = [];
    for (const trun of children.filter((b) => b.type === "trun")) {
      const flags = view.getUint32(trun.start) & 0xffffff,
        count = view.getUint32(trun.start + 4),
        version = view.getUint8(trun.start);
      if (count > 100000 || version > 1) bad();
      at = trun.start + 8;
      if (flags & 1) at += 4;
      if (flags & 4) at += 4;
      for (let i = 0; i < count; i++) {
        const step = flags & 0x100 ? view.getUint32(at) : duration;
        if (flags & 0x100) at += 4;
        if (flags & 0x200) at += 4;
        if (flags & 0x400) at += 4;
        let offset = 0;
        if (flags & 0x800) {
          offset = version === 1 ? view.getInt32(at) : view.getUint32(at);
          at += 4;
        }
        if (at > trun.end || !Number.isSafeInteger(decode)) bad();
        if (step > 0)
          ranges.push([
            (decode + offset) / track.timescale,
            (decode + offset + step) / track.timescale
          ]);
        decode += step;
      }
      if (at !== trun.end) bad();
    }
    const name = track.type === "vide" ? "video" : "audio";
    coverage[name].push(...mergeRanges(ranges));
  }
  for (const kind of ["video", "audio"]) {
    coverage[kind] = mergeRanges(coverage[kind]);
    if (coverage[kind].length > 64) bad();
  }
  const timing = readVideoFragmentTiming(
    moof,
    tracks.find((t) => t.type === "vide")
  );
  return { ...coverage, ...timing };
}
export class OutputFragments {
  constructor() {
    this.ftyp = null;
    this.tracks = null;
    this.seq = 0;
  }
  split(bytes) {
    const top = boxes(bytes),
      units = [];
    for (let i = 0; i < top.length; i++) {
      const b = top[i];
      if (b.type === "ftyp") {
        this.ftyp = bytes.slice(b.at, b.end);
        continue;
      }
      if (b.type === "moov") {
        if (!this.ftyp || this.ftyp.length + b.end - b.at > MAX_INIT_BYTES) bad();
        const init = new Uint8Array(this.ftyp.length + b.end - b.at);
        init.set(this.ftyp);
        init.set(bytes.subarray(b.at, b.end), this.ftyp.length);
        this.tracks = readTracks(init);
        units.push({ kind: "init", data: init });
        continue;
      }
      if (b.type === "moof") {
        if (!this.tracks) bad();
        let end = b.end,
          j = i + 1;
        while (j < top.length && top[j].type === "mdat") {
          end = top[j].end;
          j++;
        }
        if (j === i + 1) bad();
        units.push({
          kind: "media",
          seq: this.seq++,
          data: bytes.subarray(b.at, end),
          timing: mediaTiming(bytes.subarray(b.at, b.end), this.tracks)
        });
        i = j - 1;
        continue;
      }
      if (!["mfra", "free", "sidx", "styp"].includes(b.type)) bad();
    }
    return units;
  }
}
