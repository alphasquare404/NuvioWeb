// Shared file facts for native server ffprobe and client ffprobe WASM.
export function probeCodecString(video = {}) {
  // ffprobe's hex dump has an offset and an ASCII column; only consume hex bytes.
  const bytes = Uint8Array.from(
    String(video.extradata || "")
      .split("\n")
      .flatMap((line) => {
        const hex = /^\s*[0-9a-f]+:\s+([0-9a-f ]+?)(?:\s{2,}|$)/i.exec(line)?.[1] || "";
        return hex.replace(/ /g, "").match(/../g) || [];
      }),
    (value) => parseInt(value, 16)
  );
  if (video.codec_name === "h264" && bytes.length >= 4 && bytes[0] === 1) {
    return `avc1.${Array.from(bytes.subarray(1, 4), (value) => value.toString(16).padStart(2, "0")).join("")}`;
  }
  if (video.codec_name === "hevc" && bytes.length >= 13 && bytes[0] === 1) {
    const space = ["", "A", "B", "C"][bytes[1] >> 6];
    const profile = bytes[1] & 31;
    let compatibility = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(2),
      reversed = 0;
    for (let i = 0; i < 32; i++) {
      reversed = reversed * 2 + (compatibility & 1);
      compatibility >>>= 1;
    }
    const constraints = [...bytes.subarray(6, 12)];
    while (constraints.length && constraints.at(-1) === 0) constraints.pop();
    const suffix = constraints
      .map((value) => value.toString(16).toUpperCase().padStart(2, "0"))
      .join(".");
    return `hvc1.${space}${profile}.${reversed.toString(16).toUpperCase()}.${bytes[1] & 32 ? "H" : "L"}${bytes[12]}${suffix ? `.${suffix}` : ""}`;
  }
  if (video.codec_name === "av1" && bytes.length >= 3 && bytes[0] === 0x81) {
    const depth = bytes[2] & 64 ? (bytes[2] & 32 ? 12 : 10) : 8;
    return `av01.${bytes[1] >> 5}.${String(bytes[1] & 31).padStart(2, "0")}${bytes[2] & 128 ? "H" : "M"}.${String(depth).padStart(2, "0")}`;
  }
  return "";
}

export function normalizeProbe(probeJson) {
  const streams = Array.isArray(probeJson?.streams) ? probeJson.streams : [];
  const video =
    streams.find(
      (stream) => stream?.codec_type === "video" && !stream?.disposition?.attached_pic
    ) || null;
  const audio = streams.find((stream) => stream?.codec_type === "audio") || null;
  const formatName = String(probeJson?.format?.format_name || "");

  const container = /^webm$/i.test(formatName)
    ? "webm"
    : /matroska/i.test(formatName)
      ? "mkv"
      : /mp4|mov/i.test(formatName)
        ? "mp4"
        : formatName
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean)[0] || "unknown";

  return {
    container,
    videoCodec: String(video?.codec_name || "unknown").toLowerCase(),
    // The MP4 tag on the video track, which is the difference between an HEVC file
    // Safari plays (`hvc1`, parameter sets in the sample description) and one it
    // refuses with no explanation (`hev1`, parameter sets in band). Codec alone
    // cannot answer that, and every x265 webrip is tagged the second way.
    // The MP4 tag on the video track, and only when it really is one. Matroska has
    // no four-character code and ffprobe reports `[0][0][0][0]`, which is not a tag
    // and would only confuse whatever reads this.
    videoTag: /^[a-z0-9]{4}$/.test(String(video?.codec_tag_string || "").toLowerCase())
      ? String(video.codec_tag_string).toLowerCase()
      : "",
    audioCodec: String(audio?.codec_name || "unknown").toLowerCase(),
    // The detail no browser API can answer: canPlayType says "aac yes", never "stereo only".
    audioChannels: Number(audio?.channels) || 0,
    // Every track, not just the first: a release can carry 5.1 and stereo side by side,
    // and whether a stereo track exists decides "play it" from "convert it".
    audioStreams: (Array.isArray(streams) ? streams : [])
      .map((stream, index) => ({ stream, index }))
      .filter((entry) => entry.stream?.codec_type === "audio")
      .map((entry, audioIndex) => ({
        index: audioIndex,
        codec: String(entry.stream?.codec_name || "unknown").toLowerCase(),
        channels: Number(entry.stream?.channels) || 0,
        sampleRate: Number(entry.stream?.sample_rate) || 0,
        profile: String(entry.stream?.profile || ""),
        language: String(entry.stream?.tags?.language || ""),
        default: entry.stream?.disposition?.default === 1
      })),
    codecString: probeCodecString(video || {}),
    videoProfile: String(video?.profile || ""),
    videoLevel: Number(video?.level) > 0 ? Number(video.level) : 0,
    pixelFormat: String(video?.pix_fmt || ""),
    bitDepth:
      Number(video?.bits_per_raw_sample) || /p(10|12|16)/.exec(video?.pix_fmt || "")?.[1] * 1 || 0,
    frameRate: (() => {
      const [n, d = 1] = String(video?.avg_frame_rate || video?.r_frame_rate || "0")
        .split("/")
        .map(Number);
      return d > 0 && Number.isFinite(n / d) ? n / d : 0;
    })(),
    videoBitrate: Number(video?.bit_rate) || 0,
    colorTransfer: String(video?.color_transfer || ""),
    colorPrimaries: String(video?.color_primaries || ""),
    hasAudio: Boolean(audio),
    width: Number(video?.width) || 0,
    height: Number(video?.height) || 0,
    durationSeconds: Number(probeJson?.format?.duration) || 0
  };
}
