import assert from "node:assert/strict";
import test from "node:test";
import { resolveBaseUrl, skipIntroRepository } from "./skipIntroRepository.js";

function stubFetch(implementation) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return implementation(String(url), options);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    }
  };
}

const okJson = (body) => ({ ok: true, status: 200, json: async () => body });
const failed = (status) => ({ ok: false, status, json: async () => ({}) });

test("a real answer becomes intervals, and is remembered", async () => {
  const stub = stubFetch(async () =>
    okJson({
      intro: { start_sec: 343, end_sec: 438 },
      recap: { start_sec: 10, end_sec: 40 },
      outro: null
    })
  );
  try {
    const first = await skipIntroRepository.getSkipIntervals("tt9000001", 2, 2);
    assert.deepEqual(first, [
      { startTime: 10, endTime: 40, type: "recap", provider: "introdb" },
      { startTime: 343, endTime: 438, type: "intro", provider: "introdb" }
    ]);

    const second = await skipIntroRepository.getSkipIntervals("tt9000001", 2, 2);
    assert.deepEqual(second, first);
    assert.equal(stub.calls.length, 1, "an answered request is cached");
    assert.match(stub.calls[0].url, /segments\?imdb_id=tt9000001&season=2&episode=2$/);
  } finally {
    stub.restore();
  }
});

test("a refusal is not cached: the next attempt gets a fresh chance", async () => {
  let attempt = 0;
  const stub = stubFetch(async () => {
    attempt += 1;
    return attempt === 1 ? failed(503) : okJson({ intro: { start_sec: 5, end_sec: 15 } });
  });
  try {
    assert.deepEqual(await skipIntroRepository.getSkipIntervals("tt9000002", 1, 1), []);
    // Poisoning the cache here is what made a CORS refusal look like "no data"
    // for the rest of the session.
    const second = await skipIntroRepository.getSkipIntervals("tt9000002", 1, 1);
    assert.equal(second.length, 1);
    assert.equal(stub.calls.length, 2);
  } finally {
    stub.restore();
  }
});

test("an unreachable endpoint is reported, not thrown", async () => {
  const stub = stubFetch(async () => {
    throw new TypeError("Load failed");
  });
  try {
    assert.deepEqual(await skipIntroRepository.getSkipIntervals("tt9000003", 1, 2), []);
    assert.deepEqual(await skipIntroRepository.getSkipIntervals("tt9000003", 1, 2), []);
    assert.equal(stub.calls.length, 2, "a failure must not be remembered as an answer");
  } finally {
    stub.restore();
  }
});

test("a film is never asked about, because there is no episode to ask for", async () => {
  const stub = stubFetch(async () => okJson({ intro: { start_sec: 5, end_sec: 15 } }));
  try {
    assert.deepEqual(await skipIntroRepository.getSkipIntervals("tt9000004", 0, 0), []);
    assert.deepEqual(await skipIntroRepository.getSkipIntervals("", 1, 1), []);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test("a relative base is resolved against the page origin, so a same-origin relay works", () => {
  // The upstream only allows its own origin, so the deployment relays it on its
  // own origin and configures a path. Without this, `new URL("segments", base)`
  // would throw and the feature would silently return nothing.
  assert.equal(
    resolveBaseUrl("/api/introdb/", "https://app.example").href,
    "https://app.example/api/introdb/"
  );
  // A missing trailing slash is added, because URL resolution needs it.
  assert.equal(
    resolveBaseUrl("/api/introdb", "https://app.example").href,
    "https://app.example/api/introdb/"
  );
  // The absolute upstream still wins when that is what is configured.
  assert.equal(resolveBaseUrl("https://api.introdb.app/").href, "https://api.introdb.app/");
  // Nothing to resolve is not an error, it is "do not ask".
  assert.equal(resolveBaseUrl(""), null);
  assert.equal(resolveBaseUrl("/api/introdb/", ""), null);
});
