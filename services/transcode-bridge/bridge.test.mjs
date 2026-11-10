import { hlsJobIsIdle } from "./bridge.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  clientAddress,
  hlsArgs,
  isPlanOffered,
  isPrivateAddress,
  normalizeAccess,
  parseTranscodePlan,
  parseTranscodeSource,
  resolveAccess,
  rewriteHlsPlaylist,
  transcodeArgs
} from "./bridge.mjs";

test("open mode serves anyone, lan mode only private addresses", () => {
  assert.equal(resolveAccess({ access: "open" }).ok, true);
  assert.equal(resolveAccess({ access: "lan", address: "192.168.2.10" }).ok, true);
  assert.equal(resolveAccess({ access: "lan", address: "127.0.0.1" }).ok, true);
  assert.equal(resolveAccess({ access: "lan", address: "8.8.8.8" }).ok, false);
  assert.equal(resolveAccess({ access: "lan", address: "" }).ok, false);
});

test("the private ranges are exactly the private ranges", () => {
  for (const address of [
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.0.5",
    "::1",
    "fd00::1",
    "fc00::1"
  ]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  for (const address of ["8.8.8.8", "172.32.0.1", "172.15.0.1", "1.1.1.1", "2001:db8::1"]) {
    assert.equal(isPrivateAddress(address), false, address);
  }
});

test("token mode fails closed when the deployment has no token", () => {
  // An unset token protects nothing, so serving would be worse than refusing.
  const verdict = resolveAccess({ access: "token", token: "", presented: "anything" });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "token-not-configured");
});

test("token mode compares exactly", () => {
  assert.equal(resolveAccess({ access: "token", token: "abc", presented: "abc" }).ok, true);
  assert.equal(resolveAccess({ access: "token", token: "abc", presented: "abc " }).ok, false);
  assert.equal(
    resolveAccess({ access: "token", token: "abc", presented: "" }).reason,
    "token-mismatch"
  );
});

test("an unknown access value falls back to token, not to open", () => {
  assert.equal(normalizeAccess(""), "token");
  assert.equal(normalizeAccess("OPEN"), "open");
  assert.equal(normalizeAccess("lan"), "lan");
  assert.equal(normalizeAccess("nonsense"), "token");
});

test("behind a tunnel the forwarded client address wins over the socket", () => {
  // cloudflared runs on the same host, so the socket is 127.0.0.1 for callers from
  // the internet; trusting it would make every remote caller look local.
  assert.equal(clientAddress({ "cf-connecting-ip": "8.8.8.8" }, "127.0.0.1"), "8.8.8.8");
  assert.equal(clientAddress({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }, "127.0.0.1"), "9.9.9.9");
  assert.equal(clientAddress({}, "192.168.2.5"), "192.168.2.5");
  assert.equal(
    resolveAccess({
      access: "lan",
      address: clientAddress({ "cf-connecting-ip": "8.8.8.8" }, "127.0.0.1")
    }).ok,
    false
  );
});

test("only http(s) sources without credentials are accepted", () => {
  assert.equal(parseTranscodeSource("https://cdn/a.mkv").ok, true);
  assert.equal(parseTranscodeSource("file:///etc/passwd").reason, "unsupported-scheme");
  assert.equal(parseTranscodeSource("").reason, "missing-source");
  assert.equal(parseTranscodeSource("https://u:p@cdn/a.mkv").reason, "credentials-not-allowed");
});

test("the picture is copied and only the audio is re-encoded", () => {
  const args = transcodeArgs("https://cdn/a.mkv", "/tmp/out.mp4", { bitrate: "160k" });
  const videoIndex = args.indexOf("-c:v");
  assert.equal(args[videoIndex + 1], "copy");
  const audioIndex = args.indexOf("-c:a");
  assert.equal(args[audioIndex + 1], "aac");
  assert.ok(args.includes("160k"));
  assert.equal(args[args.length - 1], "/tmp/out.mp4");
});

test("an HEVC output is tagged for Safari, and the tag stays optional", () => {
  // The MP4 a phone cannot open: HEVC tagged hev1. Safari wants hvc1, so the first
  // attempt asks for that tag and the second one does without it.
  const tagged = transcodeArgs("https://cdn/a.mkv", "/tmp/out.mp4", { videoTag: "hvc1" });
  const tagIndex = tagged.indexOf("-tag:v");
  assert.ok(tagIndex > 0);
  assert.equal(tagged[tagIndex + 1], "hvc1");
  assert.equal(tagged[tagged.length - 1], "/tmp/out.mp4");

  const plain = transcodeArgs("https://cdn/a.mkv", "/tmp/out.mp4");
  assert.equal(plain.includes("-tag:v"), false);
});

test("a request without a plan asks for what the app has always asked for", () => {
  const result = parseTranscodePlan(new URLSearchParams(""));
  assert.deepEqual(result.plan, {
    video: "copy",
    audio: "aac",
    height: 0,
    channels: 2,
    audioIndex: 0
  });
  assert.equal(result.signature, "vcopy-aaac-h0-c2-i0");
});

test("the plan is read from the query, and out-of-range values are refused", () => {
  const read = (search) => parseTranscodePlan(new URLSearchParams(search));

  assert.deepEqual(read("v=copy&a=aac&ac=1").plan, {
    video: "copy",
    audio: "aac",
    height: 0,
    channels: 1,
    audioIndex: 0
  });
  assert.equal(read("h=1080").plan.height, 1080);
  assert.equal(read("h=2160").reason, "invalid-height");
  assert.equal(read("h=200").reason, "invalid-height");
  assert.equal(read("h=abc").reason, "invalid-height");
  assert.equal(read("ac=6").reason, "invalid-channels");
  assert.equal(read("ac=0").reason, "invalid-channels");
  assert.equal(read("v=vp9").reason, "invalid-video");
  assert.equal(read("a=mp3").reason, "invalid-audio");
});

test("the bridge only performs the plans it advertises", () => {
  // A caller that asked for a re-encode must be refused, not quietly given a copy:
  // a copy is exactly the file the device already said it cannot play.
  assert.equal(isPlanOffered({ video: "copy", audio: "aac" }), true);
  assert.equal(isPlanOffered({ video: "h264", audio: "aac" }), false);
  assert.equal(isPlanOffered({ video: "h264", audio: "aac" }, true), true);
  assert.equal(isPlanOffered({ video: "h264", audio: "copy" }, true), false);
  // `audio: copy` used to be refused; it is the remux shape and is now offered as\n  // HLS, so it must be accepted here while a re-encode stays refused.\n  assert.equal(isPlanOffered({ video: "copy", audio: "copy" }), true);
});

test("the plan is part of the cache key, because it is part of the output", () => {
  const plain = parseTranscodeSource("https://cdn/a.mp4");
  const stereo = parseTranscodeSource("https://cdn/a.mp4", { planSignature: "vcopy-aaac-h0-c2" });
  const mono = parseTranscodeSource("https://cdn/a.mp4", { planSignature: "vcopy-aaac-h0-c1" });

  assert.equal(plain.key === stereo.key, false);
  assert.equal(stereo.key === mono.key, false);
  assert.equal(
    parseTranscodeSource("https://cdn/a.mp4", { planSignature: "vcopy-aaac-h0-c1" }).key,
    mono.key
  );
});

test("the arguments follow the plan", () => {
  const mono = transcodeArgs("https://cdn/a.mkv", "/tmp/out.mp4", {
    plan: { video: "copy", audio: "aac", height: 0, channels: 1, audioIndex: 0 }
  });
  assert.equal(mono[mono.indexOf("-ac") + 1], "1");
  assert.equal(mono[mono.indexOf("-c:v") + 1], "copy");

  const copiedAudio = transcodeArgs("https://cdn/a.mkv", "/tmp/out.mp4", {
    plan: { video: "copy", audio: "copy", height: 0, channels: 2, audioIndex: 0 }
  });
  assert.equal(copiedAudio[copiedAudio.indexOf("-c:a") + 1], "copy");
  // Only an audio-only job has any business setting a bitrate.
  assert.equal(copiedAudio.includes("-b:a"), false);
});

test("the playlist points at URLs this bridge can answer", () => {
  const key = "a".repeat(32);
  const ffmpegPlaylist = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    "#EXT-X-TARGETDURATION:4",
    '#EXT-X-MAP:URI="init.mp4"',
    "#EXTINF:4.000000,",
    "seg00000.m4s",
    "#EXTINF:4.000000,",
    "seg00001.m4s",
    "#EXT-X-ENDLIST",
    ""
  ].join("\n");

  const plain = rewriteHlsPlaylist(ffmpegPlaylist, { key });
  // Relative to the playlist's own directory: that is the only form both Safari and
  // ffmpeg resolve correctly, and it needs no knowledge of the host that served it.
  assert.match(plain, new RegExp(`#EXT-X-MAP:URI="${key}/init.mp4"`));
  assert.match(plain, new RegExp(`\\n${key}/seg00000\\.m4s\\n`));
  assert.match(plain, new RegExp(`\\n${key}/seg00001\\.m4s\\n`));
  assert.equal(plain.includes("/api/transcode/hls/"), false);
  // The closing tag is what tells the player the whole film is available.
  assert.equal(plain.includes("#EXT-X-ENDLIST"), true);
  assert.equal(plain.includes("#EXT-X-TARGETDURATION:4"), true);

  // The token the playlist was asked with travels to the segments, so their own
  // requests pass the same access check.
  const withToken = rewriteHlsPlaylist(ffmpegPlaylist, { key, token: "s3cret" });
  assert.match(withToken, new RegExp(`${key}/seg00000\\.m4s\\?token=s3cret`));
  assert.match(withToken, new RegExp(`${key}/init\\.mp4\\?token=s3cret`));
});

test("the hls command writes an event playlist of four-second fragments", () => {
  const dir = path.join("/tmp", "job");
  const args = hlsArgs("https://cdn/a.mkv", dir, {
    plan: { video: "copy", audio: "aac", height: 0, channels: 2, audioIndex: 0 }
  });
  const value = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(value("-f"), "hls");
  assert.equal(value("-hls_playlist_type"), "event");
  assert.equal(value("-hls_segment_type"), "fmp4");
  assert.equal(value("-hls_time"), "4");
  // Bare names throughout: the job directory is the working directory, so nothing
  // local ends up inside the playlist.
  assert.equal(value("-hls_segment_filename"), "seg%05d.m4s");
  assert.equal(value("-hls_fmp4_init_filename"), "init.mp4");
  assert.equal(args[args.length - 1], "index.m3u8");
  assert.equal(
    args.some((entry) => entry.includes(dir)),
    false,
    "no absolute path reaches the playlist"
  );
  // The codec half is the same command the file delivery uses.
  assert.equal(value("-c:v"), "copy");
  assert.equal(value("-c:a"), "aac");
  // faststart belongs to a file being written, not to a segmenter.
  assert.equal(args.includes("-movflags"), false);
});

test("a re-encoded picture is H.264 and never tagged as HEVC", () => {
  // The tag exists for a *copied* HEVC track. On an encode it is both wrong and
  // wasteful: ffmpeg rejects it after a wasted start, once per request.
  const full = transcodeArgs("https://cdn/a.mkv", "/tmp/out.mp4", {
    videoTag: "hvc1",
    plan: { video: "h264", audio: "aac", height: 1080, channels: 2 }
  });
  assert.equal(full[full.indexOf("-c:v") + 1], "libx264");
  assert.equal(full.includes("-tag:v"), false);
  assert.equal(
    full[full.indexOf("-vf") + 1],
    "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2"
  );

  // The copied-HEVC case still asks for the tag.
  const copied = transcodeArgs("https://cdn/a.mkv", "/tmp/out.mp4", { videoTag: "hvc1" });
  assert.equal(copied.includes("-tag:v"), true);
});

test("a silent hls job is idle, a finished one never is", () => {
  const at = 1_000_000;
  const idleMs = 60_000;
  assert.equal(
    hlsJobIsIdle({ lastRequestAt: at - 120_000 }, { at, idleMs }),
    true,
    "silent for two minutes"
  );
  assert.equal(
    hlsJobIsIdle({ lastRequestAt: at - 30_000 }, { at, idleMs }),
    false,
    "asked 30s ago"
  );
  assert.equal(
    hlsJobIsIdle({ lastRequestAt: at - 120_000, done: true }, { at, idleMs }),
    false,
    "finished work is kept"
  );
  assert.equal(hlsJobIsIdle({ lastRequestAt: at - 120_000, failed: true }, { at, idleMs }), false);
  assert.equal(hlsJobIsIdle(null, { at, idleMs }), false);
  assert.equal(
    hlsJobIsIdle({ lastRequestAt: at - 120_000 }, { at, idleMs: 0 }),
    false,
    "0 disables it"
  );
  // A job that has only ever been created is aged from its creation time.
  assert.equal(hlsJobIsIdle({ lastUsed: at - 120_000 }, { at, idleMs }), true);
});

test("the remux shape is offered: copy the picture, copy the audio", () => {
  // The container needs fixing, the audio does not. Delivered as HLS this is what makes
  // a film start in seconds instead of after a full copy.
  assert.equal(isPlanOffered({ video: "copy", audio: "copy" }), true);
  assert.equal(isPlanOffered({ video: "copy", audio: "aac" }), true);
  // Still refused: a re-encode asked for and approximated would ship the file the
  // device already rejected.
  assert.equal(isPlanOffered({ video: "h264", audio: "copy" }), false);

  const plan = parseTranscodePlan(new URLSearchParams("v=copy&a=copy"));
  assert.equal(plan.ok, true);
  assert.equal(plan.plan.audio, "copy");
});

test("an hls command that copies audio does not encode it", () => {
  const args = hlsArgs("https://cdn.test/a.mkv", "jobdir", {
    videoTag: "hvc1",
    plan: { video: "copy", audio: "copy", height: 0, channels: 2, audioIndex: 0 }
  });
  assert.equal(args.includes("-c:a"), true);
  assert.equal(args[args.indexOf("-c:a") + 1], "copy");
  assert.equal(args.includes("-b:a"), false, "copied audio has no bitrate to set");
  assert.equal(args.includes("-c:v"), true);
  assert.equal(args[args.indexOf("-c:v") + 1], "copy");
});
