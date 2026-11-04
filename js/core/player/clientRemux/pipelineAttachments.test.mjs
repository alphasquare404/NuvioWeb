import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import {
  Input,
  ALL_FORMATS,
  BufferSource,
  Output,
  BufferTarget,
  MkvOutputFormat,
  AttachedFile,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  EncodedAudioPacketSource
} from "mediabunny";
import { remux as originalRemux } from "./pipeline.mjs";
import { remuxLibraryPolicy } from "../../../../scripts/remuxLibraryPolicy.mjs";

test("remux worker skips a large MKV font without lifting read/cache limits or changing packets", async () => {
  const fixture = await readFile(new URL("../fixtures/probe-dual-audio.mkv", import.meta.url));
  const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(fixture) });
  const v = await input.getPrimaryVideoTrack(),
    a = (await input.getAudioTracks())[0];
  const target = new BufferTarget(),
    output = new Output({ target, format: new MkvOutputFormat() });
  const vs = new EncodedVideoPacketSource(v.codec),
    as = new EncodedAudioPacketSource(a.codec);
  output.addVideoTrack(vs, { frameRate: 24 });
  output.addAudioTrack(as);
  output.setMetadataTags({
    raw: { 12345: new AttachedFile(new Uint8Array(9 * 1024 * 1024), "font/ttf", "unused-font.ttf") }
  });
  await output.start();
  for await (const packet of new EncodedPacketSink(v).packets())
    await vs.add(packet, { decoderConfig: await v.getDecoderConfig() });
  vs.close();
  for await (const packet of new EncodedPacketSink(a).packets())
    await as.add(packet, { decoderConfig: await a.getDecoderConfig() });
  as.close();
  await output.finalize();
  const bytes = new Uint8Array(target.buffer);
  const fetcher = async (_url, options) => {
    const [, start, end] = /bytes=(\d+)-(\d+)/.exec(options.headers.Range);
    return new Response(bytes.slice(+start, +end + 1), {
      status: 206,
      headers: { "content-range": `bytes ${start}-${end}/${bytes.length}` }
    });
  };
  const args = {
    url: "fixture",
    signal: new AbortController().signal,
    fetcher,
    metadata: async () => {},
    write: async () => {}
  };
  await assert.rejects(
    originalRemux(args),
    /range-read-limit/,
    "unadapted pinned library must reproduce the large attachment read"
  );
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL("./pipeline.mjs", import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [remuxLibraryPolicy()]
  });
  const temporary = await mkdtemp(path.join(os.tmpdir(), "nuvio-attachment-test-"));
  const compiledFile = path.join(temporary, "pipeline.mjs");
  await writeFile(compiledFile, compiled.outputFiles[0].contents);
  const { remux } = await import(pathToFileURL(compiledFile).href);
  const stats = {},
    chunks = [];
  let info;
  try {
    await remux({
      ...args,
      stats,
      metadata: async (value) => {
        info = value;
      },
      write: async (bytes) => chunks.push(bytes.slice())
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  assert.ok(stats.bytes < 512 * 1024, "attachment payload must not be downloaded");
  assert.ok(stats.maxRead <= 8 * 1024 * 1024);
  const generated = new Input({ formats: ALL_FORMATS, source: new BufferSource(bytes) });
  const result = new Input({
    formats: ALL_FORMATS,
    source: new BufferSource(Buffer.concat(chunks))
  });
  const hashes = async (track, from = -Infinity) => {
    const values = [];
    for await (const packet of new EncodedPacketSink(track).packets())
      if (packet.timestamp >= from - 0.000001)
        values.push(createHash("sha256").update(packet.data).digest("hex"));
    return values;
  };
  try {
    assert.deepEqual(await hashes(await result.getPrimaryVideoTrack()), await hashes(v));
    assert.deepEqual(
      await hashes((await result.getAudioTracks())[0]),
      await hashes((await generated.getAudioTracks())[0], info.firstAudioTimestamp)
    );
  } finally {
    input.dispose();
    generated.dispose();
    result.dispose();
  }
});
