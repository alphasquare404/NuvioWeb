import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { installProbeSparseFile } from "./probeSparseFile.js";
import { normalizeProbe } from "./probeMetadata.js";
const require = createRequire(import.meta.url);

test("real WASM ffprobe reads an MP4 moov beyond 3GB using a sparse bounded file and also reads MKV", async (t) => {
  const originalSelf = globalThis.self;
  globalThis.self = { location: { href: "file:///ffmpeg-core.js" } };
  t.after(() => {
    if (originalSelf === undefined) delete globalThis.self;
    else globalThis.self = originalSelf;
  });
  const core = await require("@ffmpeg/core")({
    wasmBinary: readFileSync(require.resolve("@ffmpeg/core/wasm"))
  });
  core.setLogger(() => {});
  const mp4 = readFileSync(new URL("./fixtures/probe-dual-audio.mp4", import.meta.url));
  let moov = -1;
  for (let p = 0; p + 8 <= mp4.length;) {
    const size = mp4.readUInt32BE(p);
    if (mp4.toString("ascii", p + 4, p + 8) === "moov") {
      moov = p;
      break;
    }
    if (size < 8) break;
    p += size;
  }
  assert.ok(moov >= 0);
  const padding = 3 * 1024 ** 3,
    header = Buffer.alloc(8);
  header.writeUInt32BE(padding);
  header.write("free", 4);
  const large = {
    size: mp4.length + padding,
    parts: [
      { start: 0, bytes: mp4.subarray(0, moov) },
      { start: moov, bytes: header },
      { start: moov + padding, bytes: mp4.subarray(moov) }
    ]
  };
  const mkv = readFileSync(new URL("./fixtures/probe-dual-audio.mkv", import.meta.url));
  for (const file of [large, { size: mkv.length, parts: [{ start: 0, bytes: mkv }] }]) {
    const chunks = [],
      positions = [];
    let facts = null;
    for (let attempt = 0; attempt < 32; attempt++) {
      let missing = null;
      for (const path of ["/probe-input", "/result.json"])
        try {
          core.FS.unlink(path);
        } catch {}
      if (attempt === 0) missing = 0;
      else {
        installProbeSparseFile(core.FS, {
          size: file.size,
          chunks,
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
      }
      if (missing == null) {
        facts = normalizeProbe(JSON.parse(core.FS.readFile("/result.json", { encoding: "utf8" })));
        break;
      }
      const start = Math.floor(missing / 262144) * 262144;
      assert.equal(positions.includes(start), false, "probe must request a new block");
      positions.push(start);
      const bytes = new Uint8Array(Math.min(262144, file.size - start));
      for (const part of file.parts) {
        const from = Math.max(start, part.start),
          end = Math.min(start + bytes.length, part.start + part.bytes.length);
        if (end > from)
          bytes.set(part.bytes.subarray(from - part.start, end - part.start), from - start);
      }
      chunks.push({ start, bytes });
    }
    assert.ok(facts);
    assert.equal(facts.videoCodec, "h264");
    assert.equal(facts.hasAudio, true);
    assert.deepEqual(
      facts.audioStreams.map((a) => a.channels),
      [6, 2]
    );
    assert.equal(facts.width, 32);
    assert.equal(facts.height, 32);
    assert.ok(
      chunks.reduce((n, p) => n + p.bytes.length, 0) < 1024 * 1024,
      "must not read the full 3GB file"
    );
    if (file === large) {
      assert.ok(positions.some((p) => p > 3 * 1024 ** 3 - 262144));
      assert.equal(facts.container, "mp4");
      assert.match(facts.codecString, /^avc1\./);
    } else assert.equal(facts.container, "mkv");
  }
});
