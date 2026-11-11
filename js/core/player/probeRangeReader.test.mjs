import test from "node:test";
import assert from "node:assert/strict";
import {
  createProbeRangeReader as createRangeReader,
  PROBE_CHUNK_BYTES
} from "./probeRangeReader.js";
import { createClientMediaUrlResolver } from "../streams/clientMediaUrlResolver.js";
const createProbeRangeReader = (url, options) =>
  createRangeReader(url, { ...options, urlResolver: createClientMediaUrlResolver() });
const response = (start, end, size) =>
  new Response(new Uint8Array(end - start + 1), {
    status: 206,
    headers: { "Content-Range": "bytes " + start + "-" + end + "/" + size }
  });
test("range reader uses CORS, bounded ranges and the resolved CDN URL", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, ...options });
    const [, s, e] = /bytes=(\d+)-(\d+)/.exec(options.headers.Range);
    const r = response(+s, Math.min(+e, 699999), 700000);
    Object.defineProperty(r, "url", { value: "https://cdn.test/signed" });
    return r;
  };
  const reader = createProbeRangeReader("https://addon.test/resolve", { fetchImpl });
  const first = await reader.read(0),
    last = await reader.read(650000);
  assert.equal(reader.size, 700000);
  assert.equal(first.bytes.length, PROBE_CHUNK_BYTES);
  assert.equal(last.start, 524288);
  assert.equal(last.bytes.length, 175712);
  assert.equal(calls[0].mode, "cors");
  assert.equal(calls[0].credentials, "omit");
  assert.equal(calls[0].cache, "no-store");
  assert.equal(calls[1].url, "https://cdn.test/signed");
  assert.ok(reader.bytesRead < 700000);
});
test("a redirected full response is cancelled before retrying the exact range at the CDN", async () => {
  const calls = [];
  let cancelled = 0;
  const reader = createProbeRangeReader("https://addon.test/resolve", {
    fetchImpl: async (url, options) => {
      calls.push({ url, ...options });
      if (calls.length === 1)
        return {
          status: 200,
          redirected: true,
          url: "https://cdn.test/signed",
          body: {
            cancel: async () => {
              cancelled++;
            },
            getReader: () => assert.fail("must not read the full video")
          }
        };
      assert.equal(cancelled, 1, "cancel the whole-file response before retrying");
      const [, start, end] = /bytes=(\d+)-(\d+)/.exec(options.headers.Range);
      return response(+start, +end, 2097152);
    }
  });
  assert.equal((await reader.read(0)).bytes.length, PROBE_CHUNK_BYTES);
  assert.equal((await reader.read(PROBE_CHUNK_BYTES)).start, PROBE_CHUNK_BYTES);
  assert.equal(reader.bytesRead, 3 * PROBE_CHUNK_BYTES);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].url, "https://cdn.test/signed");
  assert.equal(calls[2].url, "https://cdn.test/signed");
  assert.equal(calls[1].headers.Range, calls[0].headers.Range);
  assert.equal(calls[1].mode, "cors");
  assert.equal(calls[1].credentials, "omit");
  assert.equal(calls[1].cache, "no-store");
});

test("sequential reads grow to 1MiB, keep the 13MiB cap and use all of the remaining budget", async () => {
  const sizes = [];
  const reader = createProbeRangeReader("https://cdn.test/file", {
    fetchImpl: async (_url, options) => {
      const [, start, end] = /bytes=(\d+)-(\d+)/.exec(options.headers.Range);
      sizes.push(+end - Number(start) + 1);
      return response(+start, +end, 16 * 1024 * 1024);
    }
  });
  while (reader.bytesRead < 13 * 1024 * 1024) await reader.read(reader.bytesRead);
  assert.deepEqual(sizes, [262144, 524288, ...Array(12).fill(1048576), 262144]);
  await assert.rejects(reader.read(reader.bytesRead), /budget/);
  assert.equal(reader.bytesRead, 13 * 1024 * 1024);
  assert.equal(sizes.length, 15, "13MiB limit is enforced exactly");
});

test("random seeks return to a small read instead of fetching an unnecessary 1MiB", async () => {
  const sizes = [];
  const reader = createProbeRangeReader("https://cdn.test/file", {
    fetchImpl: async (_url, options) => {
      const [, start, end] = /bytes=(\d+)-(\d+)/.exec(options.headers.Range);
      sizes.push(+end - Number(start) + 1);
      return response(+start, +end, 16 * 1024 * 1024);
    }
  });
  await reader.read(0);
  await reader.read(262144);
  await reader.read(4 * 1024 * 1024);
  assert.deepEqual(sizes, [262144, 524288, 262144]);
});
test("the CDN retry remains bounded and rejects another full response without reading it", async () => {
  let calls = 0,
    cancelled = 0;
  const reader = createProbeRangeReader("https://addon.test/resolve", {
    fetchImpl: async () => {
      calls++;
      return {
        status: 200,
        redirected: true,
        url: "https://cdn.test/" + calls,
        headers: new Headers({ "Content-Length": "3000000000" }),
        body: {
          cancel: async () => {
            cancelled++;
          },
          getReader: () => assert.fail("must not read the full video")
        }
      };
    }
  });
  await assert.rejects(reader.read(0), /range-or-cors/);
  assert.equal(calls, 2);
  assert.equal(cancelled, 2);
  assert.equal(reader.bytesRead, 0);
  assert.equal(reader.diagnostics.redirectRangeRetry, true);
  assert.equal(reader.diagnostics.initialRangeStatus, 200);
  assert.equal(reader.diagnostics.rangeStatus, 200);
});
test("full responses and hidden ranges without a valid HEAD size are cancelled", async () => {
  for (const status of [200, 206]) {
    let cancelled = 0;
    const reader = createProbeRangeReader("https://cdn.test/file", {
      fetchImpl: async () => ({
        status,
        headers: new Headers(),
        body: {
          cancel: async () => cancelled++,
          getReader: () => {
            throw Error("must not read full video");
          }
        }
      })
    });
    await assert.rejects(reader.read(0), /range-or-cors|head-size/);
    assert.equal(cancelled, 1);
    assert.equal(reader.bytesRead, 0);
    assert.equal(reader.diagnostics.rangeStatus, status);
    assert.equal(reader.diagnostics.rangeHeader, "hidden");
    assert.equal(reader.diagnostics.partialLength, "hidden");
  }
});
test("a CORS-readable HEAD size supports hidden Content-Range and clamps the last range", async () => {
  const calls = [];
  const reader = createProbeRangeReader("https://addon.test/resolve", {
    fetchImpl: async (url, options) => {
      calls.push({ url, ...options });
      if (options.method === "HEAD")
        return new Response(null, { headers: { "Content-Length": "300000" } });
      const [, start, end] = /bytes=(\d+)-(\d+)/.exec(options.headers.Range);
      const length = Math.min(+end, 299999) - Number(start) + 1;
      const result = new Response(new Uint8Array(length), {
        status: 206,
        headers: { "Content-Length": String(length) }
      });
      Object.defineProperty(result, "url", { value: "https://cdn.test/signed" });
      return result;
    }
  });
  assert.equal((await reader.read(0)).bytes.length, PROBE_CHUNK_BYTES);
  assert.equal(reader.size, 300000);
  assert.equal((await reader.read(299999)).bytes.length, 37856);
  assert.equal(reader.bytesRead, 300000);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].url, "https://cdn.test/signed");
  assert.equal(calls[1].method, "HEAD");
  assert.equal(calls[1].mode, "cors");
  assert.equal(calls[1].credentials, "omit");
  assert.equal(calls[2].headers.Range, "bytes=262144-299999");
  assert.equal(reader.diagnostics.rangeStatus, 206);
  assert.equal(reader.diagnostics.expectedLength, 37856);
});

test("range diagnostics distinguish HTTP status, hidden headers and fetch rejection without URLs", async () => {
  const reader = createProbeRangeReader("https://private.test/secret", {
    fetchImpl: async () =>
      new Response(null, {
        status: 200,
        headers: { "Content-Length": "2525414437", "Content-Range": "https://private.test/secret" }
      })
  });
  await assert.rejects(reader.read(0), /range-or-cors/);
  assert.equal(reader.diagnostics.rangeStatus, 200);
  assert.equal(reader.diagnostics.rangeHeader, "invalid");
  assert.equal(reader.diagnostics.partialLength, 2525414437);
  assert.equal(JSON.stringify(reader.diagnostics).includes("private.test"), false);
  const blocked = createProbeRangeReader("https://private.test/secret", {
    fetchImpl: async () => {
      throw new TypeError("private.test/secret");
    }
  });
  await assert.rejects(blocked.read(0), TypeError);
  assert.deepEqual(blocked.diagnostics, {
    request: "range",
    start: 0,
    end: 262143,
    rangeNetworkRetry: true
  });
});
test("HEAD fallback rejects unknown sizes, CORS errors and a different final resource", async () => {
  for (const kind of ["missing", "zero", "unsafe", "cors", "redirect", "status"]) {
    let cancelled = 0;
    const reader = createProbeRangeReader("https://cdn.test/file", {
      fetchImpl: async (_url, options) => {
        if (options.method === "HEAD") {
          if (kind === "cors") throw new TypeError("Failed to fetch");
          return {
            status: kind === "status" ? 206 : 200,
            url: kind === "redirect" ? "https://cdn.test/other" : "https://cdn.test/file",
            headers: new Headers({
              ...(kind === "missing"
                ? {}
                : {
                    "Content-Length":
                      kind === "zero" ? "0" : kind === "unsafe" ? "9007199254740992" : "300000"
                  })
            })
          };
        }
        return {
          status: 206,
          url: "https://cdn.test/file",
          headers: new Headers({ "Content-Length": String(PROBE_CHUNK_BYTES) }),
          body: { cancel: async () => cancelled++, getReader: () => assert.fail("must not read") }
        };
      }
    });
    await assert.rejects(reader.read(0));
    assert.equal(cancelled, 1);
    assert.equal(reader.bytesRead, 0);
  }
});
test("a hidden range still requires an exact partial length before reading any bytes", async () => {
  for (const length of [null, "1", "300000"]) {
    let cancelled = 0;
    const reader = createProbeRangeReader("https://cdn.test/file", {
      fetchImpl: async (_url, options) => {
        if (options.method === "HEAD")
          return new Response(null, { headers: { "Content-Length": "300000" } });
        return {
          status: 206,
          headers: new Headers(length == null ? {} : { "Content-Length": length }),
          body: { cancel: async () => cancelled++, getReader: () => assert.fail("must not read") }
        };
      }
    });
    await assert.rejects(reader.read(0), /range-or-cors/);
    assert.equal(cancelled, 1);
  }
});
test("byte budget and repeat protection stop additional requests", async () => {
  let calls = 0;
  const reader = createProbeRangeReader("https://cdn.test/file", {
    maxBytes: PROBE_CHUNK_BYTES,
    fetchImpl: async () => {
      calls++;
      return response(0, PROBE_CHUNK_BYTES - 1, 1000000);
    }
  });
  await reader.read(0);
  await assert.rejects(reader.read(0), /repeated/);
  await assert.rejects(reader.read(PROBE_CHUNK_BYTES), /budget/);
  assert.equal(calls, 1);
});
test("truncated, overflowing or changed file responses cannot become metadata", async () => {
  for (const length of [10, PROBE_CHUNK_BYTES + 1]) {
    const reader = createProbeRangeReader("https://cdn.test/file", {
      fetchImpl: async () =>
        new Response(new Uint8Array(length), {
          status: 206,
          headers: { "Content-Range": "bytes 0-262143/700000" }
        })
    });
    await assert.rejects(reader.read(0), /truncated|overflow/);
  }
  let calls = 0;
  const reader = createProbeRangeReader("https://cdn.test/file", {
    fetchImpl: async () => {
      calls++;
      return calls === 1 ? response(0, 262143, 700000) : response(262144, 524287, 700001);
    }
  });
  await reader.read(0);
  await assert.rejects(reader.read(262144), /range-or-cors/);
});

test("HTTPS pages can probe an HTTP public media source via TLS without mixed-content requests", async (t) => {
  const previous = globalThis.location;
  t.after(() => {
    if (previous === undefined) delete globalThis.location;
    else globalThis.location = previous;
  });
  globalThis.location = { protocol: "https:" };
  const reader = createProbeRangeReader("http://media.test/video?api_key=fake", {
    fetchImpl: async (url) => {
      assert.equal(url, "https://media.test/video?api_key=fake");
      return response(0, 9, 10);
    }
  });
  assert.equal((await reader.read(0)).bytes.length, 10);
  assert.equal(reader.diagnostics.secureUpgrade, true);
});

test("CDN HTTP 400 is categorized without confusing it with a CORS denial", async () => {
  const reader = createProbeRangeReader("https://cdn.test/file", {
    fetchImpl: async () =>
      new Response("400 Bad Request private-secret", {
        status: 400,
        headers: { "Content-Type": "text/html" }
      })
  });
  await assert.rejects(reader.read(0), /range-or-cors/);
  assert.equal(reader.diagnostics.rangeStatus, 400);
  assert.equal(reader.diagnostics.errorCategory, "bad-request");
  assert.equal(JSON.stringify(reader.diagnostics).includes("private-secret"), false);
});

test("a selected probe can recover from a blocked HEAD using host metadata", async () => {
  const url = "https://cdn.test/file";
  const sizes = [];
  const reader = createProbeRangeReader(url, {
    resolveHead: async (target) => {
      sizes.push(target);
      return "300000";
    },
    fetchImpl: async (_url, options) => {
      if (options.method === "HEAD") throw new TypeError("Failed to fetch");
      const [, start, end] = /bytes=(\d+)-(\d+)/.exec(options.headers.Range);
      const length = Number(end) - Number(start) + 1;
      return new Response(new Uint8Array(length), {
        status: 206,
        headers: { "Content-Length": String(length) }
      });
    }
  });
  assert.equal((await reader.read(0)).bytes.length, PROBE_CHUNK_BYTES);
  assert.equal((await reader.read(PROBE_CHUNK_BYTES)).bytes.length, 300000 - PROBE_CHUNK_BYTES);
  assert.deepEqual(sizes, [url]);
  assert.equal(reader.diagnostics.headViaHost, true);
});
