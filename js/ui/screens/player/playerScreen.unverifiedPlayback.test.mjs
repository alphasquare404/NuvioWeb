import { selectedPlaybackTask } from "../../../core/player/selectedPlaybackTask.js";
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import {
  selectFilenamePlaybackAttempt,
  nextPlaybackFallbackRoute,
  canTryUnverifiedRemux,
  canTryUnverifiedAudioTranscode
} from "../../../core/player/unverifiedPlayback.js";
const source = readFileSync(new URL("./playerScreen.js", import.meta.url), "utf8");
function harness(prepare, mode = "server") {
  const text = source.slice(
    source.indexOf("  async runUnverifiedPlaybackAttempt("),
    source.indexOf("  startPlayerControllerPlayback(")
  );
  const methods = vm.runInNewContext("({" + text + "})", {
    StartupLoadingOverlay: {},
    REMUX_POLICY: { mode },
    canTryUnverifiedRemux,
    canTryUnverifiedAudioTranscode: (attempt, failure) =>
      canTryUnverifiedAudioTranscode(attempt, failure, "/api/transcode"),
    prepareUnverifiedAudioTranscode: async () => null,
    getDeviceCapabilities: () => ({}),
    extractPlaybackHttpStatus: () => 0,
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

test("ambiguous startup automatically tries remux once, with no copy action or button", async () => {
  let calls = 0;
  const ctx = harness(async () => {
    calls++;
    return { url: "/hls/index.m3u8", plan: null };
  });
  assert.equal(
    await ctx.tryUnverifiedRemuxAfterFailure({ mediaErrorCode: 0, startupStall: true }),
    true
  );
  assert.equal(calls, 1);
  assert.equal(ctx.params.unverifiedPlayback.route, "remux");
  assert.equal(ctx.handleUnverifiedPlaybackAction("copy"), false);
  assert.doesNotMatch(source, /Try remux<\/button>|data-player-error-action="copy"/);
});

test("audio fallback reservation is single use and ignores a result after switching sources", async () => {
  let complete,
    prepared = 0;
  const ctx = harness(async () => ({ url: "/remux", plan: null }));
  ctx.params.unverifiedPlayback.route = "remux";
  ctx.params.unverifiedPlayback.remuxTried = true;
  const methodsText = source.slice(
    source.indexOf("  async runUnverifiedPlaybackAttempt("),
    source.indexOf("  startPlayerControllerPlayback(")
  );
  Object.assign(
    ctx,
    vm.runInNewContext("({" + methodsText + "})", {
      StartupLoadingOverlay: {},
      REMUX_POLICY: { mode: "server" },
      canTryUnverifiedRemux,
      canTryUnverifiedAudioTranscode: (a, f) =>
        canTryUnverifiedAudioTranscode(a, f, "/api/transcode"),
      prepareUnverifiedAudioTranscode: () => {
        prepared++;
        return new Promise((r) => {
          complete = r;
        });
      },
      getDeviceCapabilities: () => ({})
    })
  );
  const first = ctx.tryUnverifiedRemuxAfterFailure({ mediaErrorCode: 4 });
  assert.equal(await ctx.tryUnverifiedRemuxAfterFailure({ mediaErrorCode: 4 }), true);
  assert.equal(prepared, 1);
  ctx.activePlaybackUrl = "https://other.test/video";
  complete({ url: "/audio", plan: null });
  await first;
  assert.equal(ctx.plays.length, 0);
  assert.equal(ctx.params.unverifiedPlayback.audioTranscodeTried, true);
});

test("client and server both leave an unverified Direct startup stall through the configured copy path", async () => {
  for (const mode of ["client", "server"]) {
    const ctx = harness(
      async (url) =>
        mode === "client"
          ? { url, plan: { sourceUrl: url, route: "client", method: "remux" } }
          : { url: "/api/transcode/hls/index.m3u8?v=copy&a=copy", plan: null },
      mode
    );
    assert.equal(await ctx.tryUnverifiedRemuxAfterFailure({ startupStall: true }), true);
    assert.equal(ctx.plays.length, 1);
    assert.equal(ctx.params.unverifiedPlayback.remuxTried, true);
    assert.equal(ctx.params.playbackPlan?.route || "server", mode);
    assert.equal(ctx.plays[0].options.preservePendingRestore, true);
  }
});

test("verified audio fallback starts existing server delivery once and preserves pending resume", async () => {
  const ctx = harness(async () => ({ url: "/remux", plan: null }));
  ctx.params.unverifiedPlayback.route = "remux";
  ctx.params.unverifiedPlayback.remuxTried = true;
  const methodsText = source.slice(
    source.indexOf("  async runUnverifiedPlaybackAttempt("),
    source.indexOf("  startPlayerControllerPlayback(")
  );
  Object.assign(
    ctx,
    vm.runInNewContext("({" + methodsText + "})", {
      StartupLoadingOverlay: {},
      REMUX_POLICY: { mode: "server" },
      canTryUnverifiedRemux,
      canTryUnverifiedAudioTranscode: (a, f) =>
        canTryUnverifiedAudioTranscode(a, f, "/api/transcode"),
      prepareUnverifiedAudioTranscode: async () => ({
        url: "/api/transcode/hls/index.m3u8?v=copy&a=aac",
        plan: null
      }),
      getDeviceCapabilities: () => ({})
    })
  );
  assert.equal(await ctx.tryUnverifiedRemuxAfterFailure({ mediaErrorCode: 4 }), true);
  assert.equal(ctx.plays.length, 1);
  assert.equal(ctx.params.unverifiedPlayback.route, "audio-transcode");
  assert.equal(ctx.params.unverifiedPlayback.audioTranscodeTried, true);
  assert.equal(ctx.plays[0].options.preservePendingRestore, true);
  assert.equal(await ctx.tryUnverifiedRemuxAfterFailure({ mediaErrorCode: 4 }), false);
});

function routedHarness({
  initial = "direct",
  copy = async (_url) => ({
    url: "https://app.test/copied",
    plan: { route: "client", method: "remux" }
  })
} = {}) {
  const text = source.slice(
    source.indexOf("  async runUnverifiedPlaybackAttempt("),
    source.indexOf("  startPlayerControllerPlayback(")
  );
  const records = { copy: 0, audio: 0, plays: [], errors: [] };
  const methods = vm.runInNewContext("({" + text + "})", {
    StartupLoadingOverlay: {},
    AbortController,
    REMUX_POLICY: { mode: "client" },
    TRANSCODE_ENDPOINT: "/api/transcode",
    isTranscodeEnabled: () => true,
    nextPlaybackFallbackRoute,
    canTryUnverifiedRemux,
    canTryUnverifiedAudioTranscode,
    selectedPlaybackTask,
    prepareUnverifiedRemux: async (url) => {
      records.copy++;
      return copy(url);
    },
    getDeviceCapabilities: () => ({ aac: true }),
    extractPlaybackHttpStatus: () => 0,
    console: { warn() {} }
  });
  const attempt = selectFilenamePlaybackAttempt({
    stream: { url: "https://media.test/source" },
    enabled: false
  });
  Object.assign(attempt, {
    route: initial,
    rawTried: initial === "direct",
    remuxTried: initial === "remux",
    audioTranscodeTried: initial === "audio-transcode"
  });
  const ctx = Object.assign(methods, {
    params: { unverifiedPlayback: attempt },
    activePlaybackUrl: attempt.mediaUrl,
    playerMountToken: 1,
    getCurrentStreamCandidate: () => ({ id: "same" }),
    getStreamCandidateByUrl: () => ({ id: "same" }),
    isActiveMountToken: () => true,
    clearPlaybackStallGuard() {},
    getPlayerStreamProbe: () => null,
    readSelectedPlaybackProbe: async () => {
      records.audio++;
      return { container: "mkv", videoCodec: "h264", audioCodec: "dts" };
    },
    prepareProbedPlaybackTranscode: async (_url, probe) => {
      assert.equal(probe.audioCodec, "dts");
      return { url: "https://app.test/audio?v=copy&a=aac", plan: null, route: "audio-transcode" };
    },
    playStreamByUrl: async (url) => {
      ctx.activePlaybackUrl = url;
      records.plays.push(url);
    },
    showStartupError: (message) => records.errors.push(message)
  });
  return { ctx, records };
}
test("new Direct-first fallback runs copy then audio once and coalesces duplicate errors", async () => {
  const h = routedHarness();
  await Promise.all([
    h.ctx.tryUnverifiedRemuxAfterFailure({ mediaErrorCode: 4 }),
    h.ctx.tryUnverifiedRemuxAfterFailure({ mediaErrorCode: 4 })
  ]);
  assert.equal(h.records.copy, 1);
  assert.equal(h.records.plays.length, 1);
  await h.ctx.tryUnverifiedRemuxAfterFailure({ startupStall: true });
  assert.equal(h.records.audio, 1);
  assert.equal(h.records.plays.length, 2);
  assert.equal(await h.ctx.tryUnverifiedRemuxAfterFailure({ mediaErrorCode: 4 }), false);
});
test("software video decode failure is reported after Direct and Remux fail for the same stream", async () => {
  const { ctx } = routedHarness({ initial: "client-transcode" });
  const attempt = ctx.params.unverifiedPlayback;
  attempt.measuredTranscode = true;
  attempt.audioTranscodeTried = true;
  assert.equal(
    await ctx.tryUnverifiedRemuxAfterFailure({
      mediaErrorCode: 4,
      reason: "client-transcode-software-video-decode-failed"
    }),
    true
  );
  assert.equal(attempt.route, "direct");
  assert.equal(await ctx.tryUnverifiedRemuxAfterFailure({ startupStall: true }), true);
  assert.equal(attempt.route, "remux");
  assert.equal(await ctx.tryUnverifiedRemuxAfterFailure({ mediaErrorCode: 4 }), false);

  const start = source.indexOf("  showStartupError(");
  const end = source.indexOf("    if (this.startupReadiness) {", start);
  const { showStartupError } = vm.runInNewContext("({" + source.slice(start, end) + "}})", {
    t: (key) => key
  });
  const messages = [];
  ctx.params.prepareSelectedSource = true;
  ctx.advanceAfterSelectedSourceFailure = (message) => messages.push(message);
  showStartupError.call(ctx, "Playback error");
  showStartupError.call(ctx, "Playback error", { playbackUrl: "https://media.test/another" });
  assert.deepEqual(messages, ["player_error_software_video_decode", "Playback error"]);
});

test("wrong initial remux estimate falls back to original URL without trying remux twice", async () => {
  const h = routedHarness({ initial: "remux" });
  await h.ctx.tryUnverifiedRemuxAfterFailure({ mediaErrorCode: 4 });
  assert.equal(h.records.plays[0], "https://media.test/source");
  assert.equal(h.records.copy, 0);
  await h.ctx.tryUnverifiedRemuxAfterFailure({ mediaErrorCode: 4 });
  assert.equal(h.records.audio, 1);
  assert.equal(h.records.copy, 0);
});
test("a remux preparation error continues to the next supported route without exposing an intermediate error", async () => {
  const h = routedHarness({
    copy: async () => {
      throw new Error("unsupported container");
    }
  });
  await h.ctx.tryUnverifiedRemuxAfterFailure({ mediaErrorCode: 4 });
  assert.equal(h.records.copy, 1);
  assert.equal(h.records.audio, 1);
  assert.equal(h.records.errors.length, 0);
  assert.equal(h.ctx.params.unverifiedPlayback.busy, false);
});
test("Back during route preparation produces no late playback or error", async () => {
  let release;
  const h = routedHarness({
    copy: () =>
      new Promise((resolve) => {
        release = resolve;
      })
  });
  const pending = h.ctx.tryUnverifiedRemuxAfterFailure({ mediaErrorCode: 4 });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  h.ctx.playerBackNavigationInProgress = true;
  h.ctx._selectedSourceAbort.abort();
  release({ url: "https://app.test/late", plan: null });
  await pending;
  assert.equal(h.records.plays.length, 0);
  assert.equal(h.records.errors.length, 0);
  assert.equal(h.records.audio, 0);
});

test("automatic route entry refuses a repeated Direct while an explicit retry remains available", async () => {
  const h = routedHarness({ initial: "remux" });
  assert.equal(await h.ctx.runUnverifiedPlaybackAttempt("direct"), true);
  assert.equal(await h.ctx.runUnverifiedPlaybackAttempt("direct"), false);
  assert.equal(h.records.plays.length, 1);
  assert.equal(await h.ctx.runUnverifiedPlaybackAttempt("remux"), false);
  assert.equal(await h.ctx.tryUnverifiedRemuxAfterFailure({ httpStatus: 502 }), false);
  assert.equal(await h.ctx.runUnverifiedPlaybackAttempt("direct", { manual: true }), true);
  assert.equal(h.records.plays.length, 2);
});

test("server failure falls back to Direct once and terminates when processing is unavailable", async () => {
  const h = routedHarness({ initial: "remux" });
  assert.equal(await h.ctx.tryUnverifiedRemuxAfterFailure({ httpStatus: 502 }), true);
  assert.equal(h.ctx._processingUnavailable, true);
  assert.equal(h.records.plays.length, 1);
  for (let i = 0; i < 5; i++)
    assert.equal(await h.ctx.tryUnverifiedRemuxAfterFailure({ startupStall: true }), false);
  assert.equal(h.records.plays.length, 1);
  assert.equal(h.records.copy, 0);
  assert.equal(h.records.audio, 0);
});
