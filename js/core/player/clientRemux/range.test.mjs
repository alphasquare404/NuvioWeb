import assert from "node:assert/strict";
import test from "node:test";
import { createRangeFetcher, readRange } from "./range.mjs";

const source = "https://aio.example/file";
const cdn = "https://cdn.example/file?token=fixture";
const refreshedCdn = "https://cdn.example/file?token=renewed";

function response(url, status, headers, body, redirected = false) {
  const result = new Response(body, { status, headers });
  Object.defineProperties(result, { url: { value: url }, redirected: { value: redirected } });
  return result;
}

test("a redirected full response is canceled before retrying the same range, then reads stay on the validated CDN", async () => {
  const calls = [];
  const stats = {};
  let canceled = false;
  const fetcher = createRangeFetcher(
    source,
    {
      Authorization: "Bearer fixture",
      "X-Addon-Key": "fixture",
      range: "bytes=0-9"
    },
    async (url, options) => {
      const range = options.headers.get("range");
      calls.push([url, range, options.method]);
      if (url === source) {
        assert.equal(options.headers.get("authorization"), "Bearer fixture");
        return response(
          cdn,
          200,
          { "content-length": "626323902" },
          new ReadableStream({
            cancel() {
              canceled = true;
            }
          }),
          true
        );
      }
      assert.equal(canceled, true);
      assert.equal(options.headers.has("authorization"), false);
      assert.equal(options.headers.has("x-addon-key"), false);
      if (options.method === "HEAD") return response(cdn, 200, { "content-length": "10" }, null);
      return response(cdn, 206, { "content-length": "1" }, Uint8Array.of(42));
    }
  );
  assert.deepEqual(await readRange(source, 0, 1, undefined, stats, fetcher), Uint8Array.of(42));
  assert.equal(stats.rangeRedirectRetry, true);
  assert.equal(stats.lastRangeStatus, 206);
  assert.deepEqual(await readRange(source, 1, 2, undefined, stats, fetcher), Uint8Array.of(42));
  assert.equal(stats.rangeRedirectRetry, false);
  assert.deepEqual(calls, [
    [source, "bytes=0-0", undefined],
    [cdn, "bytes=0-0", undefined],
    [cdn, null, "HEAD"],
    [cdn, "bytes=1-1", undefined]
  ]);
});

test("two full responses are canceled, and the failed CDN is never reused", async () => {
  const calls = [];
  const stats = {};
  let canceled = 0;
  const fetcher = async (url) => {
    calls.push(url);
    return response(
      cdn,
      200,
      {},
      new ReadableStream({
        cancel() {
          canceled++;
        }
      }),
      url === source
    );
  };
  for (let count = 0; count < 2; count++) {
    await assert.rejects(
      readRange(source, 0, 1, undefined, stats, fetcher),
      /range-response-invalid/
    );
  }
  assert.deepEqual(calls, [source, cdn, source, cdn]);
  assert.equal(canceled, 4);
  assert.equal(stats.lastRangeStatus, 200);
  assert.equal(stats.lastRangeBodyBytes, 0);
});

test("an expired cached CDN URL can be refreshed through the original source", async () => {
  const calls = [];
  const stats = {};
  let current = cdn;
  const fetcher = async (url, options) => {
    calls.push(url);
    if (url === source) return response(current, 200, {}, null, true);
    if (url !== current) return response(url, 403, {}, null);
    const position = options.headers.Range === "bytes=0-0" ? 0 : 1;
    return response(
      url,
      206,
      {
        "content-range": "bytes " + position + "-" + position + "/10"
      },
      Uint8Array.of(42)
    );
  };
  await readRange(source, 0, 1, undefined, stats, fetcher);
  current = refreshedCdn;
  await readRange(source, 1, 2, undefined, stats, fetcher);
  assert.deepEqual(calls, [source, cdn, cdn, source, refreshedCdn]);
});

test("a direct full response and an HTTPS downgrade are rejected without retry", async () => {
  for (const [url, redirected] of [
    [source, false],
    ["http://cdn.example/file", true]
  ]) {
    let requests = 0;
    await assert.rejects(
      readRange(source, 0, 1, undefined, {}, async () => {
        requests++;
        return response(url, 200, {}, null, redirected);
      }),
      /range-response-invalid/
    );
    assert.equal(requests, 1);
  }
});

test("a source fetch TypeError requests a host URL and only reuses it after a valid 206", async () => {
  let resolveCalls = 0;
  const calls = [];
  const fetcher = createRangeFetcher(
    source,
    { Authorization: "Bearer fixture" },
    async (url, options) => {
      calls.push(url);
      if (url === source) throw new TypeError("Failed to fetch");
      assert.equal(options.headers.has("authorization"), false);
      const index = options.headers.get("range") === "bytes=0-0" ? 0 : 1;
      return response(
        cdn,
        206,
        { "content-range": "bytes " + index + "-" + index + "/10" },
        Uint8Array.of(42)
      );
    },
    async () => {
      resolveCalls++;
      return cdn;
    }
  );
  const stats = {};
  await readRange(source, 0, 1, undefined, stats, fetcher);
  await readRange(source, 1, 2, undefined, stats, fetcher);
  assert.equal(resolveCalls, 1);
  assert.deepEqual(calls, [source, cdn, cdn]);
});
