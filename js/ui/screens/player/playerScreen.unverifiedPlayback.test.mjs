import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { canTryUnverifiedRemux } from "../../../core/player/unverifiedPlayback.js";
const source = readFileSync(new URL("./playerScreen.js", import.meta.url), "utf8");
function harness(prepare) {
  const text = source.slice(
    source.indexOf("  async runUnverifiedPlaybackAttempt("),
    source.indexOf("  startPlayerControllerPlayback(")
  );
  const methods = vm.runInNewContext("({" + text + "})", {
    REMUX_POLICY: { mode: "server" },
    canTryUnverifiedRemux,
    prepareUnverifiedRemux: prepare
  });
  const ctx = Object.assign(methods, {
    params: {
      unverifiedPlayback: {
        sourceUrl: "https://media.test/movie",
        mediaUrl: "https://media.test/movie",
        route: "direct",
        remuxTried: false
      }
    },
    activePlaybackUrl: "https://media.test/movie",
    playerMountToken: 1,
    hasPresentedPlaybackFrame: false,
    getStreamCandidateByUrl: () => ({ id: "original" }),
    getCurrentStreamCandidate: () => ({ id: "original" }),
    isActiveMountToken(token) {
      return token === this.playerMountToken;
    },
    clearPlaybackStallGuard() {},
    errors: [],
    plays: [],
    showStartupError(message) {
      this.errors.push(message);
    },
    async playStreamByUrl(url, options) {
      this.activePlaybackUrl = url;
      this.plays.push({ url, options });
    }
  });
  return ctx;
}

test("duplicate direct failure events start only one remux; raw/manual retry cannot restart an automatic loop", async () => {
  let calls = 0,
    complete;
  const ctx = harness(() => {
    calls++;
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  const first = ctx.tryUnverifiedRemuxAfterFailure({ mediaErrorCode: 4 });
  assert.equal(await ctx.tryUnverifiedRemuxAfterFailure({ mediaErrorCode: 4 }), true);
  assert.equal(calls, 1);
  complete({ url: "/api/transcode/hls/index.m3u8?u=fixture&v=copy&a=copy", plan: null });
  assert.equal(await first, true);
  assert.equal(ctx.plays.length, 1);
  assert.equal(ctx.params.unverifiedPlayback.remuxTried, true);
  assert.equal(await ctx.tryUnverifiedRemuxAfterFailure({ mediaErrorCode: 4 }), false);
  await ctx.runUnverifiedPlaybackAttempt("direct");
  assert.equal(ctx.activePlaybackUrl, "https://media.test/movie");
  assert.equal(ctx.params.playbackPlan, null);
  assert.equal(await ctx.tryUnverifiedRemuxAfterFailure({ mediaErrorCode: 4 }), false);
  assert.equal(calls, 1);
});

test("stale remux preparation cannot replace a newly selected stream", async () => {
  let complete;
  const ctx = harness(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      })
  );
  const first = ctx.tryUnverifiedRemuxAfterFailure({ mediaErrorCode: 4 });
  ctx.activePlaybackUrl = "https://media.test/another";
  complete({ url: "/old-remux", plan: null });
  await first;
  assert.equal(ctx.activePlaybackUrl, "https://media.test/another");
  assert.equal(ctx.plays.length, 0);
  assert.equal(ctx.errors.length, 0);
});

test("network failures and playback after the first frame do not trigger remux", async () => {
  let calls = 0;
  const ctx = harness(async () => {
    calls++;
    throw Error("should not prepare");
  });
  assert.equal(await ctx.tryUnverifiedRemuxAfterFailure({ mediaErrorCode: 2 }), false);
  assert.equal(
    await ctx.tryUnverifiedRemuxAfterFailure({ mediaErrorCode: 4, httpStatus: 403 }),
    false
  );
  ctx.hasPresentedPlaybackFrame = true;
  assert.equal(await ctx.tryUnverifiedRemuxAfterFailure({ mediaErrorCode: 4 }), false);
  assert.equal(calls, 0);
});

test("remux preparation failure reports its actual error and keeps original-URL retry available", async () => {
  const ctx = harness(async () => {
    throw Error("remux unavailable");
  });
  assert.equal(await ctx.tryUnverifiedRemuxAfterFailure({ mediaErrorCode: 4 }), true);
  assert.deepEqual(ctx.errors, ["remux unavailable"]);
  assert.equal(ctx.params.unverifiedPlayback.route, "remux");
  assert.equal(ctx.params.unverifiedPlayback.busy, false);
  await ctx.runUnverifiedPlaybackAttempt("direct");
  assert.equal(ctx.plays[0].url, "https://media.test/movie");
});

test("a URL resolved inside the player receives the client remux route before native playback", async () => {
  const from = source.indexOf("  async prepareResolvedCandidatePlayback(");
  const to = source.indexOf("  async switchStream(", from);
  const raw = { id: "raw", name: "Movie.H264.AAC.mkv" };
  const clientPlan = { sourceUrl: "https://media.test/resolved", route: "client", method: "remux" };
  let prepared = 0;
  const methods = vm.runInNewContext("({" + source.slice(from, to) + "})", {
    REMUX_POLICY: { mode: "client" },
    getDeviceCapabilities: () => ({}),
    StreamBadgeSettingsStore: { snapshot: () => ({ metadataFilenameFallback: true }) },
    clientRemuxPlan: () => null,
    selectUnverifiedPlayback: ({ stream }) => ({
      sourceUrl: stream.url,
      route: "remux",
      mediaUrl: stream.url,
      remuxTried: true
    }),
    prepareUnverifiedRemux: async (url) => {
      prepared++;
      return { url, plan: clientPlan };
    },
    traceHost: () => "media.test",
    classifyPlayback: () => ({ method: "unknown" }),
    Environment: { isBrowser: () => true },
    streamMergeKey: (stream) => stream.id,
    streamDirectPlaybackUrl: (stream) => stream.url || "",
    DirectDebridResolver: {
      canResolveStream: () => true,
      resolve: async () => ({ status: "success", stream: { url: "https://media.test/resolved" } })
    }
  });
  const ctx = Object.assign(methods, {
    params: {},
    streamCandidates: [raw],
    isActiveMountToken: () => true,
    getPlayerStreamProbe: () => null,
    rememberSelectedStreamPreference() {},
    async playStreamByUrl(url) {
      this.played = {
        url,
        plan: this.params.playbackPlan,
        attempt: this.params.unverifiedPlayback
      };
    }
  });
  await ctx.playStreamCandidate(raw);
  assert.equal(prepared, 1);
  assert.equal(ctx.played.url, "https://media.test/resolved");
  assert.equal(ctx.played.plan.route, "client");
  assert.equal(ctx.played.attempt.sourceUrl, "https://media.test/resolved");
  assert.equal(raw.url, "https://media.test/resolved");
});

test("known server copy preserves the selected audio index during candidate handoff", async () => {
  const from = source.indexOf("  async prepareResolvedCandidatePlayback(");
  const to = source.indexOf("  async playStreamCandidate(", from);
  let index;
  const methods = vm.runInNewContext("({" + source.slice(from, to) + "})", {
    REMUX_POLICY: { mode: "server" },
    getDeviceCapabilities: () => ({}),
    clientRemuxPlan: () => null,
    StreamBadgeSettingsStore: { snapshot: () => ({}) },
    selectUnverifiedPlayback: () => null,
    classifyPlayback: () => ({ method: "remux", audioIndex: 3 }),
    traceHost: () => "media.test",
    prepareUnverifiedRemux: async (url, options) => {
      index = options.audioIndex;
      return { url: "/hls/index.m3u8", plan: null };
    }
  });
  const ctx = Object.assign(methods, {
    params: {},
    getPlayerStreamProbe: () => ({ container: "mkv" })
  });
  const delivery = await ctx.prepareResolvedCandidatePlayback(
    { id: "s" },
    "https://media.test/source",
    () => true
  );
  assert.equal(index, 3);
  assert.equal(delivery.url, "/hls/index.m3u8");
  assert.equal(ctx.params.unverifiedPlayback, null);
});

test("ambiguous direct stall can be remuxed manually without enabling filename fallback", async () => {
  let calls = 0;
  const ctx = harness(async (_url) => {
    calls++;
    return { url: "/hls/index.m3u8", plan: null };
  });
  assert.equal(await ctx.tryUnverifiedRemuxAfterFailure({ mediaErrorCode: 0 }), false);
  assert.equal(ctx.handleUnverifiedPlaybackAction("copy"), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(ctx.params.unverifiedPlayback.route, "remux");
  assert.equal(ctx.params.unverifiedPlayback.remuxTried, true);
  assert.equal(ctx.plays[0].url, "/hls/index.m3u8");
});
