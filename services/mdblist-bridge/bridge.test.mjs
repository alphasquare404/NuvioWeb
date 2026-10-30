import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createMdbListBridgeServer } from "./bridge.mjs";

async function withBridge({ environment, fetchImpl }, run) {
  const server = createMdbListBridgeServer({ environment, fetchImpl });
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

function upstreamResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

test("health reports a missing MDBList client id without leaking config", async () => {
  await withBridge(
    {
      environment: {},
      fetchImpl: async () => upstreamResponse({})
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/mdblist/health`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { configured: false });
      const blocked = await fetch(`${baseUrl}/api/mdblist/oauth/device`, { method: "POST" });
      assert.equal(blocked.status, 503);
      assert.deepEqual(await blocked.json(), {
        error: "MDBList browser authentication is not configured"
      });
    }
  );
});

test("device authorization sends the server client id and only browser-safe fields", async () => {
  const calls = [];
  await withBridge(
    {
      environment: { MDBLIST_CLIENT_ID: "server-client" },
      fetchImpl: async (url, options) => {
        calls.push({ url, options, form: new URLSearchParams(options.body) });
        return upstreamResponse({
          device_code: "device-code",
          user_code: "USER-CODE",
          verification_uri: "https://mdblist.com/oauth/device",
          verification_uri_complete: "https://mdblist.com/oauth/device?user_code=USER-CODE",
          expires_in: 600,
          interval: 5,
          internal: "must-not-reach-browser"
        });
      }
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/mdblist/oauth/device`, { method: "POST" });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        device_code: "device-code",
        user_code: "USER-CODE",
        verification_uri: "https://mdblist.com/oauth/device",
        verification_uri_complete: "https://mdblist.com/oauth/device?user_code=USER-CODE",
        expires_in: 600,
        interval: 5
      });
    }
  );
  assert.equal(calls[0].url, "https://api.mdblist.com/oauth/device-authorization/");
  assert.equal(calls[0].form.get("client_id"), "server-client");
  assert.equal(calls[0].form.get("scope"), "write");
});

test("device token and refresh exchange strip unknown token fields", async () => {
  const calls = [];
  await withBridge(
    {
      environment: { MDBLIST_CLIENT_ID: "server-client" },
      fetchImpl: async (url, options) => {
        calls.push(new URLSearchParams(options.body));
        return upstreamResponse({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "write",
          secret: "must-not-return"
        });
      }
    },
    async (baseUrl) => {
      const token = await fetch(`${baseUrl}/api/mdblist/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_code: "device-code" })
      });
      const tokenPayload = await token.json();
      assert.equal(token.status, 200);
      assert.equal(tokenPayload.access_token, "access-token");
      assert.equal("secret" in tokenPayload, false);

      const refresh = await fetch(`${baseUrl}/api/mdblist/oauth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: "refresh-token" })
      });
      assert.equal(refresh.status, 200);
      assert.equal((await refresh.json()).refresh_token, "refresh-token");
    }
  );
  assert.equal(calls[0].get("grant_type"), "urn:ietf:params:oauth:grant-type:device_code");
  assert.equal(calls[0].get("device_code"), "device-code");
  assert.equal(calls[1].get("grant_type"), "refresh_token");
  assert.equal(calls[1].get("refresh_token"), "refresh-token");
});

test("proxy forwards only allowlisted tracking paths with a bearer token", async () => {
  const calls = [];
  await withBridge(
    {
      environment: { MDBLIST_CLIENT_ID: "server-client" },
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return upstreamResponse({ ok: true });
      }
    },
    async (baseUrl) => {
      const allowed = await fetch(`${baseUrl}/api/mdblist/api/sync/watched?limit=100`, {
        method: "GET",
        headers: { Authorization: "Bearer access-token" }
      });
      assert.equal(allowed.status, 200);
      assert.deepEqual(await allowed.json(), { ok: true });

      const scrobble = await fetch(`${baseUrl}/api/mdblist/api/scrobble/start`, {
        method: "POST",
        headers: {
          Authorization: "Bearer access-token",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ movie: { ids: { tmdb: 1 } }, progress: 12.5 })
      });
      assert.equal(scrobble.status, 200);

      const deniedPath = await fetch(`${baseUrl}/api/mdblist/api/oauth/device-authorization`, {
        method: "POST",
        headers: { Authorization: "Bearer access-token" },
        body: "{}"
      });
      assert.equal(deniedPath.status, 403);

      const missingToken = await fetch(`${baseUrl}/api/mdblist/api/sync/watched`);
      assert.equal(missingToken.status, 401);
    }
  );
  assert.equal(calls[0].url, "https://api.mdblist.com/sync/watched?limit=100");
  assert.equal(calls[0].options.headers.Authorization, "Bearer access-token");
  assert.equal(calls[1].url, "https://api.mdblist.com/scrobble/start");
  assert.equal(calls[1].options.method, "POST");
  assert.equal(
    calls[1].options.body,
    JSON.stringify({ movie: { ids: { tmdb: 1 } }, progress: 12.5 })
  );
});

test("proxy allows the watchlist read and membership mutations", async () => {
  const calls = [];
  await withBridge(
    {
      environment: { MDBLIST_CLIENT_ID: "server-client" },
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return upstreamResponse({ ok: true });
      }
    },
    async (baseUrl) => {
      const read = await fetch(`${baseUrl}/api/mdblist/api/watchlist/items?limit=1000`, {
        headers: { Authorization: "Bearer access-token" }
      });
      assert.equal(read.status, 200);
      const add = await fetch(`${baseUrl}/api/mdblist/api/watchlist/items/add`, {
        method: "POST",
        headers: { Authorization: "Bearer access-token" },
        body: JSON.stringify({ movies: [{ ids: { imdb: "tt1" } }] })
      });
      assert.equal(add.status, 200);
      const remove = await fetch(`${baseUrl}/api/mdblist/api/watchlist/items/remove`, {
        method: "POST",
        headers: { Authorization: "Bearer access-token" },
        body: JSON.stringify({ movies: [{ ids: { imdb: "tt1" } }] })
      });
      assert.equal(remove.status, 200);
    }
  );
  assert.equal(calls[0].url, "https://api.mdblist.com/watchlist/items?limit=1000");
  assert.equal(calls[1].url, "https://api.mdblist.com/watchlist/items/add");
  assert.equal(calls[2].url, "https://api.mdblist.com/watchlist/items/remove");
});

test("proxy allows personal list reads and membership mutations", async () => {
  const calls = [];
  await withBridge(
    {
      environment: { MDBLIST_CLIENT_ID: "server-client" },
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return upstreamResponse({ ok: true });
      }
    },
    async (baseUrl) => {
      const lists = await fetch(`${baseUrl}/api/mdblist/api/lists/user`, {
        headers: { Authorization: "Bearer access-token" }
      });
      assert.equal(lists.status, 200);
      const items = await fetch(`${baseUrl}/api/mdblist/api/lists/9/items?limit=1000`, {
        headers: { Authorization: "Bearer access-token" }
      });
      assert.equal(items.status, 200);
      const add = await fetch(`${baseUrl}/api/mdblist/api/lists/9/items/add`, {
        method: "POST",
        headers: { Authorization: "Bearer access-token" },
        body: JSON.stringify({ movies: [{ imdb: "tt1" }] })
      });
      assert.equal(add.status, 200);
    }
  );
  assert.equal(calls[0].url, "https://api.mdblist.com/lists/user");
  assert.equal(calls[1].url, "https://api.mdblist.com/lists/9/items?limit=1000");
  assert.equal(calls[2].url, "https://api.mdblist.com/lists/9/items/add");
});

test("proxy preserves MDBList rate-limit wait", async () => {
  await withBridge(
    {
      environment: { MDBLIST_CLIENT_ID: "server-client" },
      fetchImpl: async () =>
        upstreamResponse({ error: "rate limited" }, 429, { "Retry-After": "22" })
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/mdblist/api/scrobble/stop`, {
        method: "POST",
        headers: { Authorization: "Bearer access-token" },
        body: "{}"
      });
      assert.equal(response.status, 429);
      assert.equal(response.headers.get("Retry-After"), "22");
    }
  );
});
