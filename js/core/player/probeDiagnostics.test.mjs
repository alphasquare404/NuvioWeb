import test from "node:test";
import assert from "node:assert/strict";
import { inspectProbeHttpFailure, probeSourceId, reportPlaybackLabel } from "./probeDiagnostics.js";

test("HTTP errors retain only bounded fixed categories, never response text", async () => {
  let reads = 0,
    cancelled = 0;
  const response = {
    headers: new Headers({ "Content-Type": "text/html" }),
    body: {
      getReader: () => ({
        async read() {
          reads++;
          return {
            value: new TextEncoder().encode("Invalid signature fake-secret " + "x".repeat(8000)),
            done: false
          };
        },
        async cancel() {
          cancelled++;
        },
        releaseLock() {}
      })
    }
  };
  const facts = await inspectProbeHttpFailure(response);
  assert.deepEqual(facts, {
    errorType: "html",
    errorCategory: "signed-link-rejected",
    errorBytes: 4096
  });
  assert.equal(reads, 1);
  assert.equal(cancelled, 1);
  assert.equal(JSON.stringify(facts).includes("fake-secret"), false);
  const badRequest = await inspectProbeHttpFailure(
    new Response("400 Bad Request", { headers: { "Content-Type": "text/html" } })
  );
  assert.equal(badRequest.errorCategory, "bad-request");
});

test("label diagnostics correlate with source tags, are opt-in and do not log credentials", (t) => {
  const previous = globalThis.__NUVIO_CLIENT_PROBE_DEBUG__,
    warn = console.warn,
    logs = [];
  t.after(() => {
    globalThis.__NUVIO_CLIENT_PROBE_DEBUG__ = previous;
    console.warn = warn;
  });
  console.warn = (message) => logs.push(message);
  const url = "https://private.test/video?api_key=fake-credential";
  const probe = {
    playbackCapabilities: {
      engine: "native",
      video: null,
      container: true,
      audio: [{ index: 0, supported: true }]
    }
  };
  const verdict = { method: "unknown", reason: "video-capability-unknown" };
  globalThis.__NUVIO_CLIENT_PROBE_DEBUG__ = false;
  reportPlaybackLabel(url, probe, verdict);
  assert.equal(logs.length, 0);
  globalThis.__NUVIO_CLIENT_PROBE_DEBUG__ = true;
  reportPlaybackLabel(url, probe, verdict);
  reportPlaybackLabel(url, probe, verdict);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /video-capability-unknown/);
  assert.ok(logs[0].includes(probeSourceId(url)));
  assert.equal(logs[0].includes("private.test"), false);
  assert.equal(logs[0].includes("fake-credential"), false);
});
