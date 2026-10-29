import {
  Input,
  MATROSKA,
  CustomSource,
  Output,
  Mp4OutputFormat,
  StreamTarget,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  EncodedAudioPacketSource
} from "mediabunny";
import { readRange } from "./range.mjs";
import { createSourceReader, LIBRARY_CACHE_BYTES } from "./sourceReader.mjs";
import { MAX_COMPRESSED_BYTES } from "./bufferBudget.mjs";
import {
  readVideoTrackTiming,
  readVideoFragmentTiming,
  MAX_RANDOM_ACCESS_POINTS
} from "./fragmentTiming.mjs";

// Separate component budgets, not a cap on total browser or decoder memory.
// The muxer closes fragments at keyframes; a 1s minimum does not bound GOP size.
export const MAX_PENDING_PACKET_BYTES = MAX_COMPRESSED_BYTES;

// Pinned non-chunked StreamTarget writes complete top-level ISO BMFF boxes.
// Count only encoded mdat payload, never moov/moof headers, and retain no bytes.
export function mediaPayloadBytes(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0,
    total = 0;
  while (at < bytes.length) {
    if (bytes.length - at < 8) throw Error("output-box-invalid");
    let size = view.getUint32(at),
      header = 8;
    if (size === 1) {
      if (bytes.length - at < 16) throw Error("output-box-invalid");
      size = Number(view.getBigUint64(at + 8));
      header = 16;
    }
    if (!Number.isSafeInteger(size) || size < header || size > bytes.length - at)
      throw Error("output-box-invalid");
    if (view.getUint32(at + 4) === 0x6d646174) total += size - header;
    at += size;
  }
  return total;
}

export async function remux({
  url,
  start = 0,
  audioIndex = 0,
  expectedAudio = null,
  signal,
  stats = {},
  write,
  writeOutput,
  beforePacket,
  metadata,
  fetcher = fetch
}) {
  const started = performance.now(),
    stamp = (name) => {
      stats[name] = Math.round(performance.now() - started);
    };
  stats.packetBudgetBytes = MAX_PENDING_PACKET_BYTES;
  stats.outputWriteBudgetBytes = MAX_COMPRESSED_BYTES;
  await readRange(url, 0, 1, signal, stats, fetcher);
  const input = new Input({
    formats: [MATROSKA],
    source: new CustomSource({
      getSize: () => stats.size,
      read: createSourceReader({ url, signal, stats, fetcher }),
      maxCacheSize: LIBRARY_CACHE_BYTES,
      prefetchProfile: "none"
    })
  });
  let output;
  try {
    const video = await input.getPrimaryVideoTrack();
    const audioTracks = await input.getAudioTracks();
    if (audioTracks.length > 32) throw Error("audio-track-limit");
    if (!Number.isInteger(audioIndex) || audioIndex < 0 || audioIndex >= audioTracks.length)
      throw Error("audio-track-unavailable");
    const audio = audioTracks[audioIndex];
    if (video?.codec !== "avc" || audio?.codec !== "aac")
      throw Error("client-requires-h264-aac-mkv");
    const vc = await video.getDecoderConfig(),
      ac = await audio.getDecoderConfig();
    if (
      expectedAudio?.index === audioIndex &&
      (expectedAudio.count !== audioTracks.length ||
        (expectedAudio.codec && expectedAudio.codec !== "aac") ||
        (expectedAudio.channels && expectedAudio.channels !== ac.numberOfChannels) ||
        (expectedAudio.sampleRate && expectedAudio.sampleRate !== ac.sampleRate))
    )
      throw Error("audio-probe-mismatch");
    if (ac.numberOfChannels !== 2) throw Error("client-audio-layout-not-validated");
    const availableAudio = await Promise.all(
      audioTracks.map(async (track, index) => {
        const config = track.codec === "aac" ? await track.getDecoderConfig() : null;
        return {
          id: String(track.id),
          index,
          label: String(track.name || track.languageCode || "Audio " + (index + 1)).slice(0, 256),
          language: track.languageCode,
          codec: track.codec,
          channels: config?.numberOfChannels || 0,
          supported: track.codec === "aac" && config?.numberOfChannels === 2
        };
      })
    );
    const duration = await input.getDurationFromMetadata();
    if (!(duration > 0) || !Number.isFinite(duration)) throw Error("duration-unavailable");
    if (start >= duration) throw Error("seek-outside-duration");
    stamp("tracksReadyMs");
    const vs = new EncodedPacketSink(video),
      as = new EncodedPacketSink(audio);
    let vp = (await vs.getKeyPacket(start)) || (await vs.getFirstKeyPacket());
    if (!vp) throw Error("video-keyframe-unavailable");
    // Keep the selected audio's preroll with the video random-access start.
    // The renderer still seeks to the requested source time; no timestamps shift.
    const audioAnchor = Math.max(0, vp.timestamp);
    let ap =
      audioAnchor === 0
        ? await as.getFirstPacket()
        : (await as.getPacket(audioAnchor)) || (await as.getFirstPacket());
    stamp("keyPacketsReadyMs");
    await metadata({
      audioIndex,
      audioTracks: availableAudio,
      duration,
      start: vp.timestamp,
      requested: start,
      mime: `video/mp4; codecs="${await video.getCodecParameterString()},${await audio.getCodecParameterString()}"`,
      video: video.codec,
      audio: audio.codec,
      channels: ac.numberOfChannels,
      firstAudioTimestamp: ap?.timestamp
    });
    stamp("metadataAckMs");
    const vout = new EncodedVideoPacketSource(video.codec),
      aout = new EncodedAudioPacketSource(audio.codec);
    let pendingBytes = 0,
      outputPosition = 0,
      outputDrained = Promise.resolve(),
      videoTiming,
      pendingRaps = [];
    output = new Output({
      format: new Mp4OutputFormat({
        fastStart: "fragmented",
        minimumFragmentDuration: 1,
        onMoov(data) {
          videoTiming = readVideoTrackTiming(data);
        },
        onMoof(data, _position, timestamp) {
          const timing = readVideoFragmentTiming(data, videoTiming);
          pendingRaps.push(...timing.randomAccessPoints);
          stats.videoReorderGuardSeconds = Math.max(
            stats.videoReorderGuardSeconds || 0,
            timing.reorderGuardSeconds
          );
          if (pendingRaps.length > MAX_RANDOM_ACCESS_POINTS) throw Error("output-timing-invalid");
          if (stats.lastFragmentTimestamp !== undefined)
            stats.maxFragmentInterval = Math.max(
              stats.maxFragmentInterval || 0,
              timestamp - stats.lastFragmentTimestamp
            );
          stats.lastFragmentTimestamp = timestamp;
          stats.fragmentCount = (stats.fragmentCount || 0) + 1;
        }
      }),
      target: new StreamTarget(
        new WritableStream({
          async write(chunk) {
            if (signal.aborted) throw Error("cancelled");
            if (chunk.position !== outputPosition) throw Error("non-sequential-output");
            if (chunk.data.length > MAX_COMPRESSED_BYTES)
              throw Error("output-write-exceeds-buffer-budget");
            pendingBytes -= mediaPayloadBytes(chunk.data);
            if (pendingBytes < 0) throw Error("packet-accounting-invalid");
            stats.pendingPacketBytes = pendingBytes;
            // A flushed payload now belongs to output staging. Do not accumulate
            // another GOP while OPFS/MSE is waiting for acknowledgement.
            let drained;
            outputDrained = new Promise((resolve) => (drained = resolve));
            const randomAccessPoints = pendingRaps;
            pendingRaps = [];
            try {
              const firstMedia = outputPosition > 0 && stats.firstMediaReadyMs === undefined;
              if (firstMedia) {
                stamp("firstMediaReadyMs");
                stats.firstMediaInputBytes = stats.bytes;
                stats.firstMediaRequests = stats.requests;
              }
              // Split disk writes and transfers; muxer allocations are measured separately.
              stats.maxOutputWrite = Math.max(stats.maxOutputWrite || 0, chunk.data.length);
              if (writeOutput) {
                await writeOutput(chunk.data, {
                  position: chunk.position,
                  randomAccessPoints,
                  randomAccessGuardSeconds: stats.videoReorderGuardSeconds || 0
                });
              } else {
                for (let i = 0; i < chunk.data.length; i += 256 * 1024) {
                  await write(chunk.data.subarray(i, i + 256 * 1024), {
                    writeBytes: chunk.data.length,
                    first: i === 0,
                    last: i + 256 * 1024 >= chunk.data.length,
                    randomAccessPoints: i === 0 ? randomAccessPoints : undefined,
                    randomAccessGuardSeconds:
                      i === 0 ? stats.videoReorderGuardSeconds || 0 : undefined
                  });
                }
              }
              outputPosition += chunk.data.length;
              stats.outputBytes = outputPosition;
              if (firstMedia) stamp("firstMediaWrittenMs");
            } finally {
              drained();
            }
          }
        })
      )
    });
    output.addVideoTrack(vout);
    output.addAudioTrack(aout);
    await output.start();
    let firstV = true,
      firstA = true;
    while (vp || ap) {
      await outputDrained;
      await beforePacket?.();
      if (signal.aborted) throw Error("cancelled");
      const isV = !!vp && (!ap || vp.timestamp <= ap.timestamp);
      const packet = isV ? vp : ap;
      pendingBytes += packet.byteLength;
      stats.pendingPacketBytes = pendingBytes;
      stats.maxPendingPackets = Math.max(stats.maxPendingPackets || 0, pendingBytes);
      if (pendingBytes > MAX_PENDING_PACKET_BYTES) throw Error("fragment-packet-budget");
      stats.packets = (stats.packets || 0) + 1;
      if (isV) {
        await vout.add(packet, firstV ? { decoderConfig: vc } : undefined);
        firstV = false;
        vp = await vs.getNextPacket(vp);
        if (!vp) vout.close();
      } else {
        await aout.add(packet, firstA ? { decoderConfig: ac } : undefined);
        firstA = false;
        ap = await as.getNextPacket(ap);
        if (!ap) aout.close();
      }
    }
    await output.finalize();
    return stats;
  } catch (e) {
    await output?.cancel().catch(() => {});
    throw e;
  } finally {
    input.dispose();
  }
}
