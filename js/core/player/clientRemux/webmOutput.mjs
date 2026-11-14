import { WebMOutputFormat } from "mediabunny";
import { MAX_RANDOM_ACCESS_POINTS } from "./fragmentTiming.mjs";

export const webmVideoCodecs = ["vp8", "vp9", "av1"];
export const webmAudioCodecs = ["opus", "vorbis"];

export function outputMime(container, kind, ...codecs) {
  return (
    kind +
    "/" +
    (container === "webm" ? "webm" : "mp4") +
    '; codecs="' +
    codecs.filter(Boolean).join(",") +
    '"'
  );
}

function readVint(bytes, at, keepMarker = false) {
  let marker = 128;
  let width = 1;
  while (marker && !(bytes[at] & marker)) {
    marker >>= 1;
    width++;
  }
  if (!marker || at + width > bytes.length) throw Error("output-webm-invalid");
  let value = keepMarker ? bytes[at] : bytes[at] & (marker - 1);
  for (let i = 1; i < width; i++) value = value * 256 + bytes[at + i];
  return { value, next: at + width };
}

function* elements(bytes, start, end) {
  while (start < end) {
    const id = readVint(bytes, start, true);
    const size = readVint(bytes, id.next);
    start = size.next;
    const next = start + size.value;
    if (!Number.isSafeInteger(next) || next > end) throw Error("output-webm-invalid");
    yield { id: id.value, start, end: next };
    start = next;
  }
}

// Mediabunny emits complete clusters via onCluster. Inspect their blocks for
// packet accounting and actual video keyframes, including one-frame clusters.
export function readWebmCluster(bytes, timestamp, videoTrackId) {
  const body = readVint(bytes, 4).next;
  let payloadBytes = 0;
  let maxVideoTime = 0;
  let reorderGuardSeconds = 0;
  const randomAccessPoints = [];
  for (const element of elements(bytes, body, bytes.length)) {
    let block = element;
    let key;
    if (element.id === 0xa0) {
      block = null;
      key = true;
      for (const child of elements(bytes, element.start, element.end)) {
        if (child.id === 0xa1) block = child;
        if (child.id === 0xfb) key = false;
      }
    } else if (element.id !== 0xa3) continue;
    if (!block) throw Error("output-webm-invalid");
    const track = readVint(bytes, block.start);
    if (track.next + 3 > block.end) throw Error("output-webm-invalid");
    payloadBytes += block.end - track.next - 3;
    if (track.value !== videoTrackId) continue;
    const relative = (bytes[track.next] << 8) | bytes[track.next + 1];
    const time = Math.max(0, timestamp + ((relative << 16) >> 16) / 1000);
    reorderGuardSeconds = Math.max(reorderGuardSeconds, maxVideoTime - time);
    maxVideoTime = Math.max(maxVideoTime, time);
    if (key ?? Boolean(bytes[track.next + 2] & 128)) randomAccessPoints.push(time);
  }
  if (randomAccessPoints.length > MAX_RANDOM_ACCESS_POINTS) throw Error("output-timing-invalid");
  return { payloadBytes, randomAccessPoints, reorderGuardSeconds };
}

export function createWebmOutput(onCluster, onSegmentHeader) {
  return new WebMOutputFormat({ appendOnly: true, onCluster, onSegmentHeader });
}
