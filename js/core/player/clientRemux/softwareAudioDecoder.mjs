import { AudioSample, CustomAudioDecoder, registerDecoder } from "mediabunny";

const libavCodecs = { opus: "libopus", mp3: "mp3", vorbis: "libvorbis", flac: "flac" };
const timestampUnits = 1_000_000;

// FAAD2 orders the fronts L/C/R and puts LFE last. Mediabunny takes SMPTE order.
const aacChannelOrder = {
  3: [0, 2, 1],
  4: [0, 2, 1, 3],
  5: [0, 2, 1, 3, 4],
  6: [0, 2, 1, 5, 3, 4],
  7: [0, 2, 1, 6, 5, 3, 4],
  8: [0, 2, 1, 7, 5, 6, 3, 4]
};

function joinPlanes(planes, order = null) {
  const samples = planes[0].length;
  const joined = new planes[0].constructor(samples * planes.length);
  for (let channel = 0; channel < planes.length; channel++)
    joined.set(planes[order?.[channel] ?? channel], channel * samples);
  return joined;
}

function decoderDescription(config, codec) {
  const buffer = config.description;
  if (!buffer) return undefined;
  const bytes = ArrayBuffer.isView(buffer)
    ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    : new Uint8Array(buffer);
  // WebCodecs FLAC descriptions contain the marker and the STREAMINFO block header.
  if (
    codec === "flac" &&
    bytes.length >= 42 &&
    bytes[0] === 0x66 &&
    bytes[1] === 0x4c &&
    bytes[2] === 0x61 &&
    bytes[3] === 0x43
  )
    return bytes.subarray(8, 42);
  return bytes;
}

class SoftwareAudioDecoder extends CustomAudioDecoder {
  static supports(codec, config) {
    const channels = config.numberOfChannels;
    return (
      (codec === "aac" || Object.hasOwn(libavCodecs, codec)) &&
      Number.isInteger(channels) &&
      channels > 0 &&
      channels <= 8
    );
  }

  async init() {
    const description = decoderDescription(this.config, this.codec);
    if (this.codec === "aac") {
      const { AACDecoder } = await import("@wasm-audio-decoders/aac");
      this.aac = new AACDecoder({ audioSpecificConfig: description });
      await this.aac.ready;
      return;
    }
    const { default: LibAV } = await import("@libav.js/variant-obsolete");
    this.libav = LibAV;
    const av = (this.av = await LibAV.LibAV({
      noworker: true,
      nothreads: true,
      toImport: new URL("./libav-audio-factory.js", import.meta.url).href,
      wasmurl: new URL("./libav-audio.wasm", import.meta.url).href
    }));
    try {
      const decoder = libavCodecs[this.codec];
      const descriptor = await av.avcodec_descriptor_get_by_name(this.codec);
      if (!descriptor) throw Error("client-transcode-audio-decode-unsupported");
      const [, context, packet, frame] = await av.ff_init_decoder(decoder, {
        time_base: [1, timestampUnits],
        codecpar: {
          codec_type: av.AVMEDIA_TYPE_AUDIO,
          codec_id: await av.AVCodecDescriptor_id(descriptor),
          format: -1,
          channels: this.config.numberOfChannels,
          sample_rate: this.config.sampleRate,
          extradata: description
        }
      });
      this.handles = [context, packet, frame];
    } catch (error) {
      av.terminate();
      this.av = null;
      throw error;
    }
  }

  async decode(packet) {
    try {
      if (this.aac) {
        const decoded = await this.aac.decodeFrames([packet.data]);
        if (decoded.errors.length) throw Error("aac-packet-error");
        if (!decoded.samplesDecoded) return;
        this.onSample(
          new AudioSample({
            data: joinPlanes(decoded.channelData, aacChannelOrder[decoded.channelData.length]),
            format: "f32-planar",
            numberOfChannels: decoded.channelData.length,
            sampleRate: decoded.sampleRate,
            timestamp: packet.timestamp
          })
        );
        return;
      }
      const [pts, ptshi] = this.libav.f64toi64(Math.round(packet.timestamp * timestampUnits));
      const frames = await this.av.ff_decode_multi(...this.handles, [
        {
          data: packet.data,
          pts,
          ptshi,
          dts: pts,
          dtshi: ptshi,
          time_base_num: 1,
          time_base_den: timestampUnits
        }
      ]);
      this.emitFrames(frames, packet.timestamp);
    } catch {
      throw Error("client-transcode-software-audio-decode-failed");
    }
  }

  emitFrames(frames, fallbackTimestamp) {
    const av = this.av;
    const formats = {
      [av.AV_SAMPLE_FMT_U8]: "u8",
      [av.AV_SAMPLE_FMT_U8P]: "u8-planar",
      [av.AV_SAMPLE_FMT_S16]: "s16",
      [av.AV_SAMPLE_FMT_S16P]: "s16-planar",
      [av.AV_SAMPLE_FMT_S32]: "s32",
      [av.AV_SAMPLE_FMT_S32P]: "s32-planar",
      [av.AV_SAMPLE_FMT_FLT]: "f32",
      [av.AV_SAMPLE_FMT_FLTP]: "f32-planar"
    };
    for (const frame of frames) {
      const format = formats[frame.format];
      if (!format) throw Error("client-transcode-software-audio-decode-failed");
      const pts = this.libav.i64tof64(frame.pts, frame.ptshi);
      const timestamp =
        Number.isFinite(pts) && Math.abs(pts) < Number.MAX_SAFE_INTEGER
          ? (pts * (frame.time_base_num || 1)) / (frame.time_base_den || timestampUnits)
          : (this.nextTimestamp ?? fallbackTimestamp);
      this.onSample(
        new AudioSample({
          data: Array.isArray(frame.data) ? joinPlanes(frame.data) : frame.data,
          format,
          numberOfChannels: frame.channels || this.config.numberOfChannels,
          sampleRate: frame.sample_rate || this.config.sampleRate,
          timestamp
        })
      );
      this.nextTimestamp =
        timestamp + frame.nb_samples / (frame.sample_rate || this.config.sampleRate);
    }
  }

  async flush() {
    if (this.av) {
      this.emitFrames(await this.av.ff_decode_multi(...this.handles, [], true), 0);
      await this.av.avcodec_flush_buffers(this.handles[0]);
    }
    if (this.aac) await this.aac.reset();
    this.nextTimestamp = undefined;
  }

  async close() {
    if (this.aac) this.aac.free();
    if (this.av) {
      try {
        if (this.handles) await this.av.ff_free_decoder(...this.handles);
      } finally {
        this.av.terminate();
      }
    }
  }
}

export function registerSoftwareAudioDecoder() {
  registerDecoder(SoftwareAudioDecoder);
}
