import test from "node:test";
import assert from "node:assert/strict";
import { createRelayTextReader } from "./textTracks.mjs";

test("text sidecar reuses a bounded reader and preserves source cue timing across seeks", async () => {
  let opens = 0,
    readers = 0;
  const read = createRelayTextReader({
    maxReaders: 1,
    makeReader: () => {
      readers++;
      return {
        open: async () => {
          opens++;
          return [{ id: 3, language: "eng", supported: true }];
        },
        window: async (id, time) => ({
          from: time - 2,
          to: time + 25,
          cues: [{ id: "long", start: 10, end: 100, text: "retained cue" }],
          id
        })
      };
    }
  });
  const tracks = await read("https://source.test/a", new URLSearchParams({ text: "tracks" }));
  assert.equal(tracks.tracks[0].id, 3);
  for (const time of [90, 15]) {
    const { result } = await read(
      "https://source.test/a",
      new URLSearchParams({ text: "cues", track: "3", time: String(time) })
    );
    assert.equal(result.cues[0].start, 10);
    assert.equal(result.cues[0].end, 100);
  }
  assert.equal(opens, 1);
  await read("https://source.test/b", new URLSearchParams({ text: "tracks" }));
  await read("https://source.test/a", new URLSearchParams({ text: "tracks" }));
  assert.equal(readers, 3);
});

test("text sidecar rejects invalid requests and concurrent unbounded queues", async () => {
  let finish;
  const read = createRelayTextReader({
    maxReaders: 1,
    makeReader: () => ({
      open: () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    })
  });
  await assert.rejects(
    read("x", new URLSearchParams({ text: "cues", track: "3", time: "NaN" })),
    /request-invalid/
  );
  const pending = read("x", new URLSearchParams({ text: "tracks" }));
  await assert.rejects(read("x", new URLSearchParams({ text: "tracks" })), /reader-busy/);
  await assert.rejects(read("y", new URLSearchParams({ text: "tracks" })), /reader-busy/);
  finish([]);
  await pending;
});

test("failed partial subtitle readers are discarded before retry", async () => {
  let created = 0;
  const read = createRelayTextReader({
    makeReader: () => ({
      open: async () => {
        if (++created === 1) throw Error("partial-read");
        return [];
      }
    })
  });
  await assert.rejects(read("x", new URLSearchParams({ text: "tracks" })), /partial-read/);
  assert.deepEqual(await read("x", new URLSearchParams({ text: "tracks" })), { tracks: [] });
  assert.equal(created, 2);
});
