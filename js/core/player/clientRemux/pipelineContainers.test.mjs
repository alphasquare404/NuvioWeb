import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Input, BufferSource, ALL_FORMATS, EncodedPacketSink } from "mediabunny";
import { remux } from "./pipeline.mjs";

for (const [file, container, videoCodec, audioCodec, channels] of [
  ["probe-dual-audio.mp4", "MP4", "avc", "aac", 6],
  ["remux-hevc-eac3.mkv", "Matroska", "hevc", "eac3", 6],
  ["remux-vp9-opus.webm", "WebM", "vp9", "opus", 2]
])
  test(`client copy preserves packets from ${file}`, async () => {
    const bytes = await readFile(new URL("../fixtures/" + file, import.meta.url));
    const chunks = [];
    let info;
    await remux({
      url: "fixture",
      signal: new AbortController().signal,
      fetcher: async (_url, options) => {
        const [, a, b] = /bytes=(\d+)-(\d+)/.exec(options.headers.Range);
        return new Response(bytes.subarray(+a, +b + 1), {
          status: 206,
          headers: { "content-range": `bytes ${a}-${b}/${bytes.length}` }
        });
      },
      metadata: async (value) => {
        info = value;
      },
      write: async (bytes) => chunks.push(bytes.slice())
    });
    assert.equal(info.sourceContainer, container);
    assert.equal(info.sourceSizeBytes, bytes.length);
    assert.equal(info.video, videoCodec);
    assert.equal(info.audio, audioCodec);
    assert.equal(info.channels, channels);
    const source = new Input({ formats: ALL_FORMATS, source: new BufferSource(bytes) });
    const output = new Input({
      formats: ALL_FORMATS,
      source: new BufferSource(Buffer.concat(chunks))
    });
    const hashes = async (track) => {
      const result = [];
      for await (const packet of new EncodedPacketSink(track).packets())
        result.push(createHash("sha256").update(packet.data).digest("hex"));
      return result;
    };
    try {
      assert.deepEqual(
        await hashes(await output.getPrimaryVideoTrack()),
        await hashes(await source.getPrimaryVideoTrack())
      );
      assert.deepEqual(
        await hashes((await output.getAudioTracks())[0]),
        await hashes((await source.getAudioTracks())[0])
      );
    } finally {
      source.dispose();
      output.dispose();
    }
  });
