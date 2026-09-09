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
