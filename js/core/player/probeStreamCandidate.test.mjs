import test from "node:test";
import assert from "node:assert/strict";
import { probeStreamCandidate } from "./probeStreamCandidate.js";
import { createStreamProber, streamProbeIdentity } from "./streamProbe.js";

const raw = (i) => ({ id: String(i), infoHash: i.toString(16).padStart(40, "0"), fileIdx: 0 });
const facts = { container: "mkv", videoCodec: "h264", audioCodec: "aac" };

test("ten URL-less client candidates finish: four reuse disk facts, six resolve lazily then probe", async () => {
  const rows = Array.from({ length: 10 }, (_, i) => raw(i + 1));
  const saved = new Map(rows.slice(0, 4).map((s) => [streamProbeIdentity(s), facts]));
  let resolves = 0,
    probes = 0;
  const resolved = [];
  const prober = createStreamProber({
    mode: "client",
    metadataCache: { get: async (key) => saved.get(key), set: async () => {} },
    clientProbe: async () => {
      probes++;
      return facts;
    }
  });
  const resolver = {
    canResolveStream: () => true,
    resolve: async (stream) => {
      resolves++;
      return { status: "success", stream: { url: "https://cdn.test/" + stream.id } };
    }
  };
  for (const row of rows)
    assert.equal(
      (
        await probeStreamCandidate(prober, row, {
          mode: "client",
          resolver,
          onResolved: (url) => resolved.push(url)
        })
      ).videoCodec,
      "h264"
    );
  assert.equal(resolves, 6);
  assert.equal(probes, 6);
  assert.equal(resolved.length, 6);
});

test("client and server candidates use the same bounded resolver and actual URL, with episode context", async () => {
  for (const mode of ["client", "server"]) {
    let resolvedUrl;
    const context = { season: 2, episode: 3 };
    const result = await probeStreamCandidate(
      {
        probe: async (url) => {
          assert.equal(url, "https://cdn.test/media");
          return facts;
        }
      },
      { id: "raw" },
      {
        mode,
        context,
        resolver: {
          canResolveStream: (_s, c) => {
            assert.equal(c, context);
            return true;
          },
          resolve: async () => ({ status: "success", stream: { url: "https://cdn.test/media" } })
        },
        onResolved: (url) => {
          resolvedUrl = url;
        }
      }
    );
    assert.equal(result, facts);
    assert.equal(resolvedUrl, "https://cdn.test/media");
  }
});

test("failed or timed-out resolution finishes without starting a media probe; stale resolution is ignored", async () => {
  let probes = 0,
    published = 0;
  const prober = {
    probe: async () => {
      probes++;
      return facts;
    }
  };
  const options = { mode: "client", resolveTimeoutMs: 5, onResolved: () => published++ };
  assert.equal(
    await probeStreamCandidate(
      prober,
      { id: "missing" },
      { ...options, resolver: { canResolveStream: () => false } }
    ),
    null
  );
  assert.equal(
    await probeStreamCandidate(
      prober,
      { id: "failed" },
      {
        ...options,
        resolver: { canResolveStream: () => true, resolve: async () => ({ status: "not_cached" }) }
      }
    ),
    null
  );
  assert.equal(
    await probeStreamCandidate(
      prober,
      { id: "timeout" },
      {
        ...options,
        resolver: { canResolveStream: () => true, resolve: () => new Promise(() => {}) }
      }
    ),
    null
  );
  let current = true;
  assert.equal(
    await probeStreamCandidate(
      prober,
      { id: "stale" },
      {
        ...options,
        active: () => current,
        resolver: {
          canResolveStream: () => true,
          resolve: async () => {
            current = false;
            return { status: "success", stream: { url: "https://cdn.test/media" } };
          }
        }
      }
    ),
    null
  );
  assert.equal(probes, 0);
  assert.equal(published, 0);
});
