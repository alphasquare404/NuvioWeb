import assert from "node:assert/strict";
import { once } from "node:events";
import { Readable } from "node:stream";
import test from "node:test";
import { createDebridApiBridgeServer } from "./bridge.mjs";

const provider = "https://provider.example/catalog";
const publicAddress = { address: "1.1.1.1", family: 4 };

async function fixture(t, options = {}) {
  const outbound = [];
  const server = createDebridApiBridgeServer({
    pluginRelay: {
      supabaseUrl: "https://auth.example",
      anonKey: "fixture-anon-key",
      authFetch: async (url, request) => {
        assert.equal(url.href, "https://auth.example/auth/v1/user");
        return request.headers.Authorization === "Bearer fixture.session.token"
          ? Response.json({ id: "fixture-user", is_anonymous: false })
          : new Response(null, { status: 401 });
      },
      lookup: async () => [publicAddress],
      openResponse: async (url, addresses, signal, request) => {
        outbound.push({ url: url.href, addresses, ...request });
        return Object.assign(Readable.from([Buffer.from("provider data")]), {
          headers: { "content-type": "text/plain" },
          statusCode: 200
        });
      },
      ...options
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = "http://127.0.0.1:" + server.address().port;
  return {
    outbound,
    request: (body, headers = {}) =>
      fetch(origin + "/api/debrid/plugin/fetch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer fixture.session.token",
          Origin: origin,
          ...headers
        },
        body: JSON.stringify(body)
      })
  };
}

test("the bridge verifies a session and returns a provider body without CORS headers", async (t) => {
  const { request, outbound } = await fixture(t);
  const response = await request({ url: provider, responseEncoding: "base64" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  const payload = await response.json();
  assert.equal(payload.body, "provider data");
  assert.equal(Buffer.from(payload.bodyBase64, "base64").toString(), payload.body);
  assert.deepEqual(outbound[0].addresses, [publicAddress]);
  assert.equal(outbound[0].headers.authorization, undefined);
});

test("invalid sessions and cross-origin calls never contact the provider", async (t) => {
  const { request, outbound } = await fixture(t);
  assert.equal((await request({ url: provider }, { Authorization: "Bearer invalid" })).status, 401);
  assert.equal((await request({ url: provider }, { Origin: "https://other.example" })).status, 403);
  assert.deepEqual(outbound, []);
});

test("redirects to non-public addresses are denied before opening a second connection", async (t) => {
  const contacted = [];
  const { request } = await fixture(t, {
    lookup: async (host) =>
      host === "provider.example" ? [publicAddress] : [{ address: "127.0.0.1", family: 4 }],
    openResponse: async (url) => {
      contacted.push(url.hostname);
      return Object.assign(Readable.from([]), {
        headers: { location: "https://next.example/catalog" },
        statusCode: 302
      });
    }
  });
  assert.equal((await request({ url: provider })).status, 403);
  assert.deepEqual(contacted, ["provider.example"]);
});

test("cross-origin redirects do not carry plugin credentials or untrusted transport headers", async (t) => {
  const requests = [];
  const { request } = await fixture(t, {
    openResponse: async (url, addresses, signal, options) => {
      requests.push(options);
      const isInitial = url.hostname === "provider.example";
      return Object.assign(Readable.from([]), {
        headers: isInitial ? { location: "https://other.example/result" } : {},
        statusCode: isInitial ? 303 : 200
      });
    }
  });
  assert.equal(
    (
      await request({
        url: provider,
        method: "POST",
        headers: {
          Authorization: "provider-token",
          Cookie: "provider-cookie",
          Host: "other.example"
        },
        bodyKind: "text",
        body: "payload"
      })
    ).status,
    200
  );
  assert.equal(requests[0].headers.host, undefined);
  assert.equal(requests[0].headers.authorization, "provider-token");
  assert.equal(requests[1].method, "GET");
  assert.equal(requests[1].body, undefined);
  assert.equal(requests[1].headers.authorization, undefined);
  assert.equal(requests[1].headers.cookie, undefined);
});

test("upstream failures remain visible and large response bodies are capped", async (t) => {
  const { request } = await fixture(t, {
    openResponse: async () =>
      Object.assign(Readable.from([Buffer.alloc(1024 * 1024 + 1, 97)]), {
        statusCode: 404,
        headers: {}
      })
  });
  const response = await request({ url: provider });
  const payload = await response.json();
  assert.equal(payload.status, 404);
  assert.equal(payload.ok, false);
  assert.equal(payload.body.length, 1024 * 1024);
  assert.equal(payload.truncated, true);
});

test("media size lookup reads only the headers of a one-byte range", async (t) => {
  let bodyRead = false;
  let requestOptions;
  const { request } = await fixture(t, {
    openResponse: async (_url, _addresses, _signal, options) => {
      requestOptions = options;
      return Object.assign(
        new Readable({
          read() {
            bodyRead = true;
            this.push(null);
          }
        }),
        {
          headers: { "content-range": "bytes 0-0/300000" },
          statusCode: 206
        }
      );
    }
  });
  const response = await request({ url: provider, metadataOnly: true });
  assert.deepEqual(await response.json(), { url: provider, size: 300000 });
  assert.equal(requestOptions.method, "GET");
  assert.equal(requestOptions.headers.range, "bytes=0-0");
  assert.equal(bodyRead, false);
});
