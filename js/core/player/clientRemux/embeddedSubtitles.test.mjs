import assert from "node:assert/strict";
import { test } from "node:test";
import { createEmbeddedSubtitles } from "./embeddedSubtitles.mjs";

test("subtitle worker can resolve a source and keeps stale cues cleared after None", async () => {
  const messages = [];
  const cues = [];
  const worker = {
    postMessage: (message) => messages.push(message),
    terminate() {}
  };
  let resolve;
  const reader = createEmbeddedSubtitles({
    video: { paused: true },
    getTime: () => 20,
    onTracks() {},
    onStatus() {},
    onDecodedCues: (entries) => cues.push(entries),
    makeTransport: () => worker,
    resolveSource: (url, signal) => {
      assert.equal(url, "https://addon.example/resolve");
      assert.equal(signal.aborted, false);
      return new Promise((done) => {
        resolve = done;
      });
    }
  });
  try {
    reader.setSource("https://addon.example/resolve");
    const { sourceId, canResolveSource } = messages[0];
    assert.equal(canResolveSource, true);
    const result = worker.onmessage({
      data: {
        type: "resolve-source",
        url: "https://addon.example/resolve",
        sourceId,
        id: 1
      }
    });
    resolve("https://media.example/file.mkv");
    await result;
    assert.equal(messages.at(-1).value, "https://media.example/file.mkv");
    await worker.onmessage({
      data: {
        type: "tracks",
        sourceId,
        tracks: [{ id: 2, supported: true, language: "ind" }]
      }
    });
    assert.equal(reader.tracks()[0].language, "ind");
    assert.equal(reader.select(2), true);
    const { requestId } = messages.at(-1);
    assert.equal(reader.select(null), true);
    await worker.onmessage({
      data: {
        type: "window",
        sourceId,
        requestId,
        result: { cues: [{ start: 19, end: 21, text: "stale" }] }
      }
    });
    assert.deepEqual(cues.at(-1), []);
  } finally {
    reader.destroy();
  }
});
