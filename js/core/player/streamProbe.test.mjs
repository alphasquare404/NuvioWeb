import assert from "node:assert/strict";
import test from "node:test";
import { PLAYBACK_METHODS, classifyPlayback } from "./playbackMethod.js";
import {
  createStreamProber,
  selectRowsToProbe,
  shouldProbeVerdict,
  streamProbeIdentity
} from "./streamProbe.js";

const CAPS = {
  containers: { mp4: true, webm: true, mkv: false, ts: false, avi: false },
  h264: true,
  hevc: true,
  av1: true,
  aac: true,
  eac3: true,
  opus: true,
  ac3: true
};

test("a hevc mp4 that looks playable is probed for its tag where the tag matters", () => {
  // The card said Direct (mp4, HEVC, AAC -- all supported) and the iPhone refused
  // it: the track was tagged hev1. The text never says. One probe settles it.
  const hevcMp4 = { url: "https://cdn/a.mp4", label: "1080p.x265.10bit.AAC5.1-YTS.mp4" };
  const apple = { ...CAPS, hevcHvc1Required: true };

  const picked = selectRowsToProbe([hevcMp4], { capabilities: apple });
  assert.equal(picked.length, 1);

  // A platform that opens either tag gains nothing from the request.
  assert.deepEqual(selectRowsToProbe([hevcMp4], { capabilities: CAPS }), []);

  // And the rule is narrow: an h264 mp4 stays Direct and unprobed.
  assert.equal(
    selectRowsToProbe([{ url: "https://cdn/b.mp4", label: "1080p x264 AAC" }], {
      capabilities: apple
    }).length,
    0
  );
});

test("the probe decision is readable on its own", () => {
  const apple = { ...CAPS, hevcHvc1Required: true };
  assert.equal(
    shouldProbeVerdict(
      {
        method: PLAYBACK_METHODS.DIRECT,
        container: "mp4",
        videoCodec: "hevc"
      },
      apple
    ),
    true
  );
  assert.equal(
    shouldProbeVerdict(
      {
        method: PLAYBACK_METHODS.DIRECT,
        container: "mkv",
        videoCodec: "hevc"
      },
      apple
    ),
    false
  );
  assert.equal(
    shouldProbeVerdict(
      {
        method: PLAYBACK_METHODS.DIRECT,
        container: "mp4",
        videoCodec: "h264"
      },
      apple
    ),
    false
  );
  assert.equal(
    shouldProbeVerdict({ method: PLAYBACK_METHODS.UNKNOWN }, { hevcHvc1Required: true }),
    true
  );
});

test("rows the estimate cannot decide are probed, within a small cosmetic budget", () => {
  const rows = [
    { url: "https://cdn/a.mkv", label: "1080p HEVC AAC" }, // container known → no probe
    { url: "https://cdn/stream/abc", label: "" }, // nothing to go on → probe
    { url: "https://cdn/b.mp4", label: "720p x264 AAC" }, // known → no probe
    { url: "https://cdn/stream/def", label: "1080p" }, // still unknown → probe
    { url: "https://cdn/stream/ghi", label: "AV1" } // codec known, container not → probe
  ];

  // Two, not all three: an `Unknown` row only buys a nicer label, and that budget is
  // deliberately separate from the rows whose label decides whether playback works.
  assert.deepEqual(
    selectRowsToProbe(rows, { capabilities: CAPS }).map((row) => row.url),
    ["https://cdn/stream/abc", "https://cdn/stream/def"]
  );
  assert.equal(
    selectRowsToProbe(rows, { capabilities: CAPS, certaintyLimit: 5 }).length,
    3,
    "the budget is a parameter, not a hardcoded number"
  );
});

test("a tag-critical row goes first and is never crowded out by unknowns", () => {
  const apple = { ...CAPS, hevcHvc1Required: true };
  // Four rows the estimate cannot decide, then the one that decides a broken play.
  const rows = [
    ...Array.from({ length: 4 }, (_, index) => ({
      url: `https://cdn/u/${index}`,
      label: ""
    })),
    { url: "https://cdn/x265.mp4", label: "1080p x265 10bit AAC5.1" }
  ];

  const picked = selectRowsToProbe(rows, { capabilities: apple });
  assert.equal(picked[0].url, "https://cdn/x265.mp4", "the tag candidate is first");

  // And it is not limited by the cosmetic budget: five of them still fit in a batch.
  const many = Array.from({ length: 7 }, (_, index) => ({
    url: `https://cdn/t/${index}.mp4`,
    label: "1080p x265 10bit AAC5.1"
  }));
  assert.equal(selectRowsToProbe(many, { capabilities: apple }).length, 5);
});

test("the selection respects its limit", () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({
    url: `https://cdn/s/${index}`,
    label: ""
  }));
  assert.equal(
    selectRowsToProbe(rows, { capabilities: CAPS, limit: 3, certaintyLimit: 3 }).length,
    3
  );
});

function fakeFetch(handler) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return handler(url);
    }
  };
}

const okProbe = () => ({
  ok: true,
  json: async () => ({
    ok: true,
    container: "mkv",
    videoCodec: "hevc",
    videoTag: "hev1",
    audioCodec: "aac",
    audioChannels: 0,
    audioStreams: []
  })
});

test("a probe is cached, and concurrent callers share one request", async () => {
  const { calls, fetchImpl } = fakeFetch(okProbe);
  const prober = createStreamProber({ endpoint: "/api/probe", fetchImpl });

  const [first, second] = await Promise.all([
    prober.probe("https://cdn/stream/abc"),
    prober.probe("https://cdn/stream/abc")
  ]);
  assert.equal(calls.length, 1);
  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    container: "mkv",
    videoCodec: "hevc",
    videoTag: "hev1",
    audioCodec: "aac",
    audioChannels: 0,
    audioStreams: []
  });

  await prober.probe("https://cdn/stream/abc");
  assert.equal(calls.length, 1, "a cached answer is not asked for again");
});

test("a failure is not cached, and never throws", async () => {
  let attempt = 0;
  const { calls, fetchImpl } = fakeFetch(() => {
    attempt += 1;
    return attempt === 1 ? { ok: false, status: 502, json: async () => ({}) } : okProbe();
  });
  const prober = createStreamProber({ endpoint: "/api/probe", fetchImpl });

  assert.equal(await prober.probe("https://cdn/x"), null);
  assert.deepEqual(await prober.probe("https://cdn/x"), {
    container: "mkv",
    videoCodec: "hevc",
    videoTag: "hev1",
    audioCodec: "aac",
    audioChannels: 0,
    audioStreams: []
  });
  assert.equal(calls.length, 2, "a refusal is not remembered as an answer");
});

test("without an endpoint nothing is asked", async () => {
  const { calls, fetchImpl } = fakeFetch(okProbe);
  const prober = createStreamProber({ endpoint: "", fetchImpl });
  assert.equal(prober.enabled, false);
  assert.equal(await prober.probe("https://cdn/x"), null);
  assert.equal(calls.length, 0);
});

test("a probed row stops being Unknown when classified again", async () => {
  const prober = createStreamProber({
    endpoint: "/api/probe",
    fetchImpl: fakeFetch(okProbe).fetchImpl
  });
  const rows = [{ url: "https://cdn/stream/abc", label: "" }];

  const unknown = classifyPlayback({ url: rows[0].url, label: rows[0].label, capabilities: CAPS });
  assert.equal(unknown.method, PLAYBACK_METHODS.UNKNOWN);

  const results = await prober.probeUnknown(rows, { capabilities: CAPS });
  const probe = results.get(rows[0].url);
  const decided = classifyPlayback({
    url: rows[0].url,
    label: rows[0].label,
    probe,
    capabilities: CAPS
  });
  assert.equal(decided.method, PLAYBACK_METHODS.REMUX);
  assert.equal(decided.confidence, "predicted");
});

test("a row without a resolved url is never selected", () => {
  const rows = [
    { url: "", label: "4K TB Instant Tenzing 2026 2160p WEBRip" },
    { url: "", label: "" },
    { url: "https://cdn/stream/real", label: "" }
  ];
  const picked = selectRowsToProbe(rows, { capabilities: CAPS });
  assert.deepEqual(
    picked.map((row) => row.url),
    ["https://cdn/stream/real"]
  );
});

test("the identity names the file, never the link", () => {
  const resolved = {
    clientResolve: {
      service: "torbox",
      infoHash: "abc123",
      fileIdx: 2,
      filename: "Film.2026.1080p.mkv"
    },
    url: "https://nexus.example/dld/abc?token=first"
  };
  const first = streamProbeIdentity(resolved);
  // The same file behind a freshly issued token is the same identity.
  const second = streamProbeIdentity({
    ...resolved,
    url: "https://nexus.example/dld/abc?token=second"
  });
  assert.equal(first, second);
  assert.equal(first.includes("token"), false);
  // A different file in the same torrent is a different identity.
  assert.notEqual(
    streamProbeIdentity({
      clientResolve: { ...resolved.clientResolve, fileIdx: 3 }
    }),
    first
  );

  // Without a hash or file index there is nothing stable to key on.
  assert.equal(streamProbeIdentity({ name: "Some Release" }), "");
  assert.equal(streamProbeIdentity({}), "");
});

test("selection can shorten a probe request to the remaining overall budget", async () => {
  let aborted = false;
  const prober = createStreamProber({
    endpoint: "/api/probe",
    timeoutMs: 1000,
    fetchImpl: async (url, { signal }) =>
      new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        });
      })
  });
  assert.equal(await prober.probe("https://media.test/cold.mp4", { timeoutMs: 20 }), null);
  assert.equal(aborted, true);
});

test("cache retains file facts and reassesses the current local engine", async () => {
  let engine = "native";
  let requests = 0;
  const prober = createStreamProber({
    endpoint: "/api/probe",
    fetchImpl: async () => {
      requests++;
      return {
        ok: true,
        json: async () => ({
          ok: true,
          container: "mp4",
          videoCodec: "h264",
          width: 3840,
          height: 2160,
          frameRate: 60,
          bitDepth: 10
        })
      };
    },
    assess: async () => ({ engine })
  });
  const first = await prober.probe("https://cdn/a");
  engine = "movi";
  const second = await prober.probe("https://cdn/a");
  assert.equal(requests, 1);
  assert.equal(first.width, 3840);
  assert.equal(first.bitDepth, 10);
  assert.equal(first.playbackCapabilities.engine, "native");
  assert.equal(second.playbackCapabilities.engine, "movi");
});

test("client mode uses WASM instead of the server, retains assessment, cache and in-flight deduplication", async () => {
  let clients = 0,
    servers = 0;
  const facts = { container: "mp4", videoCodec: "h264", audioCodec: "aac", hasAudio: true };
  const prober = createStreamProber({
    mode: "client",
    endpoint: "/api/probe",
    fetchImpl: () => {
      servers++;
      throw Error("must not call server");
    },
    clientProbe: async () => {
      clients++;
      return facts;
    },
    assess: async () => ({ video: true })
  });
  assert.equal(prober.enabled, true);
  const results = await Promise.all([
    prober.probe("https://cdn.test/1"),
    prober.probe("https://cdn.test/1")
  ]);
  assert.equal(clients, 1);
  assert.equal(servers, 0);
  assert.equal(results[0].hasAudio, true);
  assert.deepEqual(results[0].playbackCapabilities, { video: true });
  await prober.probe("https://cdn.test/1");
  assert.equal(clients, 1);
});
test("off mode performs no client or server probe even when an endpoint is configured", async () => {
  let calls = 0;
  for (const mode of ["off", "invalid-mode"]) {
    const p = createStreamProber({
      mode,
      endpoint: "/api/probe",
      fetchImpl: () => calls++,
      clientProbe: () => calls++
    });
    assert.equal(p.enabled, false);
    assert.equal(await p.probe("https://cdn.test/1"), null);
  }
  assert.equal(calls, 0);
});
test("client failure or CORS refusal never falls back to server", async () => {
  let servers = 0;
  const p = createStreamProber({
    mode: "client",
    endpoint: "/api/probe",
    clientProbe: async () => {
      throw Error("CORS");
    },
    fetchImpl: () => servers++
  });
  assert.equal(await p.probe("https://cdn.test/1"), null);
  assert.equal(servers, 0);
});

test("client deduplicates Torrentio, Torz and structured identities but keeps distinct files", async () => {
  const hash = "a".repeat(40);
  const torrentio = (index) =>
    "https://torrentio.strem.fun/resolve/torbox/test-key/" + hash + "/film/" + index + "/film.mp4";
  const torz = "https://addon.test/stremio/torz/config/_/strem/tt123/tb/" + hash + "/0/film.mp4";
  let calls = 0;
  let assessments = 0;
  const p = createStreamProber({
    mode: "client",
    clientProbe: async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return { videoCodec: "h264" };
    },
    assess: async () => ({ revision: ++assessments })
  });
  const results = await Promise.all([p.probe(torrentio(0)), p.probe(torz)]);
  assert.equal(calls, 1);
  assert.notEqual(
    results[0].playbackCapabilities.revision,
    results[1].playbackCapabilities.revision
  );
  await p.probe("https://cdn.test/signed", {
    identity: streamProbeIdentity({ infoHash: hash, fileIdx: 0 })
  });
  assert.equal(calls, 1);
  await p.probe(torrentio(1));
  assert.equal(calls, 2);
  await p.probe("https://cdn.test/unidentified-a", { identity: "same-name|0" });
  await p.probe("https://cdn.test/unidentified-b", { identity: "same-name|0" });
  assert.equal(calls, 4, "weak identity must not merge files");
});

test("failed shared source allows the alternative URL to probe", async () => {
  let calls = 0;
  const p = createStreamProber({
    mode: "client",
    clientProbe: async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return calls === 1 ? null : { videoCodec: "hevc" };
    }
  });
  const identity = streamProbeIdentity({ infoHash: "b".repeat(40), fileIdx: 0 });
  const [first, second] = await Promise.all([
    p.probe("https://cdn.test/broken", { identity }),
    p.probe("https://cdn.test/working", { identity })
  ]);
  assert.equal(first, null);
  assert.equal(second.videoCodec, "hevc");
  assert.equal(calls, 2);
});

test("joining a background probe respects the selection caller deadline", async () => {
  let finish;
  const p = createStreamProber({
    mode: "client",
    clientProbe: () =>
      new Promise((r) => {
        finish = r;
      })
  });
  const background = p.probe("https://cdn.test/slow", { resolveTimeoutMs: 15000 });
  assert.equal(await p.probe("https://cdn.test/slow", { timeoutMs: 10 }), null);
  finish({ videoCodec: "h264" });
  assert.equal((await background).videoCodec, "h264");
});

test("client reload reuses stored facts while reassessing the browser", async () => {
  const disk = new Map();
  const metadataCache = {
    get: async (key) => disk.get(key),
    set: async (key, facts) => {
      disk.set(key, facts);
    }
  };
  let probes = 0;
  let engine = "native";
  const options = {
    mode: "client",
    metadataCache,
    clientProbe: async () => {
      probes++;
      return { container: "mp4", videoCodec: "h264" };
    },
    assess: async () => ({ engine })
  };
  const url =
    "https://torrentio.strem.fun/resolve/torbox/test/" + "c".repeat(40) + "/film/0/film.mp4";
  await createStreamProber(options).probe(url);
  engine = "movi";
  const result = await createStreamProber(options).probe(url);
  assert.equal(probes, 1);
  assert.equal(result.playbackCapabilities.engine, "movi");
});

test("unavailable or slow persistent cache cannot prevent a live probe or extend selection", async () => {
  const url =
    "https://torrentio.strem.fun/resolve/torbox/test/" + "d".repeat(40) + "/film/0/film.mp4";
  let probes = 0;
  const failed = createStreamProber({
    mode: "client",
    metadataCache: {
      get: async () => {
        throw Error("blocked");
      },
      set: async () => {
        throw Error("quota");
      }
    },
    clientProbe: async () => {
      probes++;
      return { container: "mp4", videoCodec: "h264" };
    }
  });
  assert.equal((await failed.probe(url)).videoCodec, "h264");
  const slow = createStreamProber({
    mode: "client",
    metadataCache: { get: () => new Promise(() => {}) },
    clientProbe: () => {
      probes++;
    }
  });
  assert.equal(await slow.probe(url, { timeoutMs: 10 }), null);
  assert.equal(probes, 1);
});

test("clearing metadata prevents a pre-clear probe from repopulating RAM or disk", async () => {
  const { probeMetadataCache } = await import("./probeMetadataCache.js");
  let finish;
  let writes = 0;
  let calls = 0;
  const p = createStreamProber({
    mode: "client",
    metadataCache: {
      get: async () => null,
      set: async () => {
        writes++;
      }
    },
    clientProbe: async () => {
      calls++;
      if (calls === 1)
        return new Promise((r) => {
          finish = r;
        });
      return { container: "mp4", videoCodec: "h264" };
    }
  });
  const identity = streamProbeIdentity({ infoHash: "e".repeat(40), fileIdx: 0 });
  const ongoing = p.probe("https://cdn.test/cleared", { identity });
  await new Promise((r) => setTimeout(r, 0));
  await probeMetadataCache.clear();
  finish({ container: "mp4", videoCodec: "hevc" });
  await ongoing;
  assert.equal(writes, 0);
  assert.equal((await p.probe("https://cdn.test/cleared", { identity })).videoCodec, "h264");
  assert.equal(calls, 2);
});

test("cancelAll aborts active requests, retains completed facts and allows a new selection", async () => {
  let activeSignal;
  const prober = createStreamProber({
    endpoint: "/probe",
    fetchImpl: async (url, { signal }) => {
      if (url.includes("blocked")) {
        activeSignal = signal;
        return new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
        );
      }
      return {
        ok: true,
        json: async () => ({ ok: true, container: "mkv", videoCodec: "hevc", audioCodec: "aac" })
      };
    }
  });
  const saved = await prober.probe("https://media.test/cached");
  const blocked = prober.probe("https://media.test/blocked");
  await new Promise((resolve) => setImmediate(resolve));
  prober.cancelAll();
  assert.equal(activeSignal.aborted, true);
  assert.equal(await blocked, null);
  assert.deepEqual(await prober.probe("https://media.test/cached"), saved);
  assert.equal((await prober.probe("https://media.test/selected")).videoCodec, "hevc");
});

test("server probe errors preserve known metadata reasons instead of presenting 502 as source failure", async () => {
  const prober = createStreamProber({
    endpoint: "/probe",
    fetchImpl: async () => ({
      ok: false,
      status: 502,
      json: async () => ({ error: "probe-output-limit" })
    })
  });
  assert.equal(await prober.probe("https://media.test/movie"), null);
  assert.equal(prober.failureReason("https://media.test/movie"), "probe-output-limit");
});

test("byte-budget failure is remembered across prober instances without becoming successful metadata", async (t) => {
  const { PROBE_BYTE_FAILURE_TTL_MS } = await import("./streamProbe.js");
  t.mock.timers.enable({ apis: ["Date"] });
  let calls = 0;
  const options = {
    mode: "client",
    metadataCache: { get: async () => null },
    clientProbe: async (_url, { onFailure }) => {
      calls++;
      onFailure("probe-byte-budget");
      return null;
    }
  };
  const identity = "torrent-file:" + "b".repeat(40) + ":519";
  const first = createStreamProber(options),
    second = createStreamProber(options);
  assert.equal(await first.probe("https://media.test/byte-budget-old", { identity }), null);
  assert.equal(await second.probe("https://media.test/byte-budget-new", { identity }), null);
  assert.equal(
    calls,
    1,
    "same file with another signed URL must not spend the same byte budget again"
  );
  assert.equal(second.failureReason("https://media.test/byte-budget-new"), "probe-byte-budget");
  t.mock.timers.tick(PROBE_BYTE_FAILURE_TTL_MS + 1);
  await second.probe("https://media.test/byte-budget-new", { identity });
  assert.equal(calls, 2, "temporary failure memory expires");
});

test("transient client network failures remain retryable", async () => {
  let calls = 0;
  const prober = createStreamProber({
    mode: "client",
    clientProbe: async (_url, { onFailure }) => {
      calls++;
      onFailure("range-fetch-failed");
      return null;
    }
  });
  await prober.probe("https://media.test/transient-retry");
  await prober.probe("https://media.test/transient-retry");
  assert.equal(calls, 2);
});

test("strong file identity finds persistent facts before a signed URL exists, without any media or debrid request", async () => {
  const identity = "torrent-file:" + "a".repeat(40) + ":2";
  const facts = { container: "mkv", videoCodec: "h264", audioCodec: "aac" };
  let reads = 0,
    probes = 0;
  const p = createStreamProber({
    mode: "client",
    metadataCache: {
      get: async (key) => {
        reads++;
        return key === identity ? facts : null;
      }
    },
    clientProbe: async () => {
      probes++;
      assert.fail("cache-only lookup must not request media");
    },
    assess: async () => ({ video: true })
  });
  const result = await p.probe("", { identity });
  assert.equal(result.videoCodec, "h264");
  assert.equal(result.playbackCapabilities.video, true);
  assert.equal((await p.probe("", { identity })).videoCodec, "h264");
  assert.equal(reads, 1);
  assert.equal(probes, 0);
  assert.equal(await p.probe("", { identity: "episode-title" }), null);
});

test("cache-only miss does not start WASM or poison the next real URL probe", async () => {
  const identity = "torrent-file:" + "b".repeat(40) + ":4";
  let probes = 0;
  const p = createStreamProber({
    mode: "client",
    metadataCache: { get: async () => null, set: async () => {} },
    clientProbe: async () => {
      probes++;
      return { container: "mkv", videoCodec: "h264" };
    }
  });
  assert.equal(await p.probe("", { identity }), null);
  assert.equal(probes, 0);
  assert.equal((await p.probe("https://cdn.test/actual", { identity })).container, "mkv");
  assert.equal(probes, 1);
});
