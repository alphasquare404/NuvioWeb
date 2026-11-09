// Time buffering is a playback optimization, not permission to starve a decoder
// still requesting future data. The independent compressed byte ledger remains hard.
const PLAYBACK_AHEAD_SECONDS = 120;

export function shouldThrottleAhead({
  aheadSeconds,
  readyState,
  paused,
  limitSeconds = PLAYBACK_AHEAD_SECONDS
}) {
  return aheadSeconds >= limitSeconds && (paused || readyState >= 3);
}

// An observed MMS endstreaming is authoritative even before canplay. Permit
// the initial/seek-target unit to land, but do not feed minutes after the UA stops.
export function isManagedBufferBlocked({ signalSeen, allowed, seekApplied, hasBufferedData }) {
  return Boolean(signalSeen && !allowed && seekApplied && hasBufferedData);
}

const MIB = 1024 * 1024;
export const MAX_COMPRESSED_BYTES = 50 * MIB;
export const MAX_PLAYBACK_COMPRESSED_BYTES = 400 * MIB;

export function playbackBufferLimits(deviceMemory) {
  if (Number.isFinite(deviceMemory) && deviceMemory >= 8) {
    const bytes = deviceMemory >= 16 ? MAX_PLAYBACK_COMPRESSED_BYTES : 300 * MIB;
    return { baseBytes: bytes, maxBytes: bytes };
  }
  return { baseBytes: MAX_COMPRESSED_BYTES, maxBytes: 100 * MIB };
}

// Account a complete muxer write before appending its first OPFS piece. Pieces
// already admitted must be allowed to finish, even if MSE exposes samples early.
export class BufferBudget {
  constructor({
    baseBytes = MAX_COMPRESSED_BYTES,
    maxBytes = MAX_COMPRESSED_BYTES,
    requireRandomAccessPoints = false
  } = {}) {
    if (
      !Number.isSafeInteger(baseBytes) ||
      !Number.isSafeInteger(maxBytes) ||
      baseBytes < MAX_COMPRESSED_BYTES ||
      baseBytes > maxBytes ||
      maxBytes > MAX_PLAYBACK_COMPRESSED_BYTES
    )
      throw Error("invalid-buffer-budget");
    this.maxBytes = maxBytes;
    this.limitBytes = baseBytes;
    this.requireRandomAccessPoints = requireRandomAccessPoints;
    // Physical WebKit removal advanced 0.47625s past the MP4 RAP. Keep an
    // additional 0.5s dependency guard, or more if output reordering requires it.
    this.reorderGuardSeconds = requireRandomAccessPoints ? 0.5 : 0;
  }
  randomAccessPoints = [];
  noteRandomAccessPoints(points, reorderGuardSeconds = 0) {
    if (!Array.isArray(points) || points.some((p) => !Number.isFinite(p) || p < 0))
      throw Error("output-timing-invalid");
    if (
      !Number.isFinite(reorderGuardSeconds) ||
      reorderGuardSeconds < 0 ||
      reorderGuardSeconds > 30
    )
      throw Error("output-timing-invalid");
    this.reorderGuardSeconds = Math.max(this.reorderGuardSeconds, reorderGuardSeconds);
    this.randomAccessPoints = [...new Set([...this.randomAccessPoints, ...points])].sort(
      (a, b) => a - b
    );
    if (this.randomAccessPoints.length > 4096) throw Error("output-timing-invalid");
  }
  entries = [];
  pendingBytes = 0;
  reservedBytes = 0;
  lastEnd = 0;
  get heldBytes() {
    return this.pendingBytes + this.entries.reduce((n, x) => n + x.bytes, 0);
  }
  plan(writeBytes, currentTime) {
    if (!Number.isSafeInteger(writeBytes) || writeBytes <= 0 || writeBytes > MAX_COMPRESSED_BYTES)
      throw Error("output-write-exceeds-buffer-budget");
    // Keep room for the playing GOP and its successor. A one-GOP window can
    // deadlock before the final frame, since safe eviction waits past its end.
    // Small writes retain the base limit; growth is capped per session.
    this.limitBytes = Math.min(
      this.maxBytes,
      Math.max(this.limitBytes, 2 * writeBytes + 64 * 1024)
    );
    const requiredBytes = this.heldBytes + writeBytes;
    const bytePressure = requiredBytes > this.limitBytes;
    return {
      requiredBytes,
      bytePressure,
      trimBefore: Math.max(0, currentTime - (bytePressure ? 0.25 : 8))
    };
  }
  forgetBefore(cutoff) {
    this.entries = this.entries.filter((x) => x.end > cutoff);
    const earliest = this.entries[0]?.end ?? this.lastEnd;
    this.randomAccessPoints = this.randomAccessPoints.filter((p) => p >= earliest - 1e-6);
  }
  // Removing part of a video GOP can also remove samples up to the following
  // keyframe. Evict only complete committed groups behind the safety margin.
  removalDependencyEnd(end) {
    if (!this.requireRandomAccessPoints) return end;
    const rap = this.randomAccessPoints.find((p) => p >= end);
    return rap === undefined ? undefined : rap + this.reorderGuardSeconds;
  }
  trimPoint(cutoff) {
    return Math.max(
      0,
      ...this.entries
        .filter((x) => {
          if (x.end > cutoff) return false;
          if (!this.requireRandomAccessPoints) return true;
          // remove(0,end) may remove video through its NEXT presentation-time RAP.
          // SourceBuffer's intersected audio/video end is not that timestamp.
          const next = this.removalDependencyEnd(x.end);
          return next !== undefined && next <= cutoff;
        })
        .map((x) => x.end)
    );
  }
  reserve(writeBytes) {
    if (this.reservedBytes || this.plan(writeBytes, 0).bytePressure)
      throw Error("sourcebuffer-compressed-byte-budget");
    this.reservedBytes = writeBytes;
  }
  append(bytes, bufferedEnd, last) {
    if (bytes > this.reservedBytes || bytes <= 0) throw Error("invalid-output-reservation");
    this.reservedBytes -= bytes;
    this.pendingBytes += bytes;
    if (last) {
      if (this.reservedBytes) throw Error("incomplete-output-write");
      if (bufferedEnd > this.lastEnd) {
        this.entries.push({ end: bufferedEnd, bytes: this.pendingBytes });
        this.pendingBytes = 0;
        this.lastEnd = bufferedEnd;
      }
    }
    if (this.heldBytes > this.limitBytes) throw Error("sourcebuffer-compressed-byte-budget");
  }
}
