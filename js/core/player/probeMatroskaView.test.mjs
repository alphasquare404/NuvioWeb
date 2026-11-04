import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
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
import { probeMatroskaPatches } from "./probeMatroskaView.js";
import { installProbeSparseFile } from "./probeSparseFile.js";
import { normalizeProbe } from "./probeMetadata.js";
const require = createRequire(import.meta.url);

test("real WASM probe skips an 18 MiB MKV font while preserving actual stream facts and input bytes", async (t) => {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BufferSource(
      readFileSync(new URL("./fixtures/probe-dual-audio.mkv", import.meta.url))
    )
  });
  t.after(() => input.dispose());
  const video = await input.getPrimaryVideoTrack(),
    audio = await input.getAudioTracks();
  const target = new BufferTarget(),
    output = new Output({ target, format: new MkvOutputFormat() });
  const sources = [
    new EncodedVideoPacketSource(video.codec),
    ...audio.map((a) => new EncodedAudioPacketSource(a.codec))
  ];
  output.addVideoTrack(sources[0], { frameRate: 24 });
  for (const source of sources.slice(1)) output.addAudioTrack(source);
  output.setMetadataTags({
    raw: { 12345: new AttachedFile(new Uint8Array(18 * 1024 * 1024), "font/ttf", "font.ttf") }
  });
  await output.start();
  for (const [i, track] of [video, ...audio].entries()) {
    for await (const packet of new EncodedPacketSink(track).packets())
      await sources[i].add(packet, { decoderConfig: await track.getDecoderConfig() });
    sources[i].close();
  }
  await output.finalize();
  const bytes = new Uint8Array(target.buffer),
    original = bytes.slice();
  const oldSelf = globalThis.self;
  globalThis.self = { location: { href: "file:///ffmpeg-core.js" } };
  t.after(() => {
    if (oldSelf === undefined) delete globalThis.self;
    else globalThis.self = oldSelf;
  });
  const core = await require("@ffmpeg/core")({
    wasmBinary: readFileSync(require.resolve("@ffmpeg/core/wasm"))
  });
  core.setLogger(() => {});
  async function probe(adapt) {
    const chunks = [{ start: 0, bytes: bytes.slice(0, 262144) }];
    let total = 262144,
      facts;
    for (let attempt = 0; attempt < 64; attempt++) {
      for (const path of ["/probe-input", "/result.json"])
        try {
          core.FS.unlink(path);
        } catch {}
      let missing = null;
      installProbeSparseFile(core.FS, {
        size: bytes.length,
        chunks,
        patches: adapt ? probeMatroskaPatches(bytes.length, chunks) : [],
        onMissing: (p) => {
          missing ??= p;
        }
      });
      core.reset();
      core.ffprobe(
        "-v",
        "error",
        "-analyzeduration",
        "1000000",
        "-probesize",
        "1048576",
        "-show_data",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        "-o",
        "/result.json",
        "/probe-input"
      );
      if (missing == null) {
        facts = normalizeProbe(JSON.parse(core.FS.readFile("/result.json", { encoding: "utf8" })));
        break;
      }
      const start = Math.floor(missing / 262144) * 262144;
      assert.equal(
        chunks.some((c) => c.start === start),
        false,
        "must make progress"
      );
      const block = bytes.slice(start, start + 262144);
      total += block.length;
      if (total > 13 * 1024 * 1024) return { total, limited: true };
      chunks.push({ start, bytes: block });
    }
    return { total, facts };
  }
  const before = await probe(false);
  assert.equal(before.limited, true, "unadapted probe must reproduce the byte limit");
  const after = await probe(true);
  assert.ok(after.facts, "adapted probe must finish");
  assert.equal(after.facts.videoCodec, "h264");
  assert.deepEqual(
    after.facts.audioStreams.map((a) => a.channels),
    [6, 2]
  );
  assert.equal(after.facts.width, 32);
  assert.ok(after.total < 1024 * 1024, `read ${after.total} bytes`);
  assert.deepEqual(bytes, original, "the source is never modified");
});

function element(id, payload) {
  const marker = 0x10000000 | payload.length;
  return Uint8Array.from([
    ...id,
    marker >>> 24,
    (marker >>> 16) & 255,
    (marker >>> 8) & 255,
    marker & 255,
    ...payload
  ]);
}
const concat = (...parts) => Uint8Array.from(parts.flatMap((p) => [...p]));
const ebml = element([0x1a, 0x45, 0xdf, 0xa3], []);
const attach = element([0x19, 0x41, 0xa4, 0x69], [1, 2, 3]);
const cluster = element([0x1f, 0x43, 0xb6, 0x75], attach);

test("Matroska view parses structure, leaves cluster payload untouched and rejects malformed/non-MKV input", () => {
  const file = concat(ebml, element([0x18, 0x53, 0x80, 0x67], concat(attach, cluster)));
  const parts = [
    { start: 0, bytes: file.slice(0, 7) },
    { start: 7, bytes: file.slice(7) }
  ];
  const patches = probeMatroskaPatches(file.length, parts);
  assert.equal(patches.length, 1);
  assert.equal(patches[0].bytes[0], 0xec);
  assert.equal(patches[0].bytes.length, 8);
  assert.deepEqual(probeMatroskaPatches(100, [{ start: 0, bytes: Uint8Array.of(0, 1, 2) }]), []);
  assert.deepEqual(probeMatroskaPatches(file.length - 1, parts), []);
  assert.deepEqual(probeMatroskaPatches(file.length, [{ start: 0, bytes: file.slice(0, 2) }]), []);
});

test("SeekHead permits skipping an attachment after the first cluster without scanning media", () => {
  const seekID = element([0x53, 0xab], [0x19, 0x41, 0xa4, 0x69]);
  const seekPosition = (pos) => element([0x53, 0xac], [pos]);
  const head = (pos) =>
    element([0x11, 0x4d, 0x9b, 0x74], element([0x4d, 0xbb], concat(seekID, seekPosition(pos))));
  const position = head(0).length + cluster.length;
  const file = concat(
    ebml,
    element([0x18, 0x53, 0x80, 0x67], concat(head(position), cluster, attach))
  );
  const patches = probeMatroskaPatches(file.length, [{ start: 0, bytes: file }]);
  assert.equal(patches.length, 1);
  assert.equal(patches[0].start, ebml.length + 8 + position);
});

test("metadata header overlays work across partial reads without inventing missing bytes", () => {
  let node;
  const FS = { root: {}, createNode: () => (node = {}), ErrnoError: class extends Error {} };
  const source = Uint8Array.of(1, 2, 3, 4);
  const missing = [];
  installProbeSparseFile(FS, {
    size: 8,
    chunks: [{ start: 0, bytes: source }],
    patches: [{ start: 1, bytes: Uint8Array.of(9, 8) }],
    onMissing: (at) => missing.push(at)
  });
  const buffer = new Uint8Array(5);
  assert.equal(node.stream_ops.read(null, buffer, 1, 3, 1), 3);
  assert.deepEqual([...buffer], [0, 9, 8, 4, 0]);
  assert.deepEqual([...source], [1, 2, 3, 4]);
  assert.throws(() => node.stream_ops.read(null, buffer, 0, 2, 4));
  assert.deepEqual(missing, [4]);
});
