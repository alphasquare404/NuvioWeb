import { CustomVideoDecoder, registerDecoder, VideoSample } from "mediabunny";

const codecs = ["avc", "hevc", "vp8", "vp9", "av1"];
const formats = [
  "I420",
  "I422",
  "I444",
  "I420P10",
  "I422P10",
  "I444P10",
  "I420P12",
  "I422P12",
  "I444P12"
];
const primaries = { 1: "bt709", 5: "bt470bg", 6: "smpte170m", 9: "bt2020", 12: "smpte432" };
const transfers = {
  1: "bt709",
  6: "smpte170m",
  8: "linear",
  13: "iec61966-2-1",
  16: "pq",
  18: "hlg"
};
const matrices = { 1: "bt709", 5: "bt470bg", 6: "smpte170m", 9: "bt2020-ncl" };
const timeScale = 1_000_000;
const missingTimestamp = -(2 ** 63);
const decodeError = (stage, code) =>
  Object.assign(Error("client-transcode-software-video-decode-failed"), {
    softwareVideoStage: stage,
    softwareVideoCode: code
  });
let modulePromise;
let supportedFormats;

function browserVideoFormats() {
  // Safari versions differ in which raw YUV layouts their VideoFrame accepts.
  // The decoder converts unsupported layouts to an accepted planar format.
  supportedFormats ??= formats.reduce((mask, format, index) => {
    try {
      const pixelBytes = index < 3 ? 1 : 2;
      const length = [6, 8, 12][index % 3] * pixelBytes;
      new VideoFrame(new Uint8Array(length), {
        format,
        codedWidth: 2,
        codedHeight: 2,
        timestamp: 0
      }).close();
      return mask | (1 << index);
    } catch {
      return mask;
    }
  }, 1);
  return supportedFormats;
}

async function loadModule() {
  const base = new URL("./", import.meta.url);
  const { default: initialize } = await import(new URL("software-video.js", base).href);
  return initialize({ locateFile: (file) => new URL(file, base).href });
}

class SoftwareVideoDecoder extends CustomVideoDecoder {
  static supports(codec) {
    return codecs.includes(codec);
  }

  async init() {
    const { description } = this.config;
    let configBytes;
    if (description) {
      configBytes = ArrayBuffer.isView(description)
        ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
        : new Uint8Array(description);
    }
    const module = (this.module = await modulePromise);
    const size = configBytes?.byteLength || 0;
    const pointer = size ? module._malloc(size) : 0;
    try {
      if (size && !pointer) throw decodeError("config-allocation");
      if (size) module.HEAPU8.set(configBytes, pointer);
      this.handle = module._decoder_open(codecs.indexOf(this.codec), pointer, size);
      if (!this.handle) throw decodeError("open");
    } finally {
      module._free(pointer);
    }
  }

  decode(packet) {
    const { module, handle } = this;
    const pointer = module._decoder_packet(handle, packet.data.length);
    if (!pointer) throw decodeError("packet-allocation");
    module.HEAPU8.set(packet.data, pointer);
    const result = module._decoder_send(
      handle,
      Math.round(packet.timestamp * timeScale),
      Math.round(packet.duration * timeScale),
      packet.type === "key" ? 1 : 0
    );
    if (result < 0) throw decodeError("send", result);
    this.emitFrames();
  }

  emitFrames() {
    const { module, handle } = this;
    let result;
    while ((result = module._decoder_receive(handle, browserVideoFormats())) > 0) {
      const info = module._decoder_info(handle) / Int32Array.BYTES_PER_ELEMENT;
      const [
        width,
        height,
        formatIndex,
        yStride,
        uvStride,
        size,
        primary,
        transfer,
        matrix,
        range,
        pointer
      ] = module.HEAP32.subarray(info, info + 11);
      const timestamp = module._decoder_timestamp(handle);
      if (timestamp === missingTimestamp) throw decodeError("timestamp");
      const chromaHeight = formatIndex % 3 === 0 ? Math.ceil(height / 2) : height;
      const uOffset = yStride * height;
      this.onSample(
        new VideoSample(module.HEAPU8.slice(pointer, pointer + size), {
          format: formats[formatIndex],
          codedWidth: width,
          codedHeight: height,
          timestamp: timestamp / timeScale,
          duration: Math.max(0, module._decoder_duration(handle)) / timeScale,
          layout: [
            { offset: 0, stride: yStride },
            { offset: uOffset, stride: uvStride },
            { offset: uOffset + uvStride * chromaHeight, stride: uvStride }
          ],
          colorSpace: {
            primaries: primaries[primary] ?? null,
            transfer: transfers[transfer] ?? null,
            matrix: matrices[matrix] ?? null,
            fullRange: range === 0 ? null : range === 2
          },
          _doNotCopy: true
        })
      );
    }
    if (result < 0) {
      const stage = ["decode-frame", "convert-pixels", "copy-pixels"][
        module._decoder_receive_stage(handle)
      ];
      throw decodeError(stage, result);
    }
  }

  flush() {
    const result = this.module._decoder_drain(this.handle);
    if (result < 0) throw decodeError("drain", result);
    this.emitFrames();
    this.module._decoder_reset(this.handle);
  }

  close() {
    if (this.handle) this.module._decoder_close(this.handle);
    this.handle = 0;
  }
}

export async function registerSoftwareVideoDecoder(codec) {
  if (!SoftwareVideoDecoder.supports(codec)) return;
  // Validate that WASM can load before Mediabunny reports this track decodable.
  try {
    modulePromise ??= loadModule();
    await modulePromise;
  } catch {
    throw Error("client-transcode-software-video-decoder-unavailable");
  }
  registerDecoder(SoftwareVideoDecoder);
}
