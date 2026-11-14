import {
  canEncodeAudio,
  canEncodeVideo,
  Conversion,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
  StreamTarget
} from "mediabunny";
import { MAX_COMPRESSED_BYTES } from "./bufferBudget.mjs";
import { boxes, IO_BYTES, MAX_INIT_BYTES } from "./mediaFragments.mjs";
import { readVideoFragmentTiming, readVideoTrackTiming } from "./fragmentTiming.mjs";
import {
  ensureAudioDecoder,
  ensureVideoDecoder,
  hasSoftwareAudioDecoder
} from "./decoderSupport.mjs";

const videoCodecParameters = {
  avc: "avc1.4d401f",
  hevc: "hvc1.1.6.L93.B0",
  av1: "av01.0.08M.08",
  vp9: "vp09.00.41.08"
};
const audioCodecParameters = { aac: "mp4a.40.2", opus: "opus", flac: "flac", mp3: "mp3" };
// The pinned MP4 muxer writes HEVC sample entries with the hvc1 tag.
const mp4VideoParameter = (codec) => codec?.replace(/^hev1(?=\.)/, "hvc1");
const mimeType = (kind, ...codecs) =>
  kind + '/mp4; codecs="' + codecs.filter(Boolean).join(",") + '"';

export async function chooseClientAudioEncoding(
  track,
  videoParameter,
  supportsOutput,
  canEncode = canEncodeAudio
) {
  const channels = await track.getNumberOfChannels();
  const sampleRate = 48000;
  const channelChoices = channels > 2 ? [channels, 2] : [channels === 1 ? 1 : 2];
  for (const numberOfChannels of channelChoices) {
    const bitrate = numberOfChannels === 1 ? 96_000 : numberOfChannels === 2 ? 128_000 : 320_000;
    const options = { numberOfChannels, sampleRate, bitrate };
    for (const [codec, parameter] of Object.entries(audioCodecParameters)) {
      const audio =
        numberOfChannels > 2
          ? {
              contentType: mimeType("audio", parameter),
              channels: String(numberOfChannels),
              samplerate: sampleRate,
              bitrate
            }
          : undefined;
      if (!(await supportsOutput({ mime: mimeType("video", videoParameter, parameter), audio })))
        continue;
      if (await canEncode(codec, options)) return { codec, ...options };
      if (codec === "aac" && numberOfChannels <= 8) {
        const { registerAacEncoder } = await import("@mediabunny/aac-encoder");
        registerAacEncoder();
        if (await canEncode(codec, options)) return { codec, ...options };
      }
    }
  }
  return null;
}

async function inspectClientAudioCopy(track, format, codec, videoParameter, supportsOutput) {
  if (!track || !format.getSupportedAudioCodecs().includes(codec)) return null;
  const [parameter, numberOfChannels, sampleRate, bitrate] = await Promise.all([
    track.getCodecParameterString(),
    track.getNumberOfChannels(),
    track.getSampleRate(),
    track.getBitrate()
  ]);
  if (!parameter) return null;
  const supported = await supportsOutput({
    mime: mimeType("video", videoParameter, parameter),
    audio:
      numberOfChannels > 2
        ? {
            contentType: mimeType("audio", parameter),
            channels: String(numberOfChannels),
            samplerate: sampleRate,
            bitrate: bitrate || 320000
          }
        : undefined
  });
  return supported ? { codec, numberOfChannels, sampleRate } : null;
}

// Start at source size within UHD. Smaller tiers are only tried when the
// encoder rejects the dimensions, and retain the source aspect ratio.
export async function chooseClientVideoEncoding(
  sourceWidth,
  sourceHeight,
  canEncode = canEncodeVideo,
  codecs = ["avc"]
) {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth < 2 ||
    sourceHeight < 2
  )
    return null;
  const portrait = sourceHeight > sourceWidth;
  const even = (value) => Math.floor(value / 2) * 2;
  let previousSize = "";
  for (const shortEdge of [2160, 1440, 1080, 720, 480, 360]) {
    const longEdge = (shortEdge * 16) / 9;
    const maxWidth = portrait ? shortEdge : longEdge;
    const maxHeight = portrait ? longEdge : shortEdge;
    const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
    const width = even(sourceWidth * scale);
    const height = even(sourceHeight * scale);
    if (width < 2 || height < 2) break;
    const size = width + "x" + height;
    if (size === previousSize) continue;
    previousSize = size;
    const bitrate = Math.max(350_000, Math.round((2_500_000 * width * height) / (1280 * 720)));
    for (const codec of codecs) {
      if (await canEncode(codec, { width, height, bitrate }))
        return { codec, width, height, bitrate };
    }
  }
  return null;
}

// Conversion trims each seek to zero. MSE applies the matching timestamp offset
// so progress, subtitles and seek retain the source's absolute timeline.
export async function transcodeInput({
  input,
  start,
  audioIndex,
  signal,
  stats,
  metadata,
  write,
  supportsOutput = async () => true,
  beforeEncode = async () => {},
  audioOnly = false
}) {
  stats.pipelinePhase = "transcode-track-discovery";
  const video = await input.getPrimaryVideoTrack();
  const audioTracks = await input.getAudioTracks();
  const audio = audioTracks[audioIndex];
  stats.sourceVideo = await video?.getCodec();
  stats.sourceAudio = await audio?.getCodec();
  stats.audioTrackCount = audioTracks.length;
  stats.audioIndex = audioIndex;
  stats.pipelinePhase = "transcode-codec-check";
  if (audioTracks.length > 32) throw Error("audio-track-limit");
  if (!video || (audioTracks.length && !audio) || (audioOnly && !audio))
    throw Error("transcode-track-unavailable");
  const duration = await input.getDurationFromMetadata();
  if (!Number.isFinite(duration) || duration <= start) throw Error("duration-unavailable");

  if (!audioOnly) {
    stats.videoDecoder = "native";
    if (
      !(await ensureVideoDecoder(video, () => {
        stats.videoDecoder = "software";
      }))
    )
      throw Error("client-transcode-video-decode-unsupported");
  }

  const format = new Mp4OutputFormat({ fastStart: "fragmented", minimumFragmentDuration: 1 });
  let videoParameter;
  let encoding = null;
  let audioCopy = null;
  let audioEncoding = null;
  let audioDecoderReady;
  const copyChecks = new Map();
  const inspectAudioCopy = (parameter) => {
    if (!copyChecks.has(parameter)) {
      copyChecks.set(
        parameter,
        inspectClientAudioCopy(audio, format, stats.sourceAudio, parameter, supportsOutput)
      );
    }
    return copyChecks.get(parameter);
  };
  const prepareAudioEncoding = async (parameter) => {
    if (!audio) return null;
    audioDecoderReady ??= ensureAudioDecoder(audio);
    if (!(await audioDecoderReady)) return null;
    return chooseClientAudioEncoding(audio, parameter, supportsOutput);
  };
  const audioPlans = new Map();
  const planAudio = async (parameter) => {
    if (!audioPlans.has(parameter)) {
      const copy = await inspectAudioCopy(parameter);
      audioPlans.set(parameter, {
        copy,
        encoding: copy ? null : await prepareAudioEncoding(parameter)
      });
    }
    return audioPlans.get(parameter);
  };
  if (audioOnly) {
    videoParameter = mp4VideoParameter(await video.getCodecParameterString());
    if (
      !format.getSupportedVideoCodecs().includes(stats.sourceVideo) ||
      !videoParameter ||
      !(await supportsOutput({ mime: mimeType("video", videoParameter) }))
    )
      throw Error("client-transcode-video-copy-unsupported");
    const plan = await planAudio(videoParameter);
    audioCopy = plan.copy;
    audioEncoding = plan.encoding;
  } else {
    const withAudioCopy = [];
    const otherCodecs = [];
    for (const [codec, parameter] of Object.entries(videoCodecParameters)) {
      if (!(await supportsOutput({ mime: mimeType("video", parameter) }))) continue;
      const copy = await inspectAudioCopy(parameter);
      (copy ? withAudioCopy : otherCodecs).push(codec);
    }
    const codecs = [...withAudioCopy, ...otherCodecs];
    let rejectedAudio = false;
    if (codecs.length)
      encoding = await chooseClientVideoEncoding(
        await video.getDisplayWidth(),
        await video.getDisplayHeight(),
        async (codec, options) => {
          if (!(await canEncodeVideo(codec, options))) return false;
          if (!audio) return true;
          const plan = await planAudio(videoCodecParameters[codec]);
          if (plan.copy || plan.encoding) return true;
          rejectedAudio = true;
          return false;
        },
        codecs
      );
    if (!encoding && !rejectedAudio) throw Error("client-transcode-codec-unsupported");
    if (!encoding) {
      throw Error(
        (await audioDecoderReady) === false
          ? "client-transcode-audio-decode-unsupported"
          : "client-transcode-audio-output-unavailable"
      );
    }
    videoParameter = videoCodecParameters[encoding.codec];
    if (audio) {
      const plan = audioPlans.get(videoParameter);
      audioCopy = plan.copy;
      audioEncoding = plan.encoding;
    }
  }
  const requireAudioOutput = async () => {
    if (!audio || audioCopy || audioEncoding) return;
    throw Error(
      (await audioDecoderReady) === false
        ? "client-transcode-audio-decode-unsupported"
        : "client-transcode-audio-output-unavailable"
    );
  };
  await requireAudioOutput();
  let trimStart = start;
  if (!audioOnly && audioCopy) {
    const packets = new EncodedPacketSink(audio);
    const preRoll = (await audio.getPreRollDuration()) || 0;
    const packet = await packets.getKeyPacket(start - preRoll, { verifyKeyPackets: true });
    // Include preroll when available. A delayed audio track can start after the video.
    if (packet && packet.timestamp <= start) trimStart = packet.timestamp;
  }

  const tracks = await Promise.all(
    audioTracks.map(async (track, index) => {
      try {
        const codec = await track.getCodec();
        const language = await track.getLanguageCode();
        return {
          id: String(track.id),
          index,
          label: String((await track.getName()) || language || "Audio " + (index + 1)).slice(
            0,
            256
          ),
          language,
          codec,
          channels: await track.getNumberOfChannels(),
          sampleRate: await track.getSampleRate(),
          supported: Boolean(
            (track.id === audio?.id && audioCopy) ||
            hasSoftwareAudioDecoder(codec) ||
            (await track.canDecode()) ||
            (await inspectClientAudioCopy(track, format, codec, videoParameter, supportsOutput))
          )
        };
      } catch {
        return { id: String(track.id), index, label: "Audio " + (index + 1), supported: false };
      }
    })
  );
  if (audioOnly) {
    const packets = new EncodedPacketSink(video);
    const key =
      (await packets.getKeyPacket(start, { verifyKeyPackets: true })) ||
      (await packets.getFirstKeyPacket({ verifyKeyPackets: true }));
    if (!key) throw Error("video-keyframe-unavailable");
    trimStart = key.timestamp;
  }
  const container = (await input.getFormat()).name;
  let initialized = false;
  let initBytes = 0;
  let position = 0;
  let videoTiming;
  const init = [];

  const append = async (data) => {
    const randomAccessPoints = [];
    let guard = 0;
    for (const box of boxes(data)) {
      if (box.type === "moov") videoTiming = readVideoTrackTiming(data.subarray(box.at, box.end));
      if (box.type !== "moof") continue;
      const timing = readVideoFragmentTiming(data.subarray(box.at, box.end), videoTiming);
      randomAccessPoints.push(
        ...timing.randomAccessPoints.map((time) => Math.max(0, time + trimStart))
      );
      guard = Math.max(guard, timing.reorderGuardSeconds);
    }
    for (let at = 0; at < data.length; at += IO_BYTES) {
      await write(data.subarray(at, at + IO_BYTES), {
        writeBytes: data.length,
        first: at === 0,
        last: at + IO_BYTES >= data.length,
        randomAccessPoints: at === 0 ? randomAccessPoints : undefined,
        randomAccessGuardSeconds: guard
      });
    }
  };
  let output;
  const createOutput = () =>
    new Output({
      format,
      target: new StreamTarget(
        new WritableStream({
          async write(chunk) {
            if (signal.aborted) throw Error("cancelled");
            if (chunk.position !== position || chunk.data.length > MAX_COMPRESSED_BYTES)
              throw Error("output-write-exceeds-buffer-budget");
            position += chunk.data.length;
            if (!initialized) {
              if (!boxes(chunk.data).some((box) => box.type === "moov")) {
                initBytes += chunk.data.length;
                if (initBytes > MAX_INIT_BYTES) throw Error("transcode-init-too-large");
                init.push(chunk.data.slice());
                return;
              }
              await metadata({
                audioIndex,
                audioTracks: tracks,
                sourceContainer: container,
                sourceSizeBytes: stats.size,
                duration,
                start: trimStart,
                requested: start,
                timestampOffset: trimStart,
                mime: (await output.getMimeType()).replace(/\bhev1(?=\.)/g, "hvc1"),
                processing: audioOnly && audioCopy ? "remux" : undefined,
                audioEncoded: Boolean(audioEncoding),
                video: audioOnly ? stats.sourceVideo : encoding.codec,
                audio: (audioCopy || audioEncoding)?.codec || null,
                channels: (audioCopy || audioEncoding)?.numberOfChannels || 0,
                sampleRate: (audioCopy || audioEncoding)?.sampleRate
              });
              initialized = true;
              for (const data of init.splice(0)) await append(data);
            }
            await append(chunk.data);
            stats.outputBytes = position;
          }
        })
      )
    });
  const initialize = () =>
    Conversion.init({
      input,
      output: (output = createOutput()),
      trim: { start: trimStart },
      copy: audioCopy
        ? { shiftTolerance: 0, boundaryPolicy: "shrink" }
        : audioOnly
          ? { shiftTolerance: 0 }
          : false,
      showWarnings: false,
      video: (track) =>
        track.id === video.id
          ? audioOnly
            ? {}
            : {
                ...encoding,
                forceTranscode: true,
                fit: "contain",
                keyFrameInterval: 1
              }
          : { discard: true },
      audio: (track) =>
        track.id === audio?.id
          ? audioCopy
            ? {}
            : { ...audioEncoding, forceTranscode: true }
          : { discard: true }
    });
  let conversion = await initialize();
  if (
    audioCopy &&
    !output.tracks.some((track) => track.source instanceof EncodedAudioPacketSource)
  ) {
    await conversion.cancel();
    audioCopy = null;
    if (!audioOnly) trimStart = start;
    audioEncoding = await prepareAudioEncoding(videoParameter);
    await requireAudioOutput();
    conversion = await initialize();
  }
  const discarded = conversion.discardedTracks.find(
    ({ track }) => track.id === video.id || track.id === audio?.id
  );
  if (
    !conversion.isValid ||
    discarded ||
    (audioOnly && !output.tracks.some((track) => track.source instanceof EncodedVideoPacketSource))
  ) {
    await output.cancel().catch(() => {});
    if (
      discarded?.reason === "undecodable_source_codec" ||
      discarded?.reason === "unknown_source_codec"
    ) {
      throw Error(
        discarded.track.id === audio?.id
          ? "client-transcode-audio-decode-unsupported"
          : "client-transcode-video-decode-unsupported"
      );
    }
    if (discarded?.reason === "no_encodable_target_codec") {
      throw Error(
        discarded.track.id === audio?.id
          ? "client-transcode-audio-output-unavailable"
          : "client-transcode-codec-unsupported"
      );
    }
    throw Error(
      audioOnly ? "client-transcode-video-copy-unsupported" : "client-transcode-codec-unsupported"
    );
  }
  stats.pipelinePhase = "transcode-output";
  try {
    // Yield at bounded output-time windows so the renderer can slow down the
    // encoder when playback is paused or already has enough buffered media.
    for (let until = 4; conversion.state !== "done"; until += 4) {
      if (signal.aborted) throw Error("cancelled");
      await beforeEncode();
      await conversion.execute({ until });
    }
    if (!initialized) throw Error("client-transcode-output-unavailable");
    return stats;
  } catch (error) {
    await conversion.cancel().catch(() => {});
    throw error;
  }
}
