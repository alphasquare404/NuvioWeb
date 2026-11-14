import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { ALL_FORMATS, BufferSource, EncodedPacketSink, Input } from "mediabunny";
import {
  chooseClientAudioEncoding,
  chooseClientVideoEncoding,
  transcodeInput
} from "./transcodePipeline.mjs";

const dimensions = ({ width, height }) => [width, height];

test("client transcode preserves supported source size up to UHD without upscaling", async () => {
  const supports = async () => true;
  assert.deepEqual(dimensions(await chooseClientVideoEncoding(640, 360, supports)), [640, 360]);
  assert.deepEqual(dimensions(await chooseClientVideoEncoding(1920, 1080, supports)), [1920, 1080]);
  assert.deepEqual(dimensions(await chooseClientVideoEncoding(3840, 2160, supports)), [3840, 2160]);
  assert.deepEqual(dimensions(await chooseClientVideoEncoding(7680, 4320, supports)), [3840, 2160]);
  assert.deepEqual(dimensions(await chooseClientVideoEncoding(2160, 3840, supports)), [2160, 3840]);
});

test("client transcode only steps down when the device rejects the larger configuration", async () => {
  const attempts = [];
  const result = await chooseClientVideoEncoding(3840, 2160, async (codec, config) => {
    assert.equal(codec, "avc");
    attempts.push(config);
    return config.height <= 1080;
  });
  assert.deepEqual(attempts.map(dimensions), [
    [3840, 2160],
    [2560, 1440],
    [1920, 1080]
  ]);
  assert.deepEqual(dimensions(result), [1920, 1080]);
  assert.ok(attempts[0].bitrate > result.bitrate);
  assert.equal(await chooseClientVideoEncoding(640, 360, async () => false), null);
});

test("client video transcode tries a playable alternate codec before shrinking", async () => {
  const result = await chooseClientVideoEncoding(
    3840,
    2160,
    async (codec, { width }) => codec === "vp9" && width === 3840,
    ["avc", "vp9"]
  );
  assert.equal(result.codec, "vp9");
  assert.deepEqual(dimensions(result), [3840, 2160]);
});

test("Audio Transcode routes compatible surround audio through packet copy without an audio decoder", async () => {
  const source = new Input({
    formats: ALL_FORMATS,
    source: new BufferSource(
      await readFile(new URL("../fixtures/remux-hevc-eac3.mkv", import.meta.url))
    )
  });
  const [track] = await source.getAudioTracks();
  track.canDecode = async () => {
    throw Error("Packet copy should not need an audio decoder");
  };
  const chunks = [];
  let info;
  let checkedSurround;
  try {
    await transcodeInput({
      input: source,
      start: 0.5,
      audioIndex: 0,
      audioOnly: true,
      stats: {},
      signal: new AbortController().signal,
      supportsOutput: async ({ mime, audio }) => {
        if (audio) checkedSurround = audio;
        return mime.includes("hvc1") && (!audio || mime.includes("ec-3"));
      },
      metadata: async (value) => {
        info = value;
      },
      write: async (chunk) => chunks.push(chunk.slice())
    });
    assert.equal(info.processing, "remux");
    assert.equal(info.audio, "eac3");
    assert.equal(checkedSurround.channels, "6");
    const output = new Input({
      formats: ALL_FORMATS,
      source: new BufferSource(Buffer.concat(chunks))
    });
    try {
      const [copied] = await output.getAudioTracks();
      const originalPacket = await new EncodedPacketSink(track).getFirstPacket();
      const copiedPacket = await new EncodedPacketSink(copied).getFirstPacket();
      assert.deepEqual(copiedPacket.data, originalPacket.data);
    } finally {
      output.dispose();
    }
  } finally {
    source.dispose();
  }
});

test("audio encoding can fall back to FLAC when the browser rejects both AAC and Opus", async () => {
  const result = await chooseClientAudioEncoding(
    { getNumberOfChannels: async () => 2 },
    "avc1.4d401f",
    async ({ mime }) => mime.includes("flac"),
    async (codec) => codec === "flac"
  );
  assert.equal(result?.codec, "flac");
  assert.equal(result.numberOfChannels, 2);
});
