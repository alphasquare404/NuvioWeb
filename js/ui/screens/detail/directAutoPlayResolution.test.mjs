import { inspectAutoPlayStreams } from "../../../core/streams/streamAutoPlayProbe.js";
import { playerStreamProbeKey } from "../../../core/streams/playerStreamPolicy.js";
import * as hdrPolicy from "../../../core/streams/streamHdrPreference.js";
import * as labelPolicy from "../../../core/streams/streamLabelPolicy.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as selector from "../../../core/streams/streamAutoPlaySelector.js";
import { classifyPlayback } from "../../../core/player/playbackMethod.js";
import { streamLabelProbeLimit } from "../../../core/streams/streamLabelPolicy.js";
import {
  allowsPlayerStreamLabel,
  playerStreamProbeCandidates,
  filterPlayerStreams
} from "../../../core/streams/playerStreamPolicy.js";
import { filterStreamsByCompatibility } from "../../../core/streams/streamCompatibilityFilter.js";

import { withinStreamSelectionDeadline } from "../../../core/streams/streamAutoResolve.js";

const directProbe = { container: "mp4", videoCodec: "h264", audioCodec: "aac", audioChannels: 2 };
const settings = {
  streamAutoPlayMode: "FIRST_STREAM",
  streamAutoPlaySource: "INSTALLED_ADDONS_ONLY",
  streamAutoPlaySelectedAddons: ["AIOStreams"]
};
const row = (id, addonName = "AIOStreams") => ({
  id,
  addonName,
  name: id,
  url: "https://media.test/" + id
});

async function resolve(
  streams,
  {
    limit = 5,
    overrides = {},
    nonDirect = [],
    hdr = [],
    sdr = [],
    unresolved = [],
    deadlineAt = Infinity,
    probeDelayMs = 0,
    prepareDelayMs = 0,
    labelAddons = ["AIOStreams", "Torrentio", "Plugin"],
    clientLabelLimit = 5,
    playbackLabelSource = "FILE_METADATA",
    mode = "server",
    preferredBingeGroup = ""
  } = {}
) {
  const source = await readFile(new URL("./metaDetailsScreen.js", import.meta.url), "utf8");
  const method = source.match(
    /async keepOnlyDirectResolution\(resolution, cancelled = \(\) => false\) \{[\s\S]*?\n {2}\},/
  )?.[0];
  assert.ok(method);
  const probed = [];
  const prepared = [];
  const playerSettings = { ...settings, ...overrides };
  const dependencies = {
    ...labelPolicy,
    playerStreamProbeKey,
    inspectAutoPlayStreams: (streams, options) =>
      inspectAutoPlayStreams(streams, {
        ...options,
        probeCandidate: async (prober, stream, candidateOptions) => {
          prepared.push(stream);
          if (prepareDelayMs) await new Promise((resolve) => setTimeout(resolve, prepareDelayMs));
          if (!candidateOptions.active()) return null;
          const url = unresolved.includes(stream.id)
            ? "https://resolved.test/" + stream.id
            : stream.url;
          if (!url) return null;
          candidateOptions.onResolved(url);
          return prober.probe(url);
        }
      }),
    filterPlayerStreams,
    filterStreamsByCompatibility,
    playerStreamProbeCandidates,
    streamLabelProbeLimit,
    allowsPlayerStreamLabel,
    StreamBadgeSettingsStore: {
      snapshot: () => ({ labelAddons, clientLabelLimit, playbackLabelSource })
    },
    ...selector,
    ...hdrPolicy,
    StartupLoadingOverlay: { setStage() {} },
    withinStreamSelectionDeadline,
    getDeviceCapabilities: () => ({ h264: true, aac: true, containers: { mp4: true, mkv: false } }),
    PROBE_ENDPOINT: "/api/probe",
    PROBE_MODE: mode,
    PROBE_CLIENT_CONCURRENCY: 1,
    createStreamProber: () => ({
      enabled: true,
      async probe(url) {
        probed.push(url);
        if (probeDelayMs) await new Promise((resolve) => setTimeout(resolve, probeDelayMs));
        return {
          ...directProbe,
          colorTransfer: hdr.some((id) => url.endsWith("/" + id))
            ? "smpte2084"
            : sdr.some((id) => url.endsWith("/" + id))
              ? "bt709"
              : null,
          container: nonDirect.some((id) => url.endsWith("/" + id)) ? "mkv" : "mp4"
        };
      }
    }),
    DirectDebridStreamPreparer: {
      async prepare(candidates, options) {
        prepared.push(...candidates);
        if (prepareDelayMs) await new Promise((resolve) => setTimeout(resolve, prepareDelayMs));
        for (const stream of candidates) {
          if (unresolved.includes(stream.id))
            options.onPrepared(stream, { url: "https://resolved.test/" + stream.id });
        }
      }
    },
    PlayerSettingsStore: { get: () => playerSettings },
    addonRepository: {
      getCachedInstalledAddons: () => [{ name: "AIOStreams" }, { name: "Torrentio" }]
    },
    StreamPreferencesStore: { getEntry: () => null },
    directDebridPreparationKey: (stream) => stream.id,
    streamProbeIdentity: (stream) => stream.id,
    classifyPlayback,
    fetch: async () => ({}),
    location: { href: "https://app.test" },
    console: { log() {} }
  };
  const body =
    "const {" +
    Object.keys(dependencies).join(",") +
    "}=dependencies; return ({" +
    method +
    "}).keepOnlyDirectResolution;";
  const run = new Function("dependencies", body)(dependencies);
  const savedEnv = globalThis.__NUVIO_ENV__;
  globalThis.__NUVIO_ENV__ = { PROBE_PAGE_LIMIT: limit };
  try {
    const result = await run.call(
      { params: {} },
      { streams, selected: streams[0], deadlineAt, preferredBingeGroup }
    );
    return { result, probed, prepared };
  } finally {
    globalThis.__NUVIO_ENV__ = savedEnv;
  }
}

test("Finding stream spends its probe cap only on selected autoplay addons", async () => {
  const torrentio = Array.from({ length: 96 }, (_, i) => row("torrentio-" + i, "Torrentio"));
  const aio = Array.from({ length: 5 }, (_, i) => row("aio-" + i));
  const { result, probed, prepared } = await resolve([...torrentio, ...aio], {
    nonDirect: aio.slice(0, 4).map((s) => s.id)
  });
  assert.deepEqual(
    prepared.map((s) => s.addonName),
    Array(5).fill("AIOStreams")
  );
  assert.deepEqual(
    probed,
    aio.map((s) => s.url)
  );
  assert.equal(result.selected?.id, "aio-4");
  assert.equal(result.streams.length, 101, "manual fallback retains every addon");
});

test("zero probe limit reaches a selected-addon Direct candidate beyond row twenty", async () => {
  const streams = Array.from({ length: 21 }, (_, i) => row("aio-" + i));
  const { result, probed } = await resolve(streams, {
    limit: 0,
    nonDirect: streams.slice(0, 20).map((s) => s.id)
  });
  assert.equal(probed.length, 21);
  assert.equal(result.selected?.id, "aio-20");
});

test("a positive cap still limits eligible candidates", async () => {
  const streams = Array.from({ length: 6 }, (_, i) => row("aio-" + i));
  const { result, probed } = await resolve(streams, {
    limit: 5,
    nonDirect: streams.slice(0, 5).map((s) => s.id)
  });
  assert.equal(probed.length, 5);
  assert.equal(result.selected, null);
});

test("excluded addons do not consume debrid preparation or probe requests", async () => {
  const { result, prepared, probed } = await resolve([row("other", "Torrentio")]);
  assert.equal(prepared.length, 0);
  assert.equal(probed.length, 0);
  assert.equal(result.selected, null);
});

test("enabled-plugin scope uses the same source rules for probing and selection", async () => {
  const { result, probed } = await resolve([row("addon"), row("plugin", "Plugin")], {
    overrides: {
      streamAutoPlaySource: "ENABLED_PLUGINS_ONLY",
      streamAutoPlaySelectedPlugins: ["Plugin"]
    }
  });
  assert.deepEqual(probed, ["https://media.test/plugin"]);
  assert.equal(result.selected?.id, "plugin");
});

test("regex selection keeps probing when an earlier Direct candidate does not match", async () => {
  const streams = Array.from({ length: 7 }, (_, i) => row("aio-" + i));
  const { result } = await resolve(streams, {
    limit: 0,
    overrides: { streamAutoPlayMode: "REGEX_MATCH", streamAutoPlayRegex: "aio-6" }
  });
  assert.equal(result.selected?.id, "aio-6");
});

test("resolved URL and probe evidence survive the auto-resolved handoff", async () => {
  const stream = { ...row("resolve-me"), url: null, infoHash: "test-hash" };
  const { result } = await resolve([stream], { unresolved: [stream.id] });
  assert.equal(result.selected?.id, stream.id);
  assert.equal(result.streams[0].url, "https://resolved.test/resolve-me");
  assert.ok(result.probes.some(([key]) => key === "https://resolved.test/resolve-me"));
});

test("First stream stops probing immediately when the top candidate is Direct", async () => {
  const streams = Array.from({ length: 22 }, (_, i) => row("aio-" + i));
  const { result, probed } = await resolve(streams, { limit: 0 });
  assert.deepEqual(probed, [streams[0].url]);
  assert.equal(result.selected?.id, streams[0].id);
});

test("First stream probes from the top and stops at the first Direct candidate", async () => {
  const streams = Array.from({ length: 22 }, (_, i) => row("aio-" + i));
  const { result, probed } = await resolve(streams, {
    limit: 0,
    nonDirect: streams.slice(0, 3).map((s) => s.id)
  });
  assert.deepEqual(
    probed,
    streams.slice(0, 4).map((s) => s.url)
  );
  assert.equal(result.selected?.id, streams[3].id);
});

test("a cold slow probe expires within the original budget and starts no later candidate", async () => {
  const { result, probed } = await resolve([row("first"), row("second")], {
    deadlineAt: Date.now() + 40,
    probeDelayMs: 100
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.selected, null);
  assert.equal(probed.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 110));
  assert.deepEqual(result.probes, [], "late probe cannot change the handed-off result");
});

test("debrid preparation consumes the same budget as probing", async () => {
  const { result, probed } = await resolve([row("first")], {
    deadlineAt: Date.now() + 40,
    prepareDelayMs: 100
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.selected, null);
  assert.equal(probed.length, 0);
});

test("HDR text ranking happens over the full eligible list before the probe cap", async () => {
  const streams = Array.from({ length: 22 }, (_, i) => row("aio-" + i));
  streams[18].title = "HDR10";
  const { result, prepared, probed } = await resolve(streams, {
    limit: 1,
    overrides: { streamAutoPlayHdrPreference: "PREFER" },
    hdr: ["aio-18"]
  });
  assert.equal(result.selected?.id, "aio-18");
  assert.deepEqual(
    prepared.map((s) => s.id),
    ["aio-18"]
  );
  assert.deepEqual(probed, [streams[18].url]);
});

test("a falsely advertised HDR and non-Direct HDR cannot beat a confirmed Direct HDR", async () => {
  const streams = [row("sdr-first"), row("false-hdr"), row("hdr-remux"), row("hdr-direct")];
  streams.slice(1).forEach((s) => {
    s.title = "HDR";
  });
  const { result, probed } = await resolve(streams, {
    overrides: { streamAutoPlayHdrPreference: "PREFER" },
    hdr: ["hdr-remux", "hdr-direct"],
    sdr: ["false-hdr"],
    nonDirect: ["hdr-remux"]
  });
  assert.equal(result.selected?.id, "hdr-direct");
  assert.deepEqual(
    probed,
    streams.slice(1).map((s) => s.url)
  );
});

test("HDR preference falls back to the original first Direct source if probes find no HDR", async () => {
  const streams = [row("first"), { ...row("false-hdr"), title: "HDR" }, row("last")];
  const { result, probed } = await resolve(streams, {
    overrides: { streamAutoPlayHdrPreference: "PREFER" },
    sdr: streams.map((s) => s.id)
  });
  assert.equal(result.selected?.id, "first");
  assert.equal(probed[0], streams[1].url);
});

test("Only Direct avoids HDR using probe evidence even when addon text is wrong or absent", async () => {
  const streams = [row("hidden-hdr"), { ...row("false-hdr"), title: "HDR" }];
  const { result } = await resolve(streams, {
    overrides: { streamAutoPlayHdrPreference: "AVOID" },
    hdr: ["hidden-hdr"],
    sdr: ["false-hdr"]
  });
  assert.equal(result.selected?.id, "false-hdr");
});

test("avoiding HDR never falls through to an excluded Direct stream", async () => {
  const streams = [row("hdr")];
  const { result } = await resolve(streams, {
    overrides: { streamAutoPlayHdrPreference: "AVOID" },
    hdr: ["hdr"]
  });
  assert.equal(result.selected, null);
  assert.equal(result.hdrExcluded, true);
});

test("HDR probing does not extend the original stream-selection deadline", async () => {
  const streams = [{ ...row("hdr-slow"), title: "HDR" }, row("fallback")];
  const start = Date.now();
  const { result, probed } = await resolve(streams, {
    overrides: { streamAutoPlayHdrPreference: "PREFER" },
    hdr: ["hdr-slow"],
    deadlineAt: start + 40,
    probeDelayMs: 100
  });
  assert.equal(result.selected, null);
  assert.equal(result.timedOut, true);
  assert.deepEqual(probed, [streams[0].url]);
  assert.ok(Date.now() - start < 90);
});

test("Direct auto selection may inspect a chosen source outside background addon scope", async () => {
  const { result, prepared, probed } = await resolve([row("aio")], { labelAddons: [] });
  assert.equal(prepared.length, 1);
  assert.equal(probed.length, 1);
  assert.equal(result.selected?.id, "aio");
});

test("client Direct auto selection respects the labeling limit", async () => {
  const streams = Array.from({ length: 10 }, (_, i) => row("cap-" + i));
  const { result, probed } = await resolve(streams, {
    mode: "client",
    limit: 0,
    clientLabelLimit: 3,
    nonDirect: streams.map((s) => s.id)
  });
  assert.equal(probed.length, 3);
  assert.equal(result.selected, null);
});

test("Direct startup filters addon text before preparing or probing capped candidates", async () => {
  const sources = [row("unknown"), { ...row("clear"), name: "Film.H264.AAC.mp4" }];
  const { result, probed } = await resolve(sources, {
    limit: 1,
    overrides: { streamCompatibilityFilter: "LIKELY_DIRECT" }
  });
  assert.deepEqual(probed, ["https://media.test/clear"]);
  assert.equal(result.selected.id, "clear");
});

test("Direct startup counts identical files from two addons as one candidate", async () => {
  const make = (id, hash, addon = "AIOStreams") => ({
    ...row(id, addon),
    infoHash: hash.repeat(40),
    fileIdx: 0
  });
  const sources = [
    make("a-first", "a"),
    make("a-copy", "a", "Torrentio"),
    make("b", "b"),
    make("c", "c")
  ];
  const { result, probed } = await resolve(sources, {
    mode: "client",
    limit: 0,
    clientLabelLimit: 3,
    overrides: { streamAutoPlaySource: "ALL_SOURCES", streamAutoPlaySelectedAddons: [] },
    nonDirect: ["a-first", "a-copy", "b"]
  });
  assert.deepEqual(
    probed,
    sources.filter((s) => s.id !== "a-copy").map((s) => s.url)
  );
  assert.equal(result.selected.id, "c");
});

test("filename Only Direct chooses locally and bypasses server preparation and probing", async () => {
  const sources = [
    { ...row("incompatible"), name: "Film.HEVC.AAC.mp4" },
    { ...row("direct"), name: "Film.H264.AAC.mp4" }
  ];
  const { result, probed, prepared } = await resolve(sources, { playbackLabelSource: "FILE_NAME" });
  assert.equal(result.selected.id, "direct");
  assert.deepEqual(result.probes, []);
  assert.deepEqual(probed, []);
  assert.deepEqual(prepared, []);
});

test("metadata Direct + Remux startup accepts a verified Remux candidate without requiring a Direct result", async () => {
  const streams = [row("remux-first"), row("direct-next")];
  const { result } = await resolve(streams, {
    overrides: { streamDisplayMode: "DIRECT_REMUX" },
    nonDirect: ["remux-first"]
  });
  assert.equal(result.selected?.id, "remux-first");
});

test("compatibility inspection preserves the preferred binge group after initial selection", async () => {
  const first = row("first"),
    group = { ...row("group"), behaviorHints: { bingeGroup: "same" } };
  const { result, probed } = await resolve([first, group], {
    preferredBingeGroup: "same",
    overrides: { streamAutoPlayPreferBingeGroupForNextEpisode: true }
  });
  assert.equal(result.selected.id, "group");
  assert.deepEqual(probed, [group.url]);
});
