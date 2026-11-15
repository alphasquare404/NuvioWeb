const loadSoftwareAudioDecoder = () =>
  import("./softwareAudioDecoder.mjs").then(({ registerSoftwareAudioDecoder }) =>
    registerSoftwareAudioDecoder()
  );

const audioDecoders = {
  aac: loadSoftwareAudioDecoder,
  opus: loadSoftwareAudioDecoder,
  mp3: loadSoftwareAudioDecoder,
  vorbis: loadSoftwareAudioDecoder,
  flac: loadSoftwareAudioDecoder,
  ac3: () => import("@mediabunny/ac3").then(({ registerAc3Decoder }) => registerAc3Decoder()),
  eac3: () => import("@mediabunny/ac3").then(({ registerAc3Decoder }) => registerAc3Decoder()),
  dts: () => import("@mediabunny/dts").then(({ registerDtsDecoder }) => registerDtsDecoder()),
  truehd: () =>
    import("@mediabunny/truehd").then(({ registerTrueHdDecoder }) => registerTrueHdDecoder())
};

export function hasSoftwareAudioDecoder(codec) {
  return Boolean(audioDecoders[codec]);
}

export async function ensureAudioDecoder(track) {
  if (await track.canDecode()) return true;
  await audioDecoders[await track.getCodec()]?.();
  return track.canDecode();
}

export async function ensureVideoDecoder(track, onSoftware = () => {}) {
  if (await track.canDecode()) return true;
  onSoftware();
  const codec = await track.getCodec();
  if (codec === "prores") {
    const { registerProresDecoder } = await import("@mediabunny/prores");
    registerProresDecoder();
  } else if (codec) {
    const { registerSoftwareVideoDecoder } = await import("./softwareVideoDecoder.mjs");
    await registerSoftwareVideoDecoder(codec);
  }
  return track.canDecode();
}
