import assert from "node:assert/strict";
import test from "node:test";
import { PLAYBACK_METHODS, classifyPlayback } from "./playbackMethod.js";
import {
  createStreamProber,
  selectRowsToProbe,
  shouldProbeVerdict,
  streamProbeIdentity
} from "./streamProbe.js";

const CAPS = { h264: true, hevc: true, av1: true, aac: true, eac3: true, opus: true, ac3: true };

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
    { url: "https://cdn/a.mkv", label: "1080p HEVC" }, // container known → no probe
    { url: "https://cdn/stream/abc", label: "" }, // nothing to go on → probe
    { url: "https://cdn/b.mp4", label: "720p x264" }, // known → no probe
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
  assert.equal(decided.confidence, "exact");
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
