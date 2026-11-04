import { selectFilenamePlaybackAttempt } from "../../../core/player/unverifiedPlayback.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { selectedPlaybackTask } from "../../../core/player/selectedPlaybackTask.js";
import { autoPlayCandidates } from "../../../core/streams/streamAutoPlaySelector.js";
import {
  nextEpisodeSelectionOptions,
  playerStreamProbeKey
} from "../../../core/streams/playerStreamPolicy.js";
const source = readFileSync(new URL("./playerScreen.js", import.meta.url), "utf8");
const row = (id, addonName = "A") => ({ id, addonName, url: "https://media.test/" + id });
function methods(names, deps) {
  const body = names
    .map((name) => {
      const start = source.search(new RegExp("^  (?:async )?" + name + "\\(", "m"));
      assert.ok(start >= 0, name);
      return source.slice(start, source.indexOf("\n  },", start) + 6);
    })
    .join("\n");
  return vm.runInNewContext("({" + body + "})", {
    URL,
    Date,
    Set,
    Map,
    AbortController,
    console: { warn() {} },
    ...deps
  });
}
function selected({
  facts = null,
  enabled = true,
  copy = async (url) => ({ url, plan: { route: "client", method: "remux" } })
} = {}) {
  const probes = [],
    routes = [],
    stages = [];
  const caps = {
    h264: true,
    hevc: false,
    aac: true,
    dts: false,
    containers: { mp4: true, mkv: false }
  };
  const ctx = Object.assign(
    methods(["prepareResolvedCandidatePlayback"], {
      selectFilenamePlaybackAttempt: (options) =>
        selectFilenamePlaybackAttempt({
          ...options,
          policy: { mode: "client" },
          audioEndpoint: "/api/transcode"
        }),
      PlayerSettingsStore: { get: () => ({ filenamePlaybackRoutingEnabled: enabled }) },
      StartupLoadingOverlay: { setStage: (stage) => stages.push(stage) },
      getDeviceCapabilities: () => caps,
      prepareUnverifiedRemux: async (url) => {
        routes.push("remux");
        return copy(url);
      },
      prepareUnverifiedAudioTranscode: async (_url) => {
        routes.push("audio-transcode");
        return { url: "/api/transcode/hls/index.m3u8?v=copy&a=aac", plan: null };
      },
      SelectedStreamDelivery: {
        resolvePlayerSource: async (stream) => {
          routes.push("cached-remux");
          return stream.url;
        }
      },
      clientRemuxPlan: () => ({ route: "client", method: "remux" }),
      selectedPlaybackTask,
      extractPlaybackHttpStatus: () => 0,
      REMUX_POLICY: { mode: "client" },
      traceHost: () => "media.test"
    }),
    {
      params: { prepareSelectedSource: true },
      _playerListProbeResults: new Map(),
      getPlayerStreamProbe: () => facts,
      tryUnverifiedRemuxAfterFailure: async () => false
    }
  );
  return { ctx, probes, routes, stages };
}
test("filename remux starts immediately without a separate metadata read", async () => {
  const h = selected(),
    a = { ...row("a"), name: "Movie H264 AAC.mkv" };
  const result = await h.ctx.prepareResolvedCandidatePlayback(a, a.url, () => true);
  assert.deepEqual(h.routes, ["remux"]);
  assert.deepEqual(h.probes, []);
  assert.equal(result.plan.route, "client");
});
test("disabling filename routing starts Direct even when cached facts indicate remux", async () => {
  const h = selected({
      enabled: false,
      facts: { container: "mkv", videoCodec: "h264", audioCodec: "aac" }
    }),
    a = row("a");
  const result = await h.ctx.prepareResolvedCandidatePlayback(a, a.url, () => true);
  assert.equal(result.url, a.url);
  assert.equal(h.ctx.params.unverifiedPlayback.route, "direct");
  assert.deepEqual(h.routes, []);
});
test("ready HLS and unsupported-video filename estimates never request a video encoder", async () => {
  const h = selected(),
    a = { ...row("a"), name: "Movie HEVC AAC.mkv" };
  assert.equal(
    (await h.ctx.prepareResolvedCandidatePlayback(a, "https://media.test/movie.m3u8", () => true))
      .url,
    "https://media.test/movie.m3u8"
  );
  assert.equal((await h.ctx.prepareResolvedCandidatePlayback(a, a.url, () => true)).url, a.url);
  assert.deepEqual(h.routes, []);
});
test("late filename route preparation cannot replace a stream after Back", async () => {
  let release,
    active = true;
  const h = selected({
      copy: () =>
        new Promise((resolve) => {
          release = resolve;
        })
    }),
    a = { ...row("a"), name: "Movie H264 AAC.mkv" };
  const pending = h.ctx.prepareResolvedCandidatePlayback(a, a.url, () => active);
  for (let i = 0; i < 4; i++) await Promise.resolve();
  active = false;
  release({ url: a.url, plan: { route: "client" } });
  assert.equal(await pending, null);
  assert.equal(h.ctx.params.playbackPlan, undefined);
});
function retry({
  automatic = true,
  rows = [row("first"), row("forbidden", "B"), row("second")],
  complete = true
} = {}) {
  const navigations = [],
    plays = [];
  const settings = {
    streamAutoPlayMode: "FIRST_STREAM",
    streamAutoPlaySource: "INSTALLED_ADDONS_ONLY",
    streamAutoPlaySelectedAddons: ["A"]
  };
  const ctx = Object.assign(
    methods(["advanceAfterSelectedSourceFailure"], {
      PlayerController: { stop() {} },
      PlayerSettingsStore: { get: () => settings },
      addonRepository: { getCachedInstalledAddons: () => [{ name: "A" }, { name: "B" }] },
      autoPlayCandidates,
      nextEpisodeSelectionOptions,
      playerStreamProbeKey,
      selectedPlaybackTask,
      extractPlaybackHttpStatus: () => 0,
      normalizeItemType: (v) => v,
      StartupLoadingOverlay: { finish() {}, setStage() {} },
      Router: { navigate: async (...args) => navigations.push(args) }
    }),
    {
      params: {
        automaticSourceSelection: automatic,
        streamCandidatesComplete: complete,
        videoId: "movie",
        itemType: "movie"
      },
      streamCandidates: rows,
      current: rows[0],
      playerMountToken: 1,
      _startupSourceFailures: new Set(),
      getCurrentStreamCandidate() {
        return this.current;
      },
      getCurrentStreamBingeGroup: () => "",
      isActiveMountToken(token) {
        return token === this.playerMountToken;
      },
      clearPlaybackStallGuard() {},
      buildReturnStreamRouteParamsFromPlayer: () => ({ itemId: "movie" }),
      async playStreamCandidate(stream) {
        this.current = stream;
        plays.push(stream.id);
      },
      normalizeStreamCandidates(list) {
        return [...new Map(list.map((stream) => [stream.id, stream])).values()];
      }
    }
  );
  return { ctx, navigations, plays };
}
test("autoplay skips disallowed addons, tries identities once, then opens the picker", async () => {
  const h = retry();
  await h.ctx.advanceAfterSelectedSourceFailure("bad");
  assert.deepEqual(h.plays, ["second"]);
  await h.ctx.advanceAfterSelectedSourceFailure("bad");
  assert.equal(h.navigations.length, 1);
  assert.equal(h.navigations[0][0], "stream");
  assert.equal(h.navigations[0][1].manualSelection, true);
  assert.match(h.navigations[0][1].playbackFailureMessage, /permitted streams/);
});
test("manual failure returns to the list with a notice and never tries another stream", async () => {
  const h = retry({ automatic: false });
  await h.ctx.advanceAfterSelectedSourceFailure("Audio conversion unavailable");
  assert.equal(h.plays.length, 0);
  assert.equal(h.navigations.length, 1);
  assert.match(h.navigations[0][1].playbackFailureMessage, /Audio conversion/);
});
test("duplicate startup errors cannot launch two replacement sources", async () => {
  const h = retry();
  await Promise.all([
    h.ctx.advanceAfterSelectedSourceFailure("bad"),
    h.ctx.advanceAfterSelectedSourceFailure("bad")
  ]);
  assert.deepEqual(h.plays, ["second"]);
});
test("Back invalidates a pending automatic replacement", async () => {
  const h = retry();
  const pending = h.ctx.advanceAfterSelectedSourceFailure("bad");
  h.ctx.playerBackNavigationInProgress = true;
  await pending;
  assert.equal(h.plays.length, 0);
  assert.equal(h.navigations.length, 0);
});
test("a failed early arrival can discover later permitted addon rows without retrying the same file", async () => {
  const h = retry({ rows: [row("first")], complete: false });
  let calls = 0;
  h.ctx.getPlayableStreamsForVideo = async () => {
    calls++;
    return [row("forbidden", "B"), row("second")];
  };
  await h.ctx.advanceAfterSelectedSourceFailure("bad");
  assert.equal(calls, 1);
  assert.deepEqual(h.plays, ["second"]);
});
test("a known processing outage prevents another processing preparation while Direct remains usable", async () => {
  const h = selected();
  h.ctx._processingUnavailable = true;
  const a = { ...row("a"), name: "Movie H264 AAC.mkv" };
  await assert.rejects(
    h.ctx.prepareResolvedCandidatePlayback(a, a.url, () => true),
    /service is unavailable/
  );
  assert.equal(h.routes.length, 0);
  const d = selected({ enabled: false });
  d.ctx._processingUnavailable = true;
  assert.equal((await d.ctx.prepareResolvedCandidatePlayback(a, a.url, () => true)).url, a.url);
});
test("selected preparation aborts immediately and never starts already-cancelled work", async (t) => {
  const controller = new AbortController();
  let calls = 0;
  controller.abort();
  await assert.rejects(
    selectedPlaybackTask(() => calls++, { signal: controller.signal }),
    { name: "AbortError" }
  );
  assert.equal(calls, 0);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const task = selectedPlaybackTask(() => new Promise(() => {}), { timeoutMs: 100 });
  const rejection = assert.rejects(task, /timed out/);
  t.mock.timers.tick(100);
  await rejection;
});
test("list and discovery entry points contain no background metadata reader or label rendering", () => {
  const stream = readFileSync(new URL("../stream/streamScreen.js", import.meta.url), "utf8");
  const detail = readFileSync(new URL("../detail/metaDetailsScreen.js", import.meta.url), "utf8");
  assert.doesNotMatch(
    stream,
    /createStreamProber|scheduleUnknownProbes|renderStreamPlaybackBadge|probeStreamCandidate/
  );
  assert.doesNotMatch(detail, /inspectAutoPlayStreams|keepOnlyDirectResolution|createStreamProber/);
  assert.doesNotMatch(source, /schedulePlayerStreamProbes/);
});

test("Back during Continue Watching also prevents the deferred automatic launch", () => {
  const detail = readFileSync(new URL("../detail/metaDetailsScreen.js", import.meta.url), "utf8");
  const start = detail.indexOf("  cancelRouteHandoff(");
  const body = detail.slice(start, detail.indexOf("\n  },", start) + 6);
  let exits = 0,
    releases = 0;
  const ctx = Object.assign(
    vm.runInNewContext("({" + body + "})", {
      Router: { backFromPendingNavigation: () => exits++ }
    }),
    {
      params: { autoOpenContinueWatching: true },
      autoStreamResolveToken: 1,
      releaseRouteHandoff: () => releases++
    }
  );
  ctx.cancelRouteHandoff();
  assert.equal(ctx.params.autoOpenContinueWatching, false);
  assert.equal(ctx.autoStreamResolveToken, 2);
  assert.equal(exits, 1);
  assert.equal(releases, 1);
});

test("new playback attempts bound Direct to 15s and processed routes to 30s", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 10000 });
  const ctx = Object.assign(methods(["getPlaybackStallTimeoutMs"], {}), {
    activePlaybackUrl: "media",
    startupReadiness: { startedAt: 1000, metadataAt: 9500 },
    params: { unverifiedPlayback: { mediaUrl: "media", routeFallbackEnabled: true } }
  });
  for (const route of ["direct", "remux", "audio-transcode"]) {
    ctx.params.unverifiedPlayback.route = route;
    assert.equal(
      ctx.getPlaybackStallTimeoutMs({ startup: true }),
      route === "direct" ? 6000 : 21000
    );
  }
});

test("startup errors retain the unresolved candidate for automatic fallback", () => {
  const calls = [];
  const candidate = { id: "unresolved", addonName: "A", infoHash: "a".repeat(40) };
  const ctx = Object.assign(methods(["showStartupError"], {}), {
    params: { prepareSelectedSource: true },
    _preparingSelectedSource: true,
    advanceAfterSelectedSourceFailure: (...args) => calls.push(args)
  });
  ctx.showStartupError("Cannot resolve", { streamCandidate: candidate, reason: "debrid-resolve" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].streamCandidate, candidate);
});

test("unresolved debrid failures exhaust permitted candidates once despite a stale current source", async () => {
  const rows = ["first", "second", "third"].map((id, index) => ({
    id,
    addonName: "A",
    infoHash: String(index + 1).repeat(40),
    fileIdx: 0
  }));
  rows.splice(1, 0, { id: "forbidden", addonName: "B", infoHash: "f".repeat(40), fileIdx: 0 });
  const h = retry({ rows });
  // The media accessor cannot identify a candidate before it has a playable URL.
  h.ctx.getCurrentStreamCandidate = () => null;
  for (const candidate of rows.filter((stream) => stream.addonName === "A")) {
    await h.ctx.advanceAfterSelectedSourceFailure("Cannot resolve", {
      streamCandidate: candidate,
      reason: "debrid-resolve"
    });
  }
  assert.deepEqual(h.plays, ["second", "third"]);
  assert.equal(h.ctx._startupSourceFailures.size, 3);
  assert.equal(h.navigations.length, 1);
  assert.equal(h.navigations[0][1].autoSelectionFinished, true);
});
