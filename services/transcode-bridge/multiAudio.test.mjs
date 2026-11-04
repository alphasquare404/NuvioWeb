import test from "node:test";
import assert from "node:assert/strict";
import { parseAudioIndices, multiAudioHlsArgs, selectDefaultRendition } from "./multiAudio.mjs";
import { parseTranscodePlan, rewriteHlsPlaylist } from "./bridge.mjs";

test("multi audio is bounded, copy-only and shares video across the initial audio selection", () => {
  const params = new URLSearchParams({ v: "copy", a: "copy", audios: "3,1", ai: "1" });
  const first = parseTranscodePlan(params);
  assert.equal(first.ok, true);
  assert.deepEqual(first.plan.audioIndices, [1, 3]);
  params.set("ai", "3");
  const second = parseTranscodePlan(params);
  assert.equal(second.signature, first.signature);
  for (const bad of ["0", "0,0", "0,8", "0,1,2,3,4,5,6,7,0"]) {
    assert.throws(() => parseAudioIndices(bad, 0));
  }
  params.set("a", "aac");
  assert.equal(parseTranscodePlan(params).ok, false);
  const args = multiAudioHlsArgs("source", [1, 3]);
  assert.equal(args.filter((arg) => arg === "0:v:0").length, 1);
  assert.ok(args.includes("0:a:1"));
  assert.ok(args.includes("0:a:3"));
  assert.equal(args[args.indexOf("-c:v") + 1], "copy");
  assert.equal(args[args.indexOf("-c:a") + 1], "copy");
  assert.ok(args.includes("-var_stream_map"));
  assert.equal(args.includes("-ss"), false);
});

test("master default audio follows the request while all media URIs retain authorization", () => {
  const master =
    '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="audio_1",DEFAULT=YES,URI="v1.m3u8"\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="audio_2",DEFAULT=NO,URI="v2.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=100,AUDIO="audio"\nv0.m3u8\n';
  const selected = selectDefaultRendition(master, [1, 3], 3);
  assert.match(selected, /audio_1",DEFAULT=NO/);
  assert.match(selected, /audio_2",DEFAULT=YES/);
  const rewritten = rewriteHlsPlaylist(selected, { key: "key", token: "s e c" });
  for (const file of ["v0.m3u8", "v1.m3u8", "v2.m3u8"])
    assert.ok(rewritten.includes("key/" + file + "?token=s%20e%20c"));
});
