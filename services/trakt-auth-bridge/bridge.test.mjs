import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createTraktAuthBridgeServer } from "./bridge.mjs";

async function withBridge({ environment, fetchImpl }, run) {
  const server = createTraktAuthBridgeServer({ environment, fetchImpl });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

function upstreamResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("bridge keeps secrets server-side while forwarding device authorization", async () => {
  const requests = [];
  await withBridge(
    {
      environment: { TRAKT_CLIENT_ID: "public-client", TRAKT_CLIENT_SECRET: "server-secret" },
      fetchImpl: async (url, options) => {
        requests.push({ url, body: JSON.parse(options.body) });
        return upstreamResponse({
          device_code: "device-code",
          user_code: "CODE",
          verification_url: "https://trakt.tv/activate",
          expires_in: 600,
          interval: 5,
          ignored_secret: "must-not-reach-browser"
        });
      }
    },
    async (baseUrl) => {
      const health = await fetch(`${baseUrl}/api/trakt/health`);
      assert.deepEqual(await health.json(), { configured: true });
      const response = await fetch(`${baseUrl}/api/trakt/device/code`, { method: "POST" });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        device_code: "device-code",
        user_code: "CODE",
        verification_url: "https://trakt.tv/activate",
        expires_in: 600,
        interval: 5
      });
    }
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.trakt.tv/oauth/device/code");
  assert.equal(requests[0].body.client_id, "public-client");
  assert.equal("client_secret" in requests[0].body, false);
});

test("bridge performs device exchange and refresh without persisting or exposing tokens", async () => {
  const requests = [];
  await withBridge(
    {
      environment: { TRAKT_CLIENT_ID: "public-client", TRAKT_CLIENT_SECRET: "server-secret" },
      fetchImpl: async (url, options) => {
        requests.push({ url, body: JSON.parse(options.body) });
        return upstreamResponse({
          access_token: "access-next",
          refresh_token: "refresh-rotated",
          expires_in: 3600,
          created_at: 10,
          token_type: "bearer",
          scope: "scrobble",
          internal: "not-returned"
        });
      }
    },
    async (baseUrl) => {
      const device = await fetch(`${baseUrl}/api/trakt/device/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "device-code" })
      });
      assert.equal(device.status, 200);
      assert.equal((await device.json()).refresh_token, "refresh-rotated");
      const refresh = await fetch(`${baseUrl}/api/trakt/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: "refresh-old" })
      });
      assert.equal(refresh.status, 200);
      assert.equal((await refresh.json()).refresh_token, "refresh-rotated");
    }
  );
  assert.equal(requests[0].body.client_secret, "server-secret");
  assert.equal(requests[1].body.client_secret, "server-secret");
  assert.equal(requests[1].body.refresh_token, "refresh-old");
  assert.equal(requests[1].body.grant_type, "refresh_token");
});

test("every request to Trakt names its caller, or Cloudflare refuses it", async () => {
  // Node fetch sends no User-Agent by default, and the Cloudflare in front of
  // the Trakt API answers that with an HTML block page carrying 403 -- which
  // reads as rejected credentials rather than as a request Trakt never saw.
  const seen = [];
  await withBridge(
    {
      environment: { TRAKT_CLIENT_ID: "public-client" },
      fetchImpl: async (url, options) => {
        seen.push(options.headers);
        return upstreamResponse({ access_token: "a", refresh_token: "r", expires_in: 3600 });
      }
    },
    async (baseUrl) => {
      await fetch(`${baseUrl}/api/trakt/device/code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      await fetch(`${baseUrl}/api/trakt/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: "refresh-old" })
      });
    }
  );
  assert.equal(seen.length, 2);
  for (const headers of seen) {
    assert.ok(String(headers["User-Agent"] || "").trim(), "a request went out unnamed");
  }
});

test("an app with no client secret signs users in rather than meeting a 503", async () => {
  // Trakt no longer issues a secret to apps that sign users in, and says the
  // secret is deprecated for that purpose. Requiring one here made every request
  // 503 for exactly the apps Trakt now tells people to create.
  const requests = [];
  await withBridge(
    {
      environment: { TRAKT_CLIENT_ID: "public-client" },
      fetchImpl: async (url, options) => {
        requests.push({ url, body: JSON.parse(options.body) });
        return upstreamResponse({
          access_token: "access-next",
          refresh_token: "refresh-rotated",
          expires_in: 3600,
          token_type: "bearer"
        });
      }
    },
    async (baseUrl) => {
      const health = await fetch(`${baseUrl}/api/trakt/health`);
      assert.deepEqual(await health.json(), { configured: true });

      const device = await fetch(`${baseUrl}/api/trakt/device/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "device-code" })
      });
      assert.equal(device.status, 200);

      const refresh = await fetch(`${baseUrl}/api/trakt/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: "refresh-old" })
      });
      assert.equal(refresh.status, 200);
    }
  );

  // Absent, not empty. Trakt reads an empty client_secret as a wrong one.
  for (const request of requests) {
    assert.equal("client_secret" in request.body, false, `${request.url} sent a secret`);
  }
  assert.equal(requests[0].body.client_id, "public-client");
  assert.equal(requests[1].body.grant_type, "refresh_token");
});

test("an app that still has a secret keeps sending it", async () => {
  // Deployments created before Trakt stopped issuing secrets are running on one,
  // and making it optional must not quietly stop using theirs.
  const requests = [];
  await withBridge(
    {
      environment: { TRAKT_CLIENT_ID: "public-client", TRAKT_CLIENT_SECRET: "server-secret" },
      fetchImpl: async (url, options) => {
        requests.push({ url, body: JSON.parse(options.body) });
        return upstreamResponse({ access_token: "a", refresh_token: "r", expires_in: 3600 });
      }
    },
    async (baseUrl) => {
      await fetch(`${baseUrl}/api/trakt/device/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "device-code" })
      });
    }
  );
  assert.equal(requests[0].body.client_secret, "server-secret");
});

test("a rate limit arrives with the wait Trakt asked for, not a guess", async () => {
  // The browser reads Retry-After to decide what to tell the viewer and whether
  // to retry quickly. Dropping it here left it defaulting to five minutes, so a
  // twenty-two second wait was reported as five -- and the short retry that
  // depends on the header never ran once.
  await withBridge(
    {
      environment: { TRAKT_CLIENT_ID: "public-client" },
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: "rate limited" }), {
          status: 429,
          headers: { "Content-Type": "application/json", "Retry-After": "22" }
        })
    },
    async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/trakt/device/code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      assert.equal(res.status, 429);
      assert.equal(res.headers.get("Retry-After"), "22");
    }
  );
});

test("a Retry-After that is not a count of seconds is not passed on", async () => {
  // Trakt may answer with an HTTP date instead. Forwarding it unread would have
  // the browser parse a date as seconds; offering nothing is the honest answer.
  await withBridge(
    {
      environment: { TRAKT_CLIENT_ID: "public-client" },
      fetchImpl: async () =>
        new Response("{}", {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT"
          }
        })
    },
    async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/trakt/device/code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      assert.equal(res.status, 429);
      assert.equal(res.headers.get("Retry-After"), null);
    }
  );
});

test("bridge reports unconfigured state and rejects unsupported methods", async () => {
  await withBridge(
    { environment: {}, fetchImpl: async () => assert.fail("must not call Trakt") },
    async (baseUrl) => {
      const health = await fetch(`${baseUrl}/api/trakt/health`);
      assert.deepEqual(await health.json(), { configured: false });
      const request = await fetch(`${baseUrl}/api/trakt/device/code`, { method: "POST" });
      assert.equal(request.status, 503);
    }
  );
});
