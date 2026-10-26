import assert from "node:assert/strict";
import test from "node:test";
import { storedProbeFacts, createProbeMetadataCache } from "./probeMetadataCache.js";

test("stored facts exclude credentials, URLs and device predictions", () => {
  const result = storedProbeFacts({
    container: "mp4",
    videoCodec: "hevc",
    videoTag: "hev1",
    hasAudio: true,
    audioStreams: [{ codec: "aac", channels: 6, url: "secret", apiKey: "secret" }],
    playbackCapabilities: { video: false },
    url: "secret",
    apiKey: "secret"
  });
  assert.equal(result.videoTag, "hev1");
  assert.equal(result.audioStreams[0].channels, 6);
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal("playbackCapabilities" in result, false);
  assert.equal(storedProbeFacts({ container: "unknown", videoCodec: "unknown" }), null);
});

test("missing or blocked IndexedDB is optional", async () => {
  for (const indexedDB of [
    null,
    {
      open() {
        throw Error("blocked");
      }
    }
  ]) {
    const cache = createProbeMetadataCache({ indexedDB });
    assert.equal(await cache.get("torrent-file:" + "a".repeat(40) + ":0"), null);
    await cache.set("torrent-file:" + "a".repeat(40) + ":0", {
      container: "mp4",
      videoCodec: "h264"
    });
    await cache.clear();
  }
});
