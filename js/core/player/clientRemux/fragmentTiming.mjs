// Read only metadata produced by the pinned MP4 muxer. Never retain media data.
export const MAX_RANDOM_ACCESS_POINTS = 4096;
const bad = () => {
  throw Error("output-timing-invalid");
};
function reader(bytes) {
  if (bytes.length > 1024 * 1024) bad();
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (at) => {
    if (at < 0 || at + 4 > bytes.length) bad();
    return v.getUint32(at);
  };
  function boxes(start = 0, end = bytes.length) {
    const result = [];
    for (let at = start; at < end;) {
      const size = u32(at);
      if (size < 8 || at + size > end) bad();
      result.push({ type: u32(at + 4), start: at + 8, end: at + size });
      at += size;
    }
    return result;
  }
  const child = (parent, type) =>
    boxes(parent.start, parent.end).find((x) => x.type === type) || bad();
  return { v, u32, boxes, child };
}
export function readVideoTrackTiming(bytes) {
  const r = reader(bytes),
    moov = r.boxes().find((b) => b.type === 0x6d6f6f76) || bad();
  for (const trak of r.boxes(moov.start, moov.end).filter((b) => b.type === 0x7472616b)) {
    const mdia = r.child(trak, 0x6d646961),
      hdlr = r.child(mdia, 0x68646c72);
    if (r.u32(hdlr.start + 8) !== 0x76696465) continue;
    const tkhd = r.child(trak, 0x746b6864),
      mdhd = r.child(mdia, 0x6d646864);
    const id = r.u32(tkhd.start + (r.v.getUint8(tkhd.start) === 1 ? 20 : 12));
    const timescale = r.u32(mdhd.start + (r.v.getUint8(mdhd.start) === 1 ? 20 : 12));
    if (!id || !timescale) bad();
    return { id, timescale };
  }
  bad();
}
export function readVideoFragmentTiming(bytes, track) {
  if (!track?.id || !track.timescale) bad();
  const r = reader(bytes),
    moof = r.boxes().find((b) => b.type === 0x6d6f6f66) || bad(),
    points = [];
  let reorder = 0,
    maxDuration = 0;
  for (const traf of r.boxes(moof.start, moof.end).filter((b) => b.type === 0x74726166)) {
    const tfhd = r.child(traf, 0x74666864),
      flags = r.u32(tfhd.start) & 0xffffff;
    if (r.u32(tfhd.start + 4) !== track.id) continue;
    let at = tfhd.start + 8;
    if (flags & 1) at += 8;
    if (flags & 2) at += 4;
    const duration = flags & 8 ? r.u32(at) : 0;
    if (flags & 8) at += 4;
    if (flags & 16) at += 4;
    const defaultFlags = flags & 32 ? r.u32(at) : null;
    const tfdt = r.child(traf, 0x74666474),
      version = r.v.getUint8(tfdt.start);
    let decode =
      version === 1
        ? Number(r.v.getBigUint64(tfdt.start + 4))
        : version === 0
          ? r.u32(tfdt.start + 4)
          : bad();
    if (!Number.isSafeInteger(decode)) bad();
    for (const trun of r.boxes(traf.start, traf.end).filter((b) => b.type === 0x7472756e)) {
      const version = r.v.getUint8(trun.start),
        flags = r.u32(trun.start) & 0xffffff,
        count = r.u32(trun.start + 4);
      if (version > 1 || count > 100000) bad();
      at = trun.start + 8;
      if (flags & 1) at += 4;
      const firstFlags = flags & 4 ? r.u32(at) : null;
      if (flags & 4) at += 4;
      for (let i = 0; i < count; i++) {
        const step = flags & 0x100 ? r.u32(at) : duration;
        if (flags & 0x100) at += 4;
        if (flags & 0x200) at += 4;
        const sampleFlags =
          flags & 0x400 ? r.u32(at) : i === 0 && firstFlags !== null ? firstFlags : defaultFlags;
        if (flags & 0x400) at += 4;
        let offset = 0;
        if (flags & 0x800) {
          offset = version === 1 ? r.v.getInt32(at) : r.u32(at);
          at += 4;
        }
        if (at > trun.end || !step || sampleFlags === null) bad();
        reorder = Math.max(reorder, Math.abs(offset));
        maxDuration = Math.max(maxDuration, step);
        if (!(sampleFlags & 0x10000) && ((sampleFlags >>> 24) & 3) !== 1) {
          points.push((decode + offset) / track.timescale);
          if (points.length > MAX_RANDOM_ACCESS_POINTS) bad();
        }
        decode += step;
        if (!Number.isSafeInteger(decode)) bad();
      }
      if (at !== trun.end) bad();
    }
  }
  return {
    randomAccessPoints: points,
    reorderGuardSeconds: (reorder + maxDuration) / track.timescale
  };
}
export const readVideoRandomAccessPoints = (bytes, track) =>
  readVideoFragmentTiming(bytes, track).randomAccessPoints;
