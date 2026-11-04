import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL("../../../core/player/selectedStreamDelivery.js", import.meta.url),
  "utf8"
);
const start = source.indexOf("  async isPlayableHlsPlaylist("),
  end = source.indexOf("  async resolvePlayerSource(", start);
const body = source.slice(start, end).trim().replace(/,$/, "");
test("remux preflight verifies the video child of a master without rejecting a playable alternate audio HLS", async () => {
  const calls = [];
  const ctx = vm.runInNewContext("({" + body + "})", {
    URL,
    console: { warn() {} },
    location: { href: "https://app.test/" },
    fetch: async (url, options) => {
      calls.push({ url, method: options?.method || "GET" });
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () =>
          url.includes("v0.m3u8")
            ? "#EXTM3U\n#EXTINF:4,\nseg0.m4s\n"
            : "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\njob/v0.m3u8?token=secret\n"
      };
    }
  });
  assert.equal(await ctx.isPlayableHlsPlaylist("/api/transcode/hls/index.m3u8?token=secret"), true);
  assert.equal(calls[1].url, "https://app.test/api/transcode/hls/job/v0.m3u8?token=secret");
});
