import assert from "node:assert/strict";
import test from "node:test";

import { DebridApi } from "./debridApi.js";

test("browser DebridApi requests use fetch directly without a native platform proxy", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ id: "torrent-1" }), { status: 200 });
  };

  try {
    const result = await DebridApi.torboxGetTorrent("browser-key", "torrent-1");

    assert.equal(result.ok, true);
    assert.equal(result.data.id, "torrent-1");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://api.torbox.app/v1/api/torrents/mylist?id=torrent-1&bypass_cache=true");
    assert.equal(requests[0].options.headers.Authorization, "Bearer browser-key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
