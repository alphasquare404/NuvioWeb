import assert from "node:assert/strict";
import test from "node:test";
import { PLAYBACK_METHODS } from "./playbackMethod.js";
import {
  TRANSCODE_ACCESS_MODES,
  TRANSCODE_PLAN_DEFAULTS,
  buildTranscodePlan,
  buildTranscodePlaylistUrl,
  buildTranscodeUrl,
  createTranscodeAccess,
  isTranscodeAccessGranted,
  isTranscodeEndpointConfigured,
  normalizeTranscodeAccessMode,
  shouldTranscodeSource,
  transcodePlanQuery
} from "./transcodeSource.js";

const ENDPOINT = "/api/transcode";

function verdictFor(method) {
  return { method, container: "mp4", videoCodec: "h264", audioCodec: "eac3" };
}

test("nothing is rewired until the deployment offers an endpoint", () => {
  assert.equal(isTranscodeEndpointConfigured(""), false);
  assert.equal(isTranscodeEndpointConfigured("   "), false);
  assert.equal(isTranscodeEndpointConfigured(ENDPOINT), true);
  assert.equal(
    shouldTranscodeSource({
      url: "https://cdn.test/a.mp4",
      verdict: verdictFor(PLAYBACK_METHODS.AUDIO_TRANSCODE),
      endpoint: ""
    }),
    false
  );
});

test("only a stream whose audio alone is the problem is sent to the transcoder", () => {
  const url = "https://cdn.test/a.mp4";
  for (const method of [
    PLAYBACK_METHODS.DIRECT,
    PLAYBACK_METHODS.REMUX,
    PLAYBACK_METHODS.TRANSCODE,
    PLAYBACK_METHODS.UNKNOWN
  ]) {
    assert.equal(
      shouldTranscodeSource({ url, verdict: verdictFor(method), endpoint: ENDPOINT }),
      false,
      method
    );
  }
  assert.equal(
    shouldTranscodeSource({
      url,
      verdict: verdictFor(PLAYBACK_METHODS.AUDIO_TRANSCODE),
      endpoint: ENDPOINT
    }),
    true
  );
  // A verdict that never arrived decides nothing.
  assert.equal(shouldTranscodeSource({ url, verdict: null, endpoint: ENDPOINT }), false);
});

test("a source the server cannot fetch is left alone", () => {
  const audio = verdictFor(PLAYBACK_METHODS.AUDIO_TRANSCODE);
  assert.equal(
    shouldTranscodeSource({
      url: "blob:https://app.test/1234",
      verdict: audio,
      endpoint: ENDPOINT
    }),
    false
  );
  assert.equal(shouldTranscodeSource({ url: "", verdict: audio, endpoint: ENDPOINT }), false);
});

test("a source already pointing at the endpoint is not wrapped again", () => {
  const audio = verdictFor(PLAYBACK_METHODS.AUDIO_TRANSCODE);
  const wrapped = buildTranscodeUrl("https://cdn.test/a.mp4", { endpoint: ENDPOINT });
  assert.equal(shouldTranscodeSource({ url: wrapped, verdict: audio, endpoint: ENDPOINT }), false);
});

test("the wrapper survives the source's own query string, and carries the token", () => {
  const plain = buildTranscodeUrl("https://cdn.test/a.mp4?x=1&y=2", { endpoint: ENDPOINT });
  assert.equal(plain.startsWith("/api/transcode?u="), true);
  assert.equal(
    decodeURIComponent(plain.slice("/api/transcode?u=".length)),
    "https://cdn.test/a.mp4?x=1&y=2"
  );
  assert.equal(plain.includes("token="), false);

  const withToken = buildTranscodeUrl("https://cdn.test/a.mp4", {
    endpoint: ENDPOINT,
    token: " s3cret "
  });
  assert.equal(withToken, "/api/transcode?u=https%3A%2F%2Fcdn.test%2Fa.mp4&token=s3cret");

  // Progressive: the player has eighteen seconds before it gives up, and the
  // whole-file answer takes minutes on a film.
  const progressive = buildTranscodeUrl("https://cdn.test/a.mp4", {
    endpoint: ENDPOINT,
    token: "s3cret",
    stream: true
  });
  assert.equal(
    progressive,
    "/api/transcode?u=https%3A%2F%2Fcdn.test%2Fa.mp4&token=s3cret&stream=1"
  );
  assert.equal(
    buildTranscodeUrl("https://cdn.test/a.mp4", { endpoint: ENDPOINT }).includes("stream"),
    false
  );

  // An endpoint that already carries a query keeps working.
  const queried = buildTranscodeUrl("https://cdn.test/a.mp4", {
    endpoint: "/api/transcode?v=2"
  });
  assert.equal(queried.includes("?v=2&u="), true);
});

test("the plan says what this device needs produced", () => {
  const verdict = verdictFor(PLAYBACK_METHODS.AUDIO_TRANSCODE);
  const plan = buildTranscodePlan({ verdict, capabilities: { aac: true } });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.plan, TRANSCODE_PLAN_DEFAULTS);
  assert.deepEqual(plan.plan, { video: "copy", audio: "aac", height: 0, channels: 2 });

  // Not an audio problem: the container relay is the one to ask, and a device
  // that cannot decode AAC either has nothing to gain from a transcode.
  assert.equal(
    buildTranscodePlan({ verdict: verdictFor(PLAYBACK_METHODS.REMUX), capabilities: {} }).reason,
    "not-audio-only"
  );
  assert.equal(buildTranscodePlan({ verdict: null, capabilities: {} }).reason, "not-audio-only");
  const noAac = buildTranscodePlan({ verdict, capabilities: { aac: false } });
  assert.equal(noAac.ok, false);
  assert.equal(noAac.reason, "no-common-audio");
});

test("the playlist URL is a path ending in .m3u8, so the player picks HLS", () => {
  const url = buildTranscodePlaylistUrl("https://cdn.test/a.mp4", {
    endpoint: "/api/transcode",
    token: "s3cret",
    plan: TRANSCODE_PLAN_DEFAULTS
  });
  assert.equal(
    url,
    "/api/transcode/hls/index.m3u8?u=https%3A%2F%2Fcdn.test%2Fa.mp4&token=s3cret&v=copy&a=aac&ac=2"
  );
  // The player decides HLS by the extension; a query-only route would not do.
  assert.equal(url.split("?")[0].endsWith(".m3u8"), true);

  // A trailing slash on the endpoint does not produce a double slash.
  assert.equal(
    buildTranscodePlaylistUrl("https://cdn.test/a.mp4", { endpoint: "/api/transcode/" }).startsWith(
      "/api/transcode/hls/index.m3u8?"
    ),
    true
  );

  // An endpoint carrying its own query cannot have a path appended safely, and the
  // caller falls back to the file delivery.
  assert.equal(
    buildTranscodePlaylistUrl("https://cdn.test/a.mp4", { endpoint: "/api/transcode?v=2" }),
    ""
  );
  assert.equal(buildTranscodePlaylistUrl("https://cdn.test/a.mp4", { endpoint: "" }), "");
});

test("the plan travels in the URL as a small closed set of values", () => {
  assert.deepEqual(transcodePlanQuery(null), []);
  assert.deepEqual(transcodePlanQuery({ video: "copy", audio: "aac", height: 0, channels: 2 }), [
    "v=copy",
    "a=aac",
    "ac=2"
  ]);
  assert.deepEqual(transcodePlanQuery({ video: "copy", audio: "aac", height: 1080, channels: 1 }), [
    "v=copy",
    "a=aac",
    "h=1080",
    "ac=1"
  ]);

  const url = buildTranscodeUrl("https://cdn.test/a.mp4", {
    endpoint: ENDPOINT,
    token: "s3cret",
    plan: TRANSCODE_PLAN_DEFAULTS
  });
  assert.equal(
    url,
    "/api/transcode?u=https%3A%2F%2Fcdn.test%2Fa.mp4&token=s3cret&v=copy&a=aac&ac=2"
  );
});

test("an unknown access value is read as token, exactly like the server reads it", () => {
  assert.equal(normalizeTranscodeAccessMode(""), TRANSCODE_ACCESS_MODES.TOKEN);
  assert.equal(normalizeTranscodeAccessMode("OPEN"), TRANSCODE_ACCESS_MODES.OPEN);
  assert.equal(normalizeTranscodeAccessMode(" lan "), TRANSCODE_ACCESS_MODES.LAN);
  assert.equal(normalizeTranscodeAccessMode("nonsense"), TRANSCODE_ACCESS_MODES.TOKEN);
  assert.equal(normalizeTranscodeAccessMode(undefined), TRANSCODE_ACCESS_MODES.TOKEN);
});

test("a token deployment is not called without a token", () => {
  // The point of the gate: the orange label alone is never permission.
  assert.equal(isTranscodeAccessGranted({ mode: "token", token: "" }), false);
  assert.equal(isTranscodeAccessGranted({ mode: "token", token: "   " }), false);
  assert.equal(isTranscodeAccessGranted({ mode: "token", token: "abc" }), true);
  // Open and lan decide by themselves, so a profile needs no secret.
  assert.equal(isTranscodeAccessGranted({ mode: "open", token: "" }), true);
  assert.equal(isTranscodeAccessGranted({ mode: "lan", token: "" }), true);
  // A mode nobody answered is the strict one.
  assert.equal(isTranscodeAccessGranted({ mode: "", token: "" }), false);
  assert.equal(isTranscodeAccessGranted({}), false);
});

test("the bridge is asked once, at its health path, and its answer is the mode", async () => {
  const calls = [];
  const access = createTranscodeAccess({
    endpoint: "/api/transcode",
    fetchImpl: async (url) => {
      calls.push(url);
      return { ok: true, json: async () => ({ ok: true, access: "lan" }) };
    }
  });
  assert.equal(access.enabled, true);
  const first = await access.resolve();
  const second = await access.resolve();
  assert.deepEqual(first, { mode: "lan", reachable: true, hls: false });
  assert.equal(second, first);
  assert.deepEqual(calls, ["/api/transcode/health"]);
  assert.equal(access.mode, "lan");
});

test("a bridge that offers HLS says so, and only then is a playlist asked for", async () => {
  const withHls = createTranscodeAccess({
    endpoint: "/api/transcode",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ ok: true, access: "token", hls: true })
    })
  });
  assert.deepEqual(await withHls.resolve(), { mode: "token", reachable: true, hls: true });

  // An older bridge answers without the field; the app must not assume it.
  const withoutHls = createTranscodeAccess({
    endpoint: "/api/transcode",
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, access: "token" }) })
  });
  assert.equal((await withoutHls.resolve()).hls, false);
});

test("a bridge that cannot be asked falls back to the strict rule, not to open", async () => {
  const access = createTranscodeAccess({
    endpoint: "/api/transcode",
    fetchImpl: async () => {
      throw new Error("offline");
    }
  });
  assert.deepEqual(await access.resolve(), { mode: "token", reachable: false, hls: false });
  assert.equal(isTranscodeAccessGranted({ mode: access.mode, token: "" }), false);
  assert.equal(isTranscodeAccessGranted({ mode: access.mode, token: "abc" }), true);
});

test("a bridge answering 403 is not read as permission", async () => {
  const access = createTranscodeAccess({
    endpoint: "/api/transcode",
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({}) })
  });
  assert.deepEqual(await access.resolve(), { mode: "token", reachable: false, hls: false });
});

test("an endpoint with its own query is not asked at all", async () => {
  let asked = 0;
  const access = createTranscodeAccess({
    endpoint: "/api/transcode?v=2",
    fetchImpl: async () => {
      asked += 1;
      return { ok: true, json: async () => ({ access: "open" }) };
    }
  });
  assert.deepEqual(await access.resolve(), { mode: "token", reachable: false, hls: false });
  assert.equal(asked, 0);
});

test("with no endpoint configured the bridge is never asked", async () => {
  let asked = 0;
  const access = createTranscodeAccess({
    endpoint: "",
    fetchImpl: async () => {
      asked += 1;
      return { ok: true, json: async () => ({ access: "open" }) };
    }
  });
  assert.equal(access.enabled, false);
  await access.resolve();
  assert.equal(asked, 0);
});

test("alternate audio is requested only after the existing bridge advertises it", async () => {
  const access = createTranscodeAccess({
    endpoint: "/api/transcode",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ ok: true, access: "token", hls: true, alternateAudio: true })
    })
  });
  assert.equal((await access.resolve()).alternateAudio, true);
  const url = buildTranscodePlaylistUrl("https://source.test/film.mkv", {
    endpoint: ENDPOINT,
    plan: { video: "copy", audio: "copy", audioIndex: 1, audioIndices: [0, 1] }
  });
  assert.equal(new URL(url, "https://app.test").searchParams.get("audios"), "0,1");
});
