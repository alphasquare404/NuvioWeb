import test from "node:test";
import assert from "node:assert/strict";
import { clientRemuxPlan, clientRemuxAvailable } from "./remuxClient.js";
const probe = {
  container: "mkv",
  videoCodec: "h264",
  codecString: "avc1.640028",
  audioCodec: "eac3",
  audioChannels: 6,
  audioStreams: [
    { index: 0, codec: "eac3", channels: 6 },
    { index: 1, codec: "aac", channels: 2 }
  ],
  playbackCapabilities: {
    video: true,
    container: false,
    audio: [
      { index: 0, supported: false },
      { index: 1, supported: true }
    ],
    relayVideo: true
  }
};
const options = {
  policy: { mode: "client", explicit: true },
  capabilities: {},
  baseUrl: "https://app.test/",
  transcodeEndpoint: "/api/transcode"
};
test("client route retains original media identity and selected audio ordinal without fetching", () => {
  const plan = clientRemuxPlan({ url: "https://cdn.test/movie.mkv" }, probe, options);
  assert.equal(plan.route, "client");
  assert.equal(plan.sourceUrl, "https://cdn.test/movie.mkv");
  assert.equal(plan.audioIndex, 1);
  assert.equal(plan.mediaUrl, null);
  assert.equal(plan.serverAssistance.media, false);
  assert.equal(clientRemuxPlan({ url: "https://cdn.test/movie.mkv" }, null, options), null);
  assert.equal(
    clientRemuxPlan({ url: "x" }, probe, { ...options, policy: { mode: "off", explicit: true } }),
    null
  );
  assert.equal(
    clientRemuxPlan({ url: "x" }, probe, {
      ...options,
      policy: { mode: "server", explicit: false }
    }),
    null
  );
});
test("saved own copy URLs unwrap source and audio while external/audio-transcode URLs keep their meaning", () => {
  const source = "https://cdn.test/private.mkv?token=private";
  const relay =
    "/api/transcode/hls/index.m3u8?u=" + encodeURIComponent(source) + "&ai=2&v=copy&a=copy";
  assert.equal(clientRemuxPlan({ url: relay }, null, options).sourceUrl, source);
  assert.equal(clientRemuxPlan({ url: relay }, null, options).audioIndex, 2);
  assert.equal(clientRemuxPlan({ url: relay.replace("a=copy", "a=aac") }, null, options), null);
  assert.equal(clientRemuxPlan({ url: "https://other.test" + relay }, null, options), null);
  assert.throws(
    () => clientRemuxPlan({ url: relay.replace("ai=2", "ai=-1") }, null, options),
    /audio/
  );
});
test("browser-supported container stays direct in client mode", () => {
  const direct = {
    ...probe,
    audioCodec: "aac",
    audioStreams: [{ index: 0, codec: "aac", channels: 2 }],
    playbackCapabilities: {
      video: true,
      container: true,
      audio: [{ index: 0, supported: true }],
      relayVideo: true
    }
  };
  assert.equal(clientRemuxPlan({ url: "https://cdn.test/direct.mkv" }, direct, options), null);
});

test("client availability depends on browser APIs rather than a server endpoint", () => {
  const scope = {
    isSecureContext: true,
    MediaSource: { isTypeSupported() {} },
    Worker: function () {},
    navigator: { storage: { getDirectory() {} } }
  };
  assert.equal(clientRemuxAvailable(scope), true);
  assert.equal(clientRemuxAvailable({ ...scope, isSecureContext: false }), false);
  assert.equal(clientRemuxAvailable({ ...scope, navigator: {} }), false);
  assert.equal(clientRemuxAvailable({ ...scope, MediaSource: undefined }), false);
});
