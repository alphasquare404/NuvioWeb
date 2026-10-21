import assert from "node:assert/strict";
import test from "node:test";
import { PLAYBACK_METHODS, classifyPlayback } from "./playbackMethod.js";
import { createStreamProber, selectRowsToProbe } from "./streamProbe.js";

const CAPS = { h264: true, hevc: true, av1: true, aac: true, eac3: true, opus: true, ac3: true };

test("only the rows the estimate cannot decide are selected for probing", () => {
  const rows = [
    { url: "https://cdn/a.mkv", label: "1080p HEVC" }, // container known → no probe
    { url: "https://cdn/stream/abc", label: "" }, // nothing to go on → probe
    { url: "https://cdn/b.mp4", label: "720p x264" }, // known → no probe
    { url: "https://cdn/stream/def", label: "1080p" }, // still unknown → probe
    { url: "https://cdn/stream/ghi", label: "AV1" } // codec known, container not → probe
  ];

  const picked = selectRowsToProbe(rows, { capabilities: CAPS });
  assert.deepEqual(
    picked.map((row) => row.url),
    ["https://cdn/stream/abc", "https://cdn/stream/def", "https://cdn/stream/ghi"]
  );
});

test("the selection respects its limit", () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({
    url: `https://cdn/s/${index}`,
    label: ""
  }));
  assert.equal(selectRowsToProbe(rows, { capabilities: CAPS, limit: 3 }).length, 3);
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
  json: async () => ({ ok: true, container: "mkv", videoCodec: "hevc", audioCodec: "aac" })
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
  assert.deepEqual(first, { container: "mkv", videoCodec: "hevc", audioCodec: "aac" });

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
    audioCodec: "aac"
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
