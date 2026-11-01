import test from "node:test";
import assert from "node:assert/strict";
import {
  selectUnverifiedPlayback,
  canTryUnverifiedRemux,
  canTryUnverifiedAudioTranscode,
  prepareUnverifiedAudioTranscode,
  prepareUnverifiedRemux
} from "./unverifiedPlayback.js";
const sourceUrl = "https://media.test/source";
const capabilities = {
  h264: true,
  hevc: true,
  aac: true,
  eac3: true,
  dts: false,
  containers: { mp4: true, mkv: false }
};
const choose = (name, extra = {}) =>
  selectUnverifiedPlayback({
    stream: { url: sourceUrl, name },
    capabilities,
    policy: { mode: "server" },
    labels: { metadataFilenameFallback: true },
    ...extra
  });

test("unverified filename routes choose copy or direct without authorizing audio conversion", () => {
  assert.equal(choose("Movie.H264.AAC.mkv").route, "remux");
  assert.equal(choose("Movie.H264.AAC.mp4").route, "direct");
  assert.equal(choose("Movie.H264.DTS.mkv").route, "direct");
  assert.equal(choose("Movie").route, "direct");
  assert.equal(choose("Movie.H264.AAC.mkv", { labels: {} }).route, "direct");
  assert.equal(choose("Movie.H264.AAC.mkv", { policy: { mode: "off" } }).route, "direct");
});

test("file facts still govern verified playback rather than filename guesses", () => {
  const probe = {
    container: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    playbackCapabilities: { video: true, container: true, audio: [{ index: 0, supported: true }] }
  };
  assert.equal(choose("Movie.H264.DTS.mkv", { probe }), null);
});

test("format failures permit one copy attempt, while explicit network/access failures do not", () => {
  const attempt = choose("Movie.H264.AAC.mp4");
  for (const code of [3, 4])
    assert.equal(canTryUnverifiedRemux(attempt, { mediaErrorCode: code }), true);
  assert.equal(canTryUnverifiedRemux(attempt, { detail: "NotSupportedError" }), true);
  for (const mediaErrorCode of [0, 1, 2])
    assert.equal(canTryUnverifiedRemux(attempt, { mediaErrorCode }), false);
  for (const detail of [
    "HTTP 403",
    "status=401",
    "networkError",
    "Failed to fetch",
    "timeout",
    "NotAllowedError",
    "SecurityError",
    "expired token"
  ])
    assert.equal(canTryUnverifiedRemux(attempt, { mediaErrorCode: 4, detail }), false, detail);
  assert.equal(canTryUnverifiedRemux(attempt, { mediaErrorCode: 4, httpStatus: 502 }), false);
  assert.equal(
    canTryUnverifiedRemux({ ...attempt, remuxTried: true }, { mediaErrorCode: 4 }),
    false
  );
  assert.equal(canTryUnverifiedRemux({ ...attempt, busy: true }, { mediaErrorCode: 4 }), false);
  assert.equal(canTryUnverifiedRemux(choose("Movie.H264.AAC.mkv"), { mediaErrorCode: 4 }), false);
});

test("trial server delivery uses the same HLS copy-only plan even without probe facts", async () => {
  const result = await prepareUnverifiedRemux(sourceUrl, {
    policy: { mode: "server" },
    remuxEndpoint: "/api/remux",
    transcodeEndpoint: "/api/transcode",
    token: "test-token",
    access: { resolve: async () => ({ hls: true }) }
  });
  const url = new URL(result.url, "https://app.test");
  assert.equal(url.pathname, "/api/transcode/hls/index.m3u8");
  assert.equal(url.searchParams.get("v"), "copy");
  assert.equal(url.searchParams.get("a"), "copy");
  assert.equal(url.searchParams.get("u"), sourceUrl);
  assert.equal(result.plan, null);
});

test("trial client delivery contains no guessed codec and cannot invoke an encoder", async () => {
  const result = await prepareUnverifiedRemux(sourceUrl, {
    policy: { mode: "client", explicit: true },
    token: ""
  });
  assert.equal(result.url, sourceUrl);
  assert.equal(result.plan.route, "client");
  assert.equal(result.plan.method, "remux");
  assert.equal(result.plan.expectedAudio, null);
  await assert.rejects(
    prepareUnverifiedRemux(sourceUrl, { policy: { mode: "off" }, token: "" }),
    /unavailable/
  );
});

test("startup stall permits a single remux but never hides a known network/access failure", () => {
  const attempt = choose("Movie", { labels: {} });
  assert.equal(canTryUnverifiedRemux(attempt, { startupStall: true }), true);
  for (const failure of [
    { httpStatus: 502 },
    { mediaErrorCode: 2 },
    { detail: "CORS" },
    { detail: "timeout" },
    { detail: "HTTP 401" }
  ])
    assert.equal(canTryUnverifiedRemux(attempt, { startupStall: true, ...failure }), false);
  assert.equal(
    canTryUnverifiedRemux({ ...attempt, remuxTried: true }, { startupStall: true }),
    false
  );
  const remux = { ...attempt, route: "remux", remuxTried: true };
  assert.equal(
    canTryUnverifiedAudioTranscode(remux, { mediaErrorCode: 4 }, "/api/transcode"),
    true
  );
  assert.equal(canTryUnverifiedAudioTranscode(remux, { mediaErrorCode: 4 }, ""), false);
  assert.equal(
    canTryUnverifiedAudioTranscode(
      { ...remux, audioTranscodeTried: true },
      { mediaErrorCode: 4 },
      "/api/transcode"
    ),
    false
  );
});

test("automatic audio conversion needs actual unsupported audio, supported video and configured server access", async () => {
  const facts = {
    container: "mkv",
    videoCodec: "h264",
    audioCodec: "dts",
    audioStreams: [{ index: 0, codec: "dts", channels: 6 }]
  };
  const options = {
    probe: facts,
    capabilities,
    transcodeEndpoint: "/api/transcode",
    token: "test-token",
    access: { resolve: async () => ({ reachable: true, hls: true, mode: "token" }) }
  };
  const delivery = await prepareUnverifiedAudioTranscode(sourceUrl, options);
  const url = new URL(delivery.url, "https://app.test");
  assert.equal(url.searchParams.get("v"), "copy");
  assert.equal(url.searchParams.get("a"), "aac");
  assert.equal(delivery.plan, null);
  assert.equal(await prepareUnverifiedAudioTranscode(sourceUrl, { ...options, token: "" }), null);
  assert.equal(
    await prepareUnverifiedAudioTranscode(sourceUrl, { ...options, transcodeEndpoint: "" }),
    null
  );
  assert.equal(await prepareUnverifiedAudioTranscode(sourceUrl, { ...options, probe: null }), null);
  assert.equal(
    await prepareUnverifiedAudioTranscode(sourceUrl, {
      ...options,
      capabilities: { ...capabilities, h264: false }
    }),
    null
  );
  assert.equal(
    await prepareUnverifiedAudioTranscode(sourceUrl, {
      ...options,
      probe: { ...facts, audioCodec: "aac", audioStreams: [{ index: 0, codec: "aac" }] }
    }),
    null
  );
  assert.equal(
    await prepareUnverifiedAudioTranscode(sourceUrl, {
      ...options,
      probe: { ...facts, audioStreams: [...facts.audioStreams, { index: 1, codec: "aac" }] }
    }),
    null
  );
  assert.equal(
    await prepareUnverifiedAudioTranscode(sourceUrl, {
      ...options,
      access: { resolve: async () => ({ reachable: false }) }
    }),
    null
  );
});
