import test from "node:test";
import assert from "node:assert/strict";
import { createClientMediaUrlResolver } from "./clientMediaUrlResolver.js";
import { createProbeRangeReader } from "../player/probeRangeReader.js";

const reply = (url, options = {}) => {
  const response = new Response(null, options);
  Object.defineProperty(response, "url", { value: url });
  return response;
};
test("host assistance is opt-in, on-demand and its result is cached", async () => {
  let calls = 0;
  const hostResolve = async () => {
    calls++;
    return { url: "https://cdn.test/host-resolved" };
  };
  const disabled = createClientMediaUrlResolver({ hostResolve });
  assert.equal((await disabled.resolve("https://addon.test/file", { skipDirect: true })).ok, false);
  assert.equal(calls, 0);
  const enabled = createClientMediaUrlResolver({ allowHostResolve: true, hostResolve });
  assert.equal(calls, 0);
  assert.equal(
    (await enabled.resolve("https://addon.test/file", { skipDirect: true })).url,
    "https://cdn.test/host-resolved"
  );
  await enabled.resolve("https://addon.test/file", { skipDirect: true });
  assert.equal(calls, 1);
});

test("a blocked probe can obtain only a URL from the host then read the media in the browser", async () => {
  const calls = [];
  const resolver = createClientMediaUrlResolver({
    allowHostResolve: true,
    hostResolve: async () => ({ url: "https://cdn.test/file" })
  });
  const reader = createProbeRangeReader("https://addon.test/file", {
    urlResolver: resolver,
    fetchImpl: async (url, options) => {
      calls.push(url);
      assert.equal(options.mode, "cors");
      if (url.includes("addon.test")) throw new TypeError("CORS");
      return new Response(new Uint8Array(10), {
        status: 206,
        headers: { "Content-Range": "bytes 0-9/10" }
      });
    }
  });
  await reader.read(0);
  assert.deepEqual(calls, ["https://addon.test/file", "https://cdn.test/file"]);
  assert.equal(reader.diagnostics.hostResolved, true);
  assert.equal(reader.bytesRead, 10);
});

test("an enabled known Torrentio source resolves before attempting its blocked redirect chain", async () => {
  const source = `https://torrentio.strem.fun/resolve/torbox/credential/${"a".repeat(40)}/movie.mp4/0/movie.mp4`;
  const resolver = createClientMediaUrlResolver({
    allowHostResolve: true,
    hostResolve: async () => ({ url: "https://cdn.test/direct" })
  });
  const reader = createProbeRangeReader(source, {
    urlResolver: resolver,
    fetchImpl: async (url) => {
      assert.equal(url, "https://cdn.test/direct");
      return new Response(new Uint8Array(10), {
        status: 206,
        headers: { "Content-Range": "bytes 0-9/10" }
      });
    }
  });
  await reader.read(0);
  assert.equal(reader.diagnostics.hostResolved, true);
});
test("resolve is on demand, follows CORS and deduplicates consumers with a short memory cache", async () => {
  let clock = 0,
    calls = 0;
  const resolver = createClientMediaUrlResolver({ now: () => clock, ttlMs: 1000 });
  assert.equal(resolver.cached("https://addon.test/file"), null);
  assert.equal(calls, 0);
  const fetchImpl = async (_url, options) => {
    calls++;
    assert.equal(options.method, "HEAD");
    assert.equal(options.mode, "cors");
    assert.equal(options.credentials, "omit");
    assert.equal(options.cache, "no-store");
    return reply("https://cdn.test/signed");
  };
  const results = await Promise.all(
    [1, 2].map(() => resolver.resolve("https://addon.test/file", { fetchImpl }))
  );
  assert.equal(calls, 1);
  assert.equal(results[0].url, "https://cdn.test/signed");
  await resolver.resolve("https://addon.test/file", { fetchImpl });
  assert.equal(calls, 1);
  clock = 1001;
  await resolver.resolve("https://addon.test/file", { fetchImpl });
  assert.equal(calls, 2);
  resolver.invalidate("https://addon.test/file");
  assert.equal(resolver.cached("https://addon.test/file"), null);
});
test("GET-only sources resolve using a one-byte Range, cancelling before any body is read", async () => {
  let calls = 0,
    cancelled = false;
  const result = await createClientMediaUrlResolver().resolve("https://addon.test/file", {
    fetchImpl: async (_url, options) => {
      if (++calls === 1) return reply("https://addon.test/file", { status: 405 });
      assert.equal(options.headers.Range, "bytes=0-0");
      return {
        status: 200,
        url: "https://cdn.test/file",
        headers: new Headers(),
        body: {
          cancel: async () => {
            cancelled = true;
          },
          getReader: () => assert.fail("must not read media")
        }
      };
    }
  });
  assert.equal(result.url, "https://cdn.test/file");
  assert.equal(cancelled, true);
});
test("CORS failure never becomes an opaque/proxy request, is not cached and can be retried", async () => {
  let calls = 0;
  const resolver = createClientMediaUrlResolver();
  const options = {
    fetchImpl: async (_url, init) => {
      calls++;
      assert.equal(init.mode, "cors");
      throw new TypeError("private provider failure");
    }
  };
  assert.deepEqual(await resolver.resolve("https://addon.test/file", options), {
    ok: false,
    reason: "cors-or-network"
  });
  assert.equal(resolver.cached("https://addon.test/file"), null);
  await resolver.resolve("https://addon.test/file", options);
  assert.equal(calls, 4);
});
test("invalid/non-media/aborted links are rejected and bounded cache evicts older entries", async () => {
  const resolver = createClientMediaUrlResolver({ maxEntries: 1 });
  assert.equal((await resolver.resolve("file:///private")).ok, false);
  assert.equal(
    (
      await resolver.resolve("https://addon.test/file", {
        fetchImpl: async () =>
          reply("https://cdn.test/login", { headers: { "Content-Type": "text/html" } })
      })
    ).reason,
    "not-media"
  );
  assert.equal(
    (await resolver.resolve("https://addon.test/file", { signal: AbortSignal.abort() })).reason,
    "aborted"
  );
  resolver.remember("https://addon.test/a", "https://cdn.test/a");
  resolver.remember("https://addon.test/b", "https://cdn.test/b");
  assert.equal(resolver.cached("https://addon.test/a"), null);
});
test("successful probe ranges populate the shared resolver without another request", async () => {
  const resolver = createClientMediaUrlResolver();
  const reader = createProbeRangeReader("https://addon.test/file", {
    urlResolver: resolver,
    fetchImpl: async () => {
      const response = new Response(new Uint8Array(10), {
        status: 206,
        headers: { "Content-Range": "bytes 0-9/10" }
      });
      Object.defineProperty(response, "url", { value: "https://cdn.test/file" });
      return response;
    }
  });
  await reader.read(0);
  const result = await resolver.resolve("https://addon.test/file", {
    fetchImpl: () => assert.fail("cached probe URL needs no HEAD")
  });
  assert.equal(result.url, "https://cdn.test/file");
});

test("a failed host helper does not veto a source the browser can read", async () => {
  const source = `https://torrentio.strem.fun/resolve/torbox/credential/${"b".repeat(40)}/movie.mp4/0/movie.mp4`;
  let hostCalls = 0,
    rangeCalls = 0;
  const resolver = createClientMediaUrlResolver({
    allowHostResolve: true,
    hostResolve: async (_url, { onFailure }) => {
      hostCalls++;
      onFailure({
        status: 502,
        stage: "provider",
        upstreamStatus: 429,
        reason: "missing-redirect"
      });
      return null;
    }
  });
  const reader = createProbeRangeReader(source, {
    urlResolver: resolver,
    fetchImpl: async (url) => {
      rangeCalls++;
      assert.equal(url, source);
      return new Response(new Uint8Array(10), {
        status: 206,
        headers: { "Content-Range": "bytes 0-9/10" }
      });
    }
  });
  assert.equal((await reader.read(0)).bytes.length, 10);
  assert.equal(hostCalls, 1);
  assert.equal(rangeCalls, 1);
  assert.equal(reader.diagnostics.hostResolveStatus, "failed");
  assert.equal(reader.diagnostics.hostFailure.upstreamStatus, 429);
  assert.equal(JSON.stringify(reader.diagnostics).includes("credential"), false);
});

test("a failed helper and blocked source do not repeat the same host request", async () => {
  const source = `https://torrentio.strem.fun/resolve/torbox/credential/${"c".repeat(40)}/movie.mp4/0/movie.mp4`;
  let calls = 0;
  const reader = createProbeRangeReader(source, {
    urlResolver: createClientMediaUrlResolver({
      allowHostResolve: true,
      hostResolve: async () => {
        calls++;
        return null;
      }
    }),
    fetchImpl: async () => {
      throw new TypeError("CORS");
    }
  });
  await assert.rejects(reader.read(0), TypeError);
  assert.equal(calls, 1);
});

test("public add-on URLs can request host assistance with one flag and do not pre-resolve", async (t) => {
  const previous = globalThis.__NUVIO_ENV__;
  globalThis.__NUVIO_ENV__ = {
    MEDIA_URL_HOST_RESOLVE_ENABLED: "true"
  };
  t.after(() => {
    globalThis.__NUVIO_ENV__ = previous;
  });
  const { clientMediaUrlResolver } = await import("./clientMediaUrlResolver.js");
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "/api/debrid/link/from-addon");
    assert.equal(options.method, "POST");
    assert.equal(JSON.parse(options.body).url, "https://service.example/api/play/movie-1");
    return Response.json({ data: "https://media.example/movie-1" });
  });
  assert.equal(clientMediaUrlResolver.canUseHost("https://service.example/api/play/movie-1"), true);
  assert.equal(clientMediaUrlResolver.canUseHost("https://service.example/api/play/movie-2"), true);
  assert.equal(clientMediaUrlResolver.canUseHost("https://other-addon.example/player/video"), true);
  assert.equal(clientMediaUrlResolver.canUseHost("https://127.0.0.1/video"), false);
  assert.equal(
    clientMediaUrlResolver.canPreResolve("https://service.example/api/play/movie-1"),
    false
  );
  assert.equal(
    (
      await clientMediaUrlResolver.resolve("https://service.example/api/play/movie-1", {
        skipDirect: true
      })
    ).url,
    "https://media.example/movie-1"
  );
});
