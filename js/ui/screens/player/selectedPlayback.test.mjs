import { classifyPlayback } from "../../../core/player/playbackMethod.js";
import { classifyStreamFilename } from "../../../core/streams/streamCompatibilityFilter.js";
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
  probeStream = "unknown-or-transcode",
  probeResult = null,
  convert = async () => null,
  copy = async (url) => ({ url, plan: { route: "client", method: "remux" } }),
  measuredRemuxPlan = { route: "client", method: "remux" }
} = {}) {
  const probes = [],
    probeOptions = [],
    routes = [],
    stages = [],
    playbackAttempts = [];
  let cancellations = 0;
  let actions = null;
  const caps = {
    h264: true,
    hevc: false,
    aac: true,
    dts: false,
    containers: { mp4: true, mkv: false }
  };
  const ctx = Object.assign(
    methods(
      [
        "prepareResolvedCandidatePlayback",
        "readSelectedPlaybackProbe",
        "prepareProbedPlaybackTranscode"
      ],
      {
        PROBE_MODE: "client",
        PROBE_ENDPOINT: "",
        PROBE_CLIENT_CONCURRENCY: 1,
        isTranscodeEnabled: () => true,
        createStreamProber: () => ({
          probe: async (url, options) => {
            probes.push(url);
            probeOptions.push(options);
            return probeResult;
          },
          failureReason: () => "timeout",
          cancelAll: () => cancellations++
        }),
        assessPlaybackCapabilities: (probe) => probe,
        classifyPlayback,
        classifyStreamFilename,
        streamProbeIdentity: (stream) => stream.id,
        playerStreamProbeKey,
        prepareMeasuredTranscode: convert,
        selectFilenamePlaybackAttempt: (options) =>
          selectFilenamePlaybackAttempt({
            ...options,
            policy: { mode: "client" },
            audioEndpoint: options.audioEndpoint
          }),
        PlayerSettingsStore: {
          get: () => ({ filenamePlaybackRoutingEnabled: enabled, probeStream })
        },
        StartupLoadingOverlay: {
          setStage: (stage) => stages.push(stage),

          setBackHandler() {},
          setProbeActions: (value) => {
            actions = value;
            stages.push("probing");
            return () => {
              actions = null;
            };
          },
          setPlaybackAttempt: (attempt) => playbackAttempts.push(attempt)
        },
        getDeviceCapabilities: () => caps,
        prepareUnverifiedRemux: async (url) => {
          routes.push("remux");
          return copy(url);
        },
        SelectedStreamDelivery: {
          resolvePlayerSource: async (stream) => {
            routes.push("cached-remux");
            return stream.url;
          }
        },
        clientRemuxPlan: () => measuredRemuxPlan,
        selectedPlaybackTask,
        extractPlaybackHttpStatus: () => 0,
        REMUX_POLICY: { mode: "client" },
        traceHost: () => "media.test"
      }
    ),
    {
      params: { prepareSelectedSource: true },
      _playerListProbeResults: new Map(),
      getPlayerStreamProbe: () => facts,
      getLoadingOverlayMeta: () => ({}),
      tryUnverifiedRemuxAfterFailure: async () => false
    }
  );
  return {
    ctx,
    probes,
    probeOptions,
    routes,
    stages,
    playbackAttempts,
    cancellations: () => cancellations,
    actions: () => actions
  };
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
    a = { ...row("a"), name: "Movie H264 AAC.mp4" };
  const result = await h.ctx.prepareResolvedCandidatePlayback(a, a.url, () => true);
  assert.equal(result.url, a.url);
  assert.deepEqual(h.probes, []);
  assert.equal(h.ctx.params.unverifiedPlayback.route, "direct");
  assert.deepEqual(h.routes, []);
});
test("ready HLS skips probing and a transcode hint with no metadata falls back to Direct", async () => {
  const h = selected(),
    a = { ...row("a"), name: "Movie HEVC AAC.mkv" };
  assert.equal(
    (await h.ctx.prepareResolvedCandidatePlayback(a, "https://media.test/movie.m3u8", () => true))
      .url,
    "https://media.test/movie.m3u8"
  );
  assert.deepEqual(h.probes, []);
  assert.equal((await h.ctx.prepareResolvedCandidatePlayback(a, a.url, () => true)).url, a.url);
  assert.deepEqual(h.routes, []);
  assert.deepEqual(h.probes, [a.url]);
});
test("Unknown waits for probe even with filename routing disabled, then follows the measured route", async () => {
  const a = row("unknown");
  const facts = { container: "mkv", videoCodec: "h264", audioCodec: "aac" };
  for (const cached of [true, false]) {
    let release;
    const probeResult = new Promise((resolve) => {
      release = resolve;
    });
    const h = selected({ enabled: false, facts: cached ? facts : null, probeResult });
    const pending = h.ctx.prepareResolvedCandidatePlayback(a, a.url, () => true);
    if (!cached) {
      await Promise.resolve();
      assert.deepEqual(h.probes, [a.url]);
      assert.equal(h.probeOptions[0].timeoutMs, Infinity);
      assert.deepEqual(h.stages, ["probing"]);
      assert.deepEqual(h.routes, []);
      release(facts);
    }
    assert.equal((await pending).plan.method, "remux");
    assert.deepEqual(h.routes, ["cached-remux"]);
    assert.deepEqual(h.probes, cached ? [] : [a.url]);
    assert.deepEqual(h.stages, cached ? ["opening", "loading"] : ["probing", "opening", "loading"]);
  }
});
test("a selected probe can wait indefinitely and Skip cancels only that probe", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let releaseProbe;
  const h = selected({
    probeResult: new Promise((resolve) => {
      releaseProbe = resolve;
    })
  });
  const a = row("unknown");
  h.ctx._selectedSourceAbort = new AbortController();
  const pending = h.ctx.prepareResolvedCandidatePlayback(a, a.url, () => true);
  await Promise.resolve();
  t.mock.timers.tick(60000);
  assert.deepEqual(h.probes, [a.url]);
  assert.deepEqual(h.playbackAttempts, []);
  assert.equal(h.cancellations(), 0);
  h.actions().onSkip();
  assert.equal((await pending).url, a.url);
  assert.equal(h.cancellations(), 1);
  assert.equal(h.ctx._selectedSourceAbort.signal.aborted, false);
  assert.equal(h.playbackAttempts[0].route, "direct");
  assert.equal(h.playbackAttempts[0].failedRoute, undefined);
  assert.equal(h.actions(), null);
  releaseProbe({ container: "mkv", videoCodec: "h264", audioCodec: "aac" });
  await Promise.resolve();
  assert.deepEqual(h.routes, []);
  assert.equal(h.ctx._playerListProbeResults.size, 0);
});

test("Choose Stream cancels preparation before playback can start", async () => {
  const h = selected({ probeResult: new Promise(() => {}) });
  const a = row("unknown");
  h.ctx._selectedSourceAbort = new AbortController();
  h.ctx.navigateBackToStreamScreen = (options) => {
    assert.equal(options.chooseStream, true);
    h.ctx._selectedSourceAbort.abort();
  };
  const pending = h.ctx.prepareResolvedCandidatePlayback(a, a.url, () => true);
  await Promise.resolve();
  h.actions().onChooseStream();
  assert.equal(await pending, null);
  assert.equal(h.cancellations(), 1);
  assert.deepEqual(h.playbackAttempts, []);
});

test("Choose Stream returns to the loaded list in manual mode even when Back normally goes Home", () => {
  const stream = row("source");
  const abort = new AbortController();
  const ctx = Object.assign(
    methods(["navigateBackToStreamScreen"], {
      Router: { getCurrent: () => "player" },
      StartupLoadingOverlay: { finish() {} },
      PlayerController: { stop() {} }
    }),
    {
      params: {
        returnToStreamOnBack: false,
        handoffReturnRoute: "home",
        streamCandidatesComplete: false
      },
      streamCandidates: [stream],
      _selectedSourceAbort: abort,
      buildReturnStreamRouteParamsFromPlayer: () => ({
        itemId: "movie",
        autoResolvedStreamId: stream.id
      }),
      navigateToPlayerBackFallback({ shouldReturnToStream, streamParams }) {
        assert.equal(shouldReturnToStream, true);
        assert.equal(streamParams.manualSelection, true);
        assert.equal(streamParams.autoSelectionFinished, true);
        assert.equal(streamParams.autoResolvedStreamId, null);
        assert.equal(streamParams.autoResolvedStreams[0], stream);
        assert.equal(streamParams.autoResolvedStreamsComplete, false);
      }
    }
  );
  assert.equal(ctx.navigateBackToStreamScreen({ chooseStream: true }), true);
  assert.equal(abort.signal.aborted, true);
});

test("an Unknown source starts verified Direct or the selected transcode route", async () => {
  const a = row("unknown");
  for (const [probe, method] of [
    [{ container: "mp4", videoCodec: "h264", audioCodec: "aac" }, "direct"],
    [{ container: "mkv", videoCodec: "h264", audioCodec: "dts" }, "audio-transcode"],
    [{ container: "mkv", videoCodec: "hevc", audioCodec: "aac" }, "transcode"]
  ]) {
    const h = selected({
      facts: probe,
      convert: async ({ sourceUrl }) => {
        assert.notEqual(method, "direct");
        return { url: sourceUrl, route: "client-" + method, plan: { method } };
      }
    });
    const delivery = await h.ctx.prepareResolvedCandidatePlayback(a, a.url, () => true);
    assert.deepEqual(h.probes, []);
    assert.equal(
      h.ctx.params.unverifiedPlayback.route,
      method === "direct" ? method : "client-" + method
    );
    if (method !== "direct") {
      assert.equal(delivery.plan.method, method);
      assert.equal(h.ctx.params.unverifiedPlayback.routeFallbackEnabled, true);
      assert.equal(h.ctx.params.unverifiedPlayback.rawTried, false);
      assert.equal(h.ctx.params.unverifiedPlayback.remuxTried, false);
    }
  }
});

test("an Unknown stream reuses probe facts keyed by its original URL", async () => {
  const a = { ...row("unknown"), url: "http://media.test/unknown" };
  const h = selected();
  h.ctx.getPlayerStreamProbe = (candidate) =>
    candidate.url === a.url ? { container: "mkv", videoCodec: "h264", audioCodec: "aac" } : null;
  const target = "https://media.test/unknown";
  const delivery = await h.ctx.prepareResolvedCandidatePlayback(a, target, () => true);
  assert.equal(delivery.plan.method, "remux");
  assert.deepEqual(h.probes, []);
});

test("a verified Remux refuses an unchanged URL without a Remux plan", async () => {
  const a = row("unknown");
  const h = selected({
    facts: { container: "mkv", videoCodec: "h264", audioCodec: "aac" },
    measuredRemuxPlan: null
  });
  await assert.rejects(
    h.ctx.prepareResolvedCandidatePlayback(a, a.url, () => true),
    /Verified Remux is unavailable/
  );
  assert.deepEqual(h.routes, ["cached-remux"]);
});

test("Unknown keeps probe priority after a resolver adds a known name, and falls back to Direct if probe fails", async () => {
  const a = { ...row("resolved"), name: "Movie H264 AAC.mp4" };
  const h = selected();
  const result = await h.ctx.prepareResolvedCandidatePlayback(a, a.url, () => true, true);
  assert.deepEqual(h.probes, [a.url]);
  assert.equal(result.url, a.url);
  assert.equal(h.ctx.params.unverifiedPlayback.route, "direct");
  assert.deepEqual(h.routes, []);
});
test("Always reads metadata before a filename-based Direct attempt, unless it is already cached", async () => {
  const a = { ...row("a"), name: "Movie H264 AAC.mp4" };
  const facts = { container: "mkv", videoCodec: "h264", audioCodec: "aac" };
  for (const cached of [true, false]) {
    const h = selected({ probeStream: "always", facts: cached ? facts : null, probeResult: facts });
    await h.ctx.prepareResolvedCandidatePlayback(a, a.url, () => true);
    assert.deepEqual(h.probes, cached ? [] : [a.url]);
    assert.deepEqual(h.routes, ["cached-remux"]);
  }
});
test("audio transcode filename hints wait for metadata before handing a plan to the player", async () => {
  const a = { ...row("a"), name: "Movie H264 DTS.mkv" };
  const facts = { container: "mkv", videoCodec: "h264", audioCodec: "dts" };
  const h = selected({
    probeResult: facts,
    convert: async ({ sourceUrl, probe }) => {
      assert.equal(probe, facts);
      return {
        url: sourceUrl,
        plan: { route: "client", method: "audio-transcode" },
        route: "client-audio-transcode"
      };
    }
  });
  const result = await h.ctx.prepareResolvedCandidatePlayback(a, a.url, () => true);
  assert.equal(result.plan.method, "audio-transcode");
  assert.deepEqual(h.probes, [a.url]);
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

test("Direct uses 13s and remux uses 17s while audio conversion retains 30s", (t) => {
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
      route === "audio-transcode" ? 21000 : route === "remux" ? 8000 : 4000
    );
  }
});

test("startup errors retain the unresolved candidate for automatic fallback", () => {
  const calls = [];
  const candidate = { id: "unresolved", addonName: "A", infoHash: "a".repeat(40) };
  const ctx = Object.assign(methods(["showStartupError"], { PlayerController: {} }), {
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

test("remux metadata and frame waits share the preparation deadline", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 10000 });
  const ctx = Object.assign(methods(["getPlaybackStallTimeoutMs"], {}), {
    activePlaybackUrl: "media",
    startupReadiness: { startedAt: 9500, metadataAt: null },
    params: {
      unverifiedPlayback: {
        mediaUrl: "media",
        routeFallbackEnabled: true,
        route: "remux",
        routeStartedAt: 1000
      }
    }
  });
  assert.equal(ctx.getPlaybackStallTimeoutMs({ startup: true }), 8000);
  ctx.startupReadiness.metadataAt = 9900;
  assert.equal(
    ctx.getPlaybackStallTimeoutMs({ startup: true }),
    8000,
    "metadata must not restart the budget"
  );
  t.mock.timers.tick(8000);
  assert.equal(ctx.getPlaybackStallTimeoutMs({ startup: true }), 1);
});

test("transcode mode chooses audio and video locally, or uses only the server", async () => {
  const { prepareMeasuredTranscode } =
    await import("../../../core/player/selectedStreamDelivery.js");
  const codec = function () {};
  const scope = {
    isSecureContext: true,
    MediaSource: { isTypeSupported: () => true },
    navigator: { storage: { getDirectory() {} } },
    Worker: codec,
    VideoEncoder: codec
  };
  const options = {
    sourceUrl: "https://media.test/video.mkv",
    probe: { container: "mkv", videoCodec: "hevc", audioCodec: "aac" },
    capabilities: {
      hevc: false,
      h264: true,
      aac: true,
      dts: false,
      containers: { mkv: false, mp4: true }
    },
    mode: "client",
    scope,
    endpoint: "/api/transcode"
  };
  const local = await prepareMeasuredTranscode(options);
  assert.equal(local.plan.method, "transcode");
  assert.equal(local.url, options.sourceUrl);
  const audio = await prepareMeasuredTranscode({
    ...options,
    probe: { container: "mkv", videoCodec: "h264", audioCodec: "dts" }
  });
  assert.equal(audio.plan.method, "audio-transcode");
  assert.equal(audio.route, "client-audio-transcode");
  const pcm = {
    ...options,
    probe: { container: "mkv", videoCodec: "h264", audioCodec: "pcm_s24le" }
  };
  assert.equal(await prepareMeasuredTranscode(pcm), null);
  assert.equal(
    (await prepareMeasuredTranscode({ ...pcm, afterPlaybackFailure: true })).plan.method,
    "audio-transcode"
  );
  const server = await prepareMeasuredTranscode({
    ...options,
    mode: "server",
    token: "test",
    access: {
      resolve: async () => ({ reachable: true, hls: true, fullVideo: true, mode: "token" })
    }
  });
  assert.equal(server.plan, null);
  assert.equal(server.waitForPlaylist, true);
  assert.deepEqual(server.output, {
    processing: "transcode",
    outputContainer: "hls-fmp4",
    video: "h264",
    audio: "aac",
    channels: 2
  });
  const serverFile = await prepareMeasuredTranscode({
    ...options,
    probe: { container: "mkv", videoCodec: "h264", audioCodec: "dts" },
    mode: "server",
    token: "test",
    access: {
      resolve: async () => ({ reachable: true, hls: false, fullVideo: false, mode: "token" })
    }
  });
  assert.equal(serverFile.route, "audio-transcode");
  assert.equal(serverFile.waitForPlaylist, false);
  assert.doesNotMatch(serverFile.url, /\/hls\//);
  assert.match(server.url, /\/hls\/index\.m3u8.*v=h264&a=aac/);
  assert.equal(await prepareMeasuredTranscode({ ...options, mode: "none" }), null);
  assert.equal(await prepareMeasuredTranscode({ ...options, probe: null }), null);
});
