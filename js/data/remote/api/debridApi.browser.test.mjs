import assert from "node:assert/strict";
import test from "node:test";

import { DebridApi } from "./debridApi.js";

test("uncovered browser DebridApi cloud operations remain direct until the cloud bridge phase", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ id: "torrent-1" }), { status: 200 });
  };

  try {
    const result = await DebridApi.torboxListCloudItems("browser-key", "v1/api/torrents/mylist?id=torrent-1");

    assert.equal(result.ok, true);
    assert.equal(result.data.id, "torrent-1");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://api.torbox.app/v1/api/torrents/mylist?id=torrent-1");
    assert.equal(requests[0].options.headers.Authorization, "Bearer browser-key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("browser device authorization and account validation use fixed same-origin debrid bridge routes", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (String(url).endsWith("/device/start")) {
      return new Response(
        JSON.stringify({
          success: true,
          data: { device_code: "device", code: "CODE", verification_url: "https://tor.box/link" }
        }),
        { status: 200 }
      );
    }
    if (String(url).endsWith("/device/redeem")) {
      return new Response(JSON.stringify({ success: true, data: { access_token: "token" } }), {
        status: 200
      });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    const start = await DebridApi.startTorboxDeviceAuthorization();
    const redeem = await DebridApi.redeemTorboxDeviceAuthorization("device");
    const valid = await DebridApi.validateTorboxApiKey("provider-credential");

    assert.equal(start.data.data.device_code, "device");
    assert.equal(redeem.data.data.access_token, "token");
    assert.equal(valid, true);
    assert.deepEqual(
      requests.map((request) => request.url),
      [
        "/api/debrid/torbox/device/start",
        "/api/debrid/torbox/device/redeem",
        "/api/debrid/torbox/account"
      ]
    );
    assert.equal(requests[0].options.method, "POST");
    assert.equal(requests[1].options.body.includes("device"), true);
    assert.equal(requests[2].url.includes("provider-credential"), false);
    assert.equal(requests[2].options.headers.Authorization, "Bearer provider-credential");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Premiumize browser auth uses same-origin routes and keeps the public client ID out of URLs", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (String(url).endsWith("/device/start")) {
      return new Response(JSON.stringify({ device_code: "device", user_code: "CODE", verification_uri: "https://premiumize.me/device" }), { status: 200 });
    }
    if (String(url).endsWith("/device/redeem")) {
      return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    await DebridApi.startPremiumizeDeviceAuthorization("public-client-id");
    await DebridApi.redeemPremiumizeDeviceAuthorization("device", "public-client-id");
    assert.equal(await DebridApi.validatePremiumizeApiKey("provider-credential"), true);
    assert.deepEqual(
      requests.map((request) => request.url),
      [
        "/api/debrid/premiumize/device/start",
        "/api/debrid/premiumize/device/redeem",
        "/api/debrid/premiumize/account"
      ]
    );
    assert.equal(requests.every((request) => !String(request.url).includes("public-client-id")), true);
    assert.equal(requests[0].options.body.includes("public-client-id"), true);
    assert.equal(requests[2].options.headers.Authorization, "Bearer provider-credential");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("TorBox browser playback operations use fixed same-origin bridge routes", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (String(url).endsWith("/cache/check")) {
      return new Response(JSON.stringify({ success: true, data: { hash: {} } }), { status: 200 });
    }
    if (String(url).endsWith("/torrent/create")) {
      return new Response(JSON.stringify({ success: true, data: { torrent_id: "torrent-id" } }), { status: 200 });
    }
    if (String(url).endsWith("/torrent/lookup")) {
      return new Response(JSON.stringify({ success: true, data: { files: [] } }), { status: 200 });
    }
    return new Response(JSON.stringify({ success: true, data: "https://provider.example/file" }), { status: 200 });
  };

  try {
    await DebridApi.torboxCheckCached("provider-credential", ["hash"]);
    await DebridApi.torboxCreateTorrent("provider-credential", "magnet:?xt=urn:btih:hash");
    await DebridApi.torboxGetTorrent("provider-credential", "torrent-id");
    await DebridApi.torboxRequestDownloadLink("provider-credential", "torrent-id", 7);
    assert.deepEqual(
      requests.map((request) => request.url),
      [
        "/api/debrid/torbox/cache/check",
        "/api/debrid/torbox/torrent/create",
        "/api/debrid/torbox/torrent/lookup",
        "/api/debrid/torbox/link/resolve"
      ]
    );
    assert.equal(requests.every((request) => !String(request.url).includes("provider-credential")), true);
    assert.equal(requests.every((request) => request.options.headers.Authorization === "Bearer provider-credential"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
