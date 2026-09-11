import assert from "node:assert/strict";
import test from "node:test";

import { createDebridApiBridgeServer } from "./bridge.mjs";

async function withBridge(options, run) {
  const server = createDebridApiBridgeServer(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

function upstream(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

test("TorBox device start uses the fixed upstream URL and returns only device fields", async () => {
  const calls = [];
  await withBridge(
    {
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return upstream({
          success: true,
          data: {
            device_code: "device-code",
            code: "ABC123",
            verification_url: "https://tor.box/link",
            interval: 5,
            expires_at: "2030-01-01T00:00:00Z",
            ignored: "not-exposed"
          }
        });
      }
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/debrid/torbox/device/start`, { method: "POST" });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        success: true,
        data: {
          device_code: "device-code",
          code: "ABC123",
          verification_url: "https://tor.box/link",
          friendly_verification_url: "",
          interval: 5,
          expires_at: "2030-01-01T00:00:00Z"
        }
      });
    }
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.torbox.app/v1/api/user/auth/device/start?app=Nuvio");
  assert.equal(calls[0].options.method, undefined);
  assert.equal(calls[0].options.redirect, "manual");
});

test("TorBox bridge preserves the documented HTTP 400 success:false pending polling response", async () => {
  let call = 0;
  await withBridge(
    {
      fetchImpl: async () => {
        call += 1;
        return call === 1
          ? upstream({ detail: "credential-or-provider-detail" }, 503)
          : upstream({ success: false, error: "not_authorized", detail: "Awaiting approval" }, 400);
      }
    },
    async (baseUrl) => {
      const failedStart = await fetch(`${baseUrl}/api/debrid/torbox/device/start`, { method: "POST" });
      assert.deepEqual(await failedStart.json(), {
        ok: false,
        error: "provider_request_failed",
        status: 503
      });

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const pending = await fetch(`${baseUrl}/api/debrid/torbox/device/redeem`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceCode: "device-code" })
        });
        assert.equal(pending.status, 400);
        assert.deepEqual(await pending.json(), {
          ok: false,
          error: "authorization_pending",
          status: 400
        });
      }
    }
  );
});

test("TorBox redeem reports expiry and keeps unexpected failures fatal", async () => {
  let call = 0;
  await withBridge(
    {
      fetchImpl: async () => {
        call += 1;
        return call === 1
          ? upstream({ success: false, error: "expired_device_code", detail: "Device code expired" }, 400)
          : upstream({ success: false, error: "invalid_request", detail: "Malformed request" }, 400);
      }
    },
    async (baseUrl) => {
      const expired = await fetch(`${baseUrl}/api/debrid/torbox/device/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceCode: "device-code" })
      });
      assert.deepEqual(await expired.json(), {
        ok: false,
        error: "authorization_expired",
        status: 400
      });
      const failed = await fetch(`${baseUrl}/api/debrid/torbox/device/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceCode: "device-code" })
      });
      assert.deepEqual(await failed.json(), {
        ok: false,
        error: "provider_request_failed",
        status: 400
      });
    }
  );
});

test("TorBox redeem returns the existing token envelope without logging credentials", async () => {
  const calls = [];
  await withBridge(
    {
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return upstream({ success: true, data: { access_token: "provider-token", other: "hidden" } });
      }
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/debrid/torbox/device/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceCode: "device-code" })
      });
      assert.deepEqual(await response.json(), {
        success: true,
        data: { access_token: "provider-token" }
      });
    }
  );
  assert.equal(calls[0].url, "https://api.torbox.app/v1/api/user/auth/device/token");
  assert.deepEqual(JSON.parse(calls[0].options.body), { device_code: "device-code" });
});

test("account validation forwards the credential only as an upstream authorization header", async () => {
  const calls = [];
  await withBridge(
    {
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return upstream({ success: true, data: { email: "not-exposed" } });
      }
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/debrid/torbox/account`, {
        headers: { Authorization: "Bearer credential-value" }
      });
      assert.deepEqual(await response.json(), { ok: true });
    }
  );
  assert.equal(calls[0].url, "https://api.torbox.app/v1/api/user/me");
  assert.equal(calls[0].options.headers.Authorization, "Bearer credential-value");
  assert.equal(calls[0].url.includes("credential-value"), false);
});

test("account failures are sanitized and do not echo provider credentials", async () => {
  await withBridge(
    { fetchImpl: async () => upstream({ detail: "credential-value" }, 401) },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/debrid/torbox/account`, {
        headers: { Authorization: "Bearer credential-value" }
      });
      assert.equal(response.status, 401);
      const body = JSON.stringify(await response.json());
      assert.equal(body.includes("credential-value"), false);
      assert.equal(body.includes("detail"), false);
    }
  );
});

test("bridge rejects unknown, arbitrary, invalid-method, oversized, redirect, and timed-out requests", async () => {
  let fetchCalls = 0;
  await withBridge(
    {
      requestTimeoutMs: 10,
      fetchImpl: async (_url, options) => {
        fetchCalls += 1;
        if (fetchCalls === 1) return new Response(null, { status: 302, headers: { Location: "https://example.invalid" } });
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }
    },
    async (baseUrl) => {
      for (const path of [
        "/api/debrid/not-a-provider/device/start",
        "/api/debrid/torbox/proxy?url=https://example.invalid",
        "/api/debrid/torbox/device/start/extra"
      ]) {
        const response = await fetch(`${baseUrl}${path}`, { method: "POST" });
        assert.equal(response.status, 404);
      }
      const invalidMethod = await fetch(`${baseUrl}/api/debrid/torbox/account`, { method: "POST" });
      assert.equal(invalidMethod.status, 405);

      const oversized = await fetch(`${baseUrl}/api/debrid/torbox/device/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceCode: "x".repeat(9 * 1024) })
      });
      assert.equal(oversized.status, 413);

      const redirect = await fetch(`${baseUrl}/api/debrid/torbox/device/start`, { method: "POST" });
      assert.equal(redirect.status, 502);
      const timeout = await fetch(`${baseUrl}/api/debrid/torbox/device/start`, { method: "POST" });
      assert.equal(timeout.status, 502);
    }
  );
});

test("Premiumize uses fixed device and account endpoints when supplied with a public client ID", async () => {
  const calls = [];
  await withBridge(
    {
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith("/token")) {
          return upstream({ device_code: "device", user_code: "CODE", verification_uri: "https://premiumize.me/device" });
        }
        return upstream({ status: "success" });
      }
    },
    async (baseUrl) => {
      const start = await fetch(`${baseUrl}/api/debrid/premiumize/device/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: "public-client-id" })
      });
      assert.equal((await start.json()).device_code, "device");
      const account = await fetch(`${baseUrl}/api/debrid/premiumize/account`, {
        headers: { Authorization: "Bearer credential-value" }
      });
      assert.deepEqual(await account.json(), { ok: true });
    }
  );
  assert.equal(calls[0].url, "https://www.premiumize.me/token");
  assert.match(calls[0].options.body, /client_id=public-client-id/);
  assert.equal(calls[1].url, "https://www.premiumize.me/api/account/info");
});

test("TorBox cache checks use a fixed endpoint, forward credentials only upstream, and preserve cached states", async () => {
  const calls = [];
  await withBridge(
    {
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return upstream({ success: true, data: { hashcached: { name: "video.mkv", size: 42 } } });
      }
    },
    async (baseUrl) => {
      const cached = await fetch(`${baseUrl}/api/debrid/torbox/cache/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer credential-value" },
        body: JSON.stringify({ hashes: ["hashcached", "hashmissing"] })
      });
      assert.equal(cached.status, 200);
      assert.deepEqual(await cached.json(), {
        success: true,
        data: { hashcached: { name: "video.mkv", size: 42 } }
      });
    }
  );
  assert.equal(calls[0].url, "https://api.torbox.app/v1/api/torrents/checkcached?format=object");
  assert.equal(calls[0].url.includes("credential-value"), false);
  assert.equal(calls[0].options.headers.Authorization, "Bearer credential-value");
  assert.deepEqual(JSON.parse(calls[0].options.body), { hashes: ["hashcached", "hashmissing"] });
});

test("TorBox cached-only create preserves the provider envelope and makes no request for malformed inputs", async () => {
  const calls = [];
  await withBridge(
    {
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return upstream({ success: true, data: { torrent_id: "torrent-id" } });
      }
    },
    async (baseUrl) => {
      const created = await fetch(`${baseUrl}/api/debrid/torbox/torrent/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer credential-value" },
        body: JSON.stringify({ magnet: "magnet:?xt=urn:btih:hash" })
      });
      assert.deepEqual(await created.json(), { success: true, data: { torrent_id: "torrent-id" } });
      const missing = await fetch(`${baseUrl}/api/debrid/torbox/torrent/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer credential-value" },
        body: JSON.stringify({ magnet: "" })
      });
      assert.equal(missing.status, 400);
    }
  );
  assert.equal(calls[0].url, "https://api.torbox.app/v1/api/torrents/createtorrent");
  assert.equal(calls[0].options.body.get("add_only_if_cached"), "true");
  assert.equal(calls[0].options.body.get("allow_zip"), "false");
});

test("TorBox lookup and link resolution keep credentials out of same-origin URLs", async () => {
  const calls = [];
  await withBridge(
    {
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return url.includes("mylist")
          ? upstream({ success: true, data: { files: [{ id: 7, name: "video.mkv", size: 42 }] } })
          : upstream({ success: true, data: "https://provider.example/file" });
      }
    },
    async (baseUrl) => {
      const headers = { "Content-Type": "application/json", Authorization: "Bearer credential-value" };
      const lookup = await fetch(`${baseUrl}/api/debrid/torbox/torrent/lookup`, {
        method: "POST",
        headers,
        body: JSON.stringify({ torrentId: "torrent-id" })
      });
      assert.deepEqual(await lookup.json(), {
        success: true,
        data: { files: [{ id: 7, name: "video.mkv", size: 42 }] }
      });
      const link = await fetch(`${baseUrl}/api/debrid/torbox/link/resolve`, {
        method: "POST",
        headers,
        body: JSON.stringify({ torrentId: "torrent-id", fileId: 7 })
      });
      assert.deepEqual(await link.json(), { success: true, data: "https://provider.example/file" });
    }
  );
  assert.match(calls[0].url, /^https:\/\/api\.torbox\.app\/v1\/api\/torrents\/mylist\?/);
  assert.equal(calls[0].url.includes("credential-value"), false);
  assert.match(calls[1].url, /token=credential-value/);
  assert.match(calls[1].url, /torrent_id=torrent-id/);
});

test("TorBox playback bridge sanitizes uncached, missing, and malformed provider responses", async () => {
  let call = 0;
  await withBridge(
    {
      fetchImpl: async () => {
        call += 1;
        if (call === 1) return upstream({ success: false, detail: "uncached" }, 409);
        if (call === 2) return upstream({ success: false, detail: "missing" }, 404);
        return upstream({ success: false, detail: "malformed" }, 500);
      }
    },
    async (baseUrl) => {
      const headers = { "Content-Type": "application/json", Authorization: "Bearer credential-value" };
      const create = await fetch(`${baseUrl}/api/debrid/torbox/torrent/create`, {
        method: "POST", headers, body: JSON.stringify({ magnet: "magnet:?xt=urn:btih:hash" })
      });
      assert.deepEqual(await create.json(), { ok: false, error: "provider_request_failed", status: 409 });
      const lookup = await fetch(`${baseUrl}/api/debrid/torbox/torrent/lookup`, {
        method: "POST", headers, body: JSON.stringify({ torrentId: "torrent-id" })
      });
      assert.deepEqual(await lookup.json(), { ok: false, error: "provider_request_failed", status: 404 });
      const link = await fetch(`${baseUrl}/api/debrid/torbox/link/resolve`, {
        method: "POST", headers, body: JSON.stringify({ torrentId: "torrent-id" })
      });
      assert.deepEqual(await link.json(), { ok: false, error: "provider_request_failed", status: 500 });
    }
  );
});
