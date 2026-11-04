import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Input, BufferSource, MATROSKA, MP4, EncodedPacketSink } from "mediabunny";
import { remux } from "./pipeline.mjs";
test("resume carries selected stereo audio from video keyframe without changing encoded packets or requested time", async () => {
  const fixture = await readFile(new URL("../fixtures/probe-dual-audio.mkv", import.meta.url)),
    chunks = [];
  let info;
  const fetcher = async (_url, options) => {
    const match = /bytes=(\d+)-(\d+)/.exec(options.headers.Range);
    return new Response(fixture.subarray(+match[1], +match[2] + 1), {
      status: 206,
      headers: { "content-range": "bytes " + match[1] + "-" + match[2] + "/" + fixture.length }
    });
  };
  await remux({
    url: "fixture",
    start: 0.7,
    audioIndex: 1,
    signal: new AbortController().signal,
    fetcher,
    metadata: async (value) => (info = value),
    write: async (bytes) => chunks.push(bytes.slice())
  });
  assert.equal(info.requested, 0.7);
  assert.equal(info.audioIndex, 1);
  assert.equal(info.channels, 2);
  assert.ok(info.start < 0.7);
  assert.ok(
    info.firstAudioTimestamp <= info.start + 0.03,
    "audio preroll must cover the video keyframe, not start only at the requested playhead"
  );
  const input = new Input({ formats: [MATROSKA], source: new BufferSource(fixture) }),
    output = new Input({ formats: [MP4], source: new BufferSource(Buffer.concat(chunks)) });
  const hashes = async (track, from = -Infinity) => {
    const result = [];
    for await (const packet of new EncodedPacketSink(track).packets())
      if (packet.timestamp >= from - 0.000001)
        result.push(createHash("sha256").update(packet.data).digest("hex"));
    return result;
  };
  try {
    assert.deepEqual(
      await hashes((await output.getAudioTracks())[0]),
      await hashes((await input.getAudioTracks())[1], info.firstAudioTimestamp)
    );
    assert.deepEqual(
      await hashes(await output.getPrimaryVideoTrack()),
      await hashes(await input.getPrimaryVideoTrack())
    );
  } finally {
    input.dispose();
    output.dispose();
  }
});
