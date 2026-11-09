import assert from "node:assert/strict";
import test from "node:test";

import { createDebridApiBridgeServer } from "./bridge.mjs";
import { requestPublicAddonHeaders } from "./publicAddonRedirect.mjs";
import { EventEmitter } from "node:events";

async function withBridge(options, run) {
  const server = createDebridApiBridgeServer(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
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
      const failedStart = await fetch(`${baseUrl}/api/debrid/torbox/device/start`, {
        method: "POST"
      });
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
          ? upstream(
              { success: false, error: "expired_device_code", detail: "Device code expired" },
              400
            )
          : upstream(
              { success: false, error: "invalid_request", detail: "Malformed request" },
              400
            );
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
        return upstream({
          success: true,
          data: { access_token: "provider-token", other: "hidden" }
        });
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
        if (fetchCalls === 1)
          return new Response(null, {
            status: 302,
            headers: { Location: "https://example.invalid" }
          });
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
          return upstream({
            device_code: "device",
            user_code: "CODE",
            verification_uri: "https://premiumize.me/device"
          });
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
      const headers = {
        "Content-Type": "application/json",
        Authorization: "Bearer credential-value"
      };
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

test("host URL assistance is disabled by default and makes no provider request", async () => {
  await withBridge(
    { addonResolveEnabled: false, fetchImpl: () => assert.fail("must not contact provider") },
    async (baseUrl) => {
      assert.equal(
        (await fetch(`${baseUrl}/api/debrid/torbox/link/from-addon`, { method: "POST" })).status,
        404
      );
    }
  );
});

test("addon URL resolution reads two trusted redirect headers, never the media CDN", async () => {
  const calls = [];
  await withBridge(
    {
      addonResolveEnabled: true,
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        if (url.startsWith("https://torrentio.strem.fun/"))
          return new Response(null, {
            status: 302,
            headers: {
              Location:
                "https://api.torbox.app/v1/api/torrents/requestdl?token=credential-value&torrent_id=12&file_id=7&redirect=true"
            }
          });
        assert.equal(new URL(url).host, "api.torbox.app");
        assert.equal(new URL(url).searchParams.get("redirect"), "true");
        return new Response(null, {
          status: 307,
          headers: { Location: "https://cdn.test/signed" }
        });
      }
    },
    async (baseUrl) => {
      const reply = await fetch(`${baseUrl}/api/debrid/torbox/link/from-addon`, {
        method: "POST",
        headers: { Authorization: "Bearer credential-value", "Content-Type": "application/json" },
        body: JSON.stringify({
          infoHash: "a".repeat(40),
          fileIdx: 0,
          entry: "video.mp4",
          filename: "video.mp4",
          url: "https://evil.test/ignored"
        })
      });
      assert.equal(reply.status, 200);
      assert.equal(reply.headers.get("cache-control"), "no-store");
      const text = await reply.text();
      assert.equal(text.includes("credential-value"), false);
      assert.equal(JSON.parse(text).data, "https://cdn.test/signed");
    }
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.redirect, "manual");
  assert.equal(calls[1].options.redirect, "manual");
});

test("addon resolution refuses a full media response at the provider without reading its body", async () => {
  let calls = 0,
    cancelled = 0;
  await withBridge(
    {
      addonResolveEnabled: true,
      fetchImpl: async () => {
        if (++calls === 1)
          return new Response(null, {
            status: 302,
            headers: {
              Location:
                "https://api.torbox.app/v1/api/torrents/requestdl?token=credential-value&torrent_id=12&file_id=7&redirect=true"
            }
          });
        return {
          status: 200,
          headers: new Headers(),
          body: {
            cancel: async () => {
              cancelled++;
            },
            getReader: () => assert.fail("must not read video on the host")
          }
        };
      }
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/debrid/torbox/link/from-addon`, {
        method: "POST",
        headers: { Authorization: "Bearer credential-value", "Content-Type": "application/json" },
        body: JSON.stringify({
          infoHash: "a".repeat(40),
          fileIdx: 0,
          entry: "video.mp4",
          filename: "video.mp4"
        })
      });
      assert.equal(response.status, 502);
    }
  );
  assert.equal(calls, 2);
  assert.equal(cancelled, 1);
});

test("addon resolution rejects untrusted redirects, account mismatches and invalid descriptors", async () => {
  for (const location of [
    "https://evil.test/file",
    "https://api.torbox.app/v1/api/torrents/requestdl?token=wrong&torrent_id=12&file_id=7",
    "https://api.torbox.app/v1/api/user/me?token=credential-value"
  ]) {
    let calls = 0;
    await withBridge(
      {
        addonResolveEnabled: true,
        fetchImpl: async () => {
          calls++;
          return new Response(null, { status: 302, headers: { Location: location } });
        }
      },
      async (baseUrl) => {
        const options = {
          method: "POST",
          headers: { Authorization: "Bearer credential-value", "Content-Type": "application/json" },
          body: JSON.stringify({
            infoHash: "a".repeat(40),
            fileIdx: 0,
            entry: "video.mp4",
            filename: "video.mp4"
          })
        };
        assert.equal(
          (await fetch(`${baseUrl}/api/debrid/torbox/link/from-addon`, options)).status,
          502
        );
        assert.equal(calls, 1);
        assert.equal(
          (
            await fetch(`${baseUrl}/api/debrid/torbox/link/from-addon`, {
              ...options,
              body: JSON.stringify({ url: "https://evil.test/" })
            })
          ).status,
          502
        );
        assert.equal(calls, 1);
      }
    );
  }
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
      const headers = {
        "Content-Type": "application/json",
        Authorization: "Bearer credential-value"
      };
      const create = await fetch(`${baseUrl}/api/debrid/torbox/torrent/create`, {
        method: "POST",
        headers,
        body: JSON.stringify({ magnet: "magnet:?xt=urn:btih:hash" })
      });
      assert.deepEqual(await create.json(), {
        ok: false,
        error: "provider_request_failed",
        status: 409
      });
      const lookup = await fetch(`${baseUrl}/api/debrid/torbox/torrent/lookup`, {
        method: "POST",
        headers,
        body: JSON.stringify({ torrentId: "torrent-id" })
      });
      assert.deepEqual(await lookup.json(), {
        ok: false,
        error: "provider_request_failed",
        status: 404
      });
      const link = await fetch(`${baseUrl}/api/debrid/torbox/link/resolve`, {
        method: "POST",
        headers,
        body: JSON.stringify({ torrentId: "torrent-id" })
      });
      assert.deepEqual(await link.json(), {
        ok: false,
        error: "provider_request_failed",
        status: 500
      });
    }
  );
});

test("host resolution failures identify the failing hop without exposing credentials", async () => {
  await withBridge(
    {
      addonResolveEnabled: true,
      fetchImpl: async (url) => {
        if (new URL(url).host === "torrentio.strem.fun")
          return new Response(null, {
            status: 302,
            headers: {
              Location:
                "https://api.torbox.app/v1/api/torrents/requestdl?token=credential-value&torrent_id=12&file_id=7&redirect=true"
            }
          });
        return new Response("private provider error", { status: 429 });
      }
    },
    async (baseUrl) => {
      const r = await fetch(`${baseUrl}/api/debrid/torbox/link/from-addon`, {
        method: "POST",
        headers: { Authorization: "Bearer credential-value", "Content-Type": "application/json" },
        body: JSON.stringify({
          infoHash: "a".repeat(40),
          fileIdx: 0,
          entry: "video.mp4",
          filename: "video.mp4"
        })
      });
      const text = await r.text();
      assert.equal(r.status, 502);
      assert.deepEqual(JSON.parse(text), {
        ok: false,
        error: "addon_resolve_failed",
        resolveStage: "provider",
        upstreamStatus: 429,
        resolveReason: "missing-redirect"
      });
      assert.equal(text.includes("credential-value"), false);
      assert.equal(text.includes("private provider"), false);
    }
  );
});

const publicV4 = { address: "1.1.1.1", family: 4 };
const publicV6 = { address: "2606:4700::1111", family: 6 };

test("host assistance resolves multiple public addon hosts and checks each redirect destination", async () => {
  const dns = [];
  const calls = [];
  await withBridge(
    {
      addonResolveEnabled: true,
      addonLookup: async (host, options) => {
        assert.equal(options.all, true);
        dns.push(host);
        return [publicV4, publicV6];
      },
      publicAddonRequest: async (url, addresses) => {
        calls.push(url.href);
        assert.deepEqual(addresses, [publicV4, publicV6]);
        if (url.hostname === "aio.example")
          return { status: 307, location: "https://other.example/file" };
        if (url.hostname === "other.example")
          return { status: 302, location: "https://cdn.example/video" };
        return { status: 206, type: "application/octet-stream" };
      }
    },
    async (base) => {
      const response = await fetch(base + "/api/debrid/link/from-addon", {
        method: "POST",
        body: JSON.stringify({ url: "https://aio.example/play/one" })
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal((await response.json()).data, "https://cdn.example/video");
      assert.deepEqual(dns, ["aio.example", "other.example", "cdn.example"]);
      assert.deepEqual(calls, [
        "https://aio.example/play/one",
        "https://other.example/file",
        "https://cdn.example/video"
      ]);
    }
  );
});

test("the host resolver blocks local DNS, mixed public/private answers, and private redirect targets", async () => {
  const calls = [];
  await withBridge(
    {
      addonResolveEnabled: true,
      addonLookup: async (host) => {
        if (host === "mixed.example") return [publicV4, { address: "::ffff:127.0.0.1", family: 6 }];
        if (host === "lan.example") return [{ address: "192.168.2.1", family: 4 }];
        if (host === "shared.example") return [{ address: "100.100.100.100", family: 4 }];
        if (host === "metadata.example") return [{ address: "169.254.169.254", family: 4 }];
        return [publicV6];
      },
      publicAddonRequest: async (url) => {
        calls.push(url.hostname);
        return { status: 302, location: "https://lan.example/private" };
      }
    },
    async (base) => {
      for (const host of [
        "mixed.example",
        "lan.example",
        "shared.example",
        "metadata.example",
        "127.0.0.1",
        "0x7f000001",
        "[::1]",
        "public.example"
      ]) {
        const response = await fetch(base + "/api/debrid/link/from-addon", {
          method: "POST",
          body: JSON.stringify({ url: "https://" + host + "/play" })
        });
        assert.equal(response.status, 403);
      }
      assert.deepEqual(calls, ["public.example"]);
    }
  );
});

test("disabled generic host assistance never reaches DNS or HTTP", async () => {
  await withBridge(
    {
      addonResolveEnabled: false,
      addonLookup: () => assert.fail("unexpected DNS"),
      publicAddonRequest: () => assert.fail("unexpected request")
    },
    async (base) => {
      const response = await fetch(base + "/api/debrid/link/from-addon", {
        method: "POST",
        body: JSON.stringify({ url: "https://addon.example/play/one" })
      });
      assert.equal(response.status, 404);
    }
  );
});

test("the HTTPS socket lookup returns only checked addresses and response data is discarded", async () => {
  const url = new URL("https://addon.example/play");
  const signal = new AbortController().signal;
  let destroyed = false;
  const info = await requestPublicAddonHeaders(
    url,
    [publicV4, publicV6],
    signal,
    (target, options, onResponse) => {
      assert.equal(target.hostname, "addon.example");
      assert.equal(options.agent, false);
      assert.equal(options.signal, signal);
      assert.equal(options.headers.Range, "bytes=0-0");
      options.lookup(target.hostname, { all: true }, (error, result) => {
        assert.ifError(error);
        assert.deepEqual(result, [publicV4, publicV6]);
      });
      options.lookup(target.hostname, { family: 6 }, (error, address, family) => {
        assert.ifError(error);
        assert.equal(address, publicV6.address);
        assert.equal(family, 6);
      });
      const req = new EventEmitter();
      req.end = () =>
        onResponse({
          statusCode: 206,
          headers: { "content-type": "application/octet-stream" },
          destroy: () => {
            destroyed = true;
          }
        });
      return req;
    }
  );
  assert.equal(info.status, 206);
  assert.equal(destroyed, true);
});
