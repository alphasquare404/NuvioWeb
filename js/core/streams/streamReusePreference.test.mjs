import assert from "node:assert/strict";
import test from "node:test";
import { StreamPreferencesStore as store } from "../../data/local/streamPreferencesStore.js";
import { ProfileManager } from "../profile/profileManager.js";
import { reusableStreamPreference } from "./streamReusePreference.js";
import { selectAutoPlayStream } from "./streamAutoPlaySelector.js";
import { resolveAutoPlayStream } from "./streamAutoResolve.js";

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value)
};
ProfileManager.getActiveProfileId = () => "1";
const settings = {
  streamAutoPlayMode: "FIRST_STREAM",
  streamAutoPlayTimeoutSeconds: 5,
  streamReuseLastLinkEnabled: true,
  streamReuseLastLinkCacheHours: 1
};
const first = { id: "first", name: "Early", url: "https://example.com/first", addonName: "Addon" };
const saved = {
  id: "played",
  name: "Played",
  url: "https://example.com/played",
  addonName: "Addon"
};

test("reuse requires confirmed playback and respects expiry, profile and episode", () => {
  values.clear();
  store.set("tt1", "tt1:1:1", "failed");
  assert.equal(reusableStreamPreference(settings, "tt1", "tt1:1:1"), null);
  store.set("tt1", "tt1:1:1", saved.id, { playbackConfirmed: true });
  assert.equal(reusableStreamPreference(settings, "tt1", "tt1:1:1").streamId, saved.id);
  assert.equal(store.getValid("tt1", "tt1:1:1", 3600000, "2"), null);
  assert.equal(reusableStreamPreference(settings, "tt1", "tt1:1:2"), null);
  assert.equal(
    reusableStreamPreference({ ...settings, streamReuseLastLinkEnabled: false }, "tt1", "tt1:1:1"),
    null
  );
  const clock = Date.now;
  try {
    const cachedAt = store.getEntry("tt1", "tt1:1:1").cachedAtMs;
    Date.now = () => cachedAt + 3600001;
    assert.equal(reusableStreamPreference(settings, "tt1", "tt1:1:1"), null);
  } finally {
    Date.now = clock;
  }
});

test("remembered source cannot bypass autoplay regex filters", () => {
  const selected = selectAutoPlayStream([first, saved], {
    mode: "REGEX_MATCH",
    regexPattern: "Early",
    reusableStream: { streamId: saved.id }
  });
  assert.equal(selected.id, first.id);
});

for (const includeSaved of [true, false]) {
  test(`autoplay waits for remembered addon, then ${includeSaved ? "reuses it" : "falls back when absent"}`, async () => {
    values.clear();
    store.set("tt1", "tt1", saved.id, { playbackConfirmed: true });
    const result = await resolveAutoPlayStream({
      itemId: "tt1",
      videoId: "tt1",
      itemType: "movie",
      settings,
      returnOnFirstMatch: true,
      repository: {
        async getStreamsFromAllAddons(type, id, options) {
          const data = [{ addonName: "Addon", streams: [first] }];
          options.onChunk({ status: "success", data });
          await Promise.resolve();
          if (includeSaved) {
            data[0].streams = [first, saved];
            options.onChunk({ status: "success", data });
          }
          return { status: "success", data };
        }
      }
    });
    assert.equal(result.selected.id, includeSaved ? saved.id : first.id);
  });
}
