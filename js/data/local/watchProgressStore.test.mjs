import assert from "node:assert/strict";
import test from "node:test";

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) || null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
  clear: () => values.clear()
};

const { WatchProgressStore } = await import("./watchProgressStore.js");

function collectNotifications() {
  const notifications = [];
  const unsubscribe = WatchProgressStore.subscribe((payload) => notifications.push(payload));
  return { notifications, unsubscribe };
}

test("upsert() defaults authoritative to false", async () => {
  values.clear();
  const { notifications, unsubscribe } = collectNotifications();
  try {
    WatchProgressStore.upsert(
      { contentId: "movie:ordinary", contentType: "movie", positionMs: 1000, durationMs: 10000 },
      "1"
    );
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].reason, "upsert");
    assert.equal(notifications[0].authoritative, false);
  } finally {
    unsubscribe();
    values.clear();
  }
});

test("upsert() forwards authoritative: true when passed", async () => {
  values.clear();
  const { notifications, unsubscribe } = collectNotifications();
  try {
    WatchProgressStore.upsert(
      { contentId: "movie:external", contentType: "movie", positionMs: 1000, durationMs: 10000 },
      "1",
      { authoritative: true }
    );
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].reason, "upsert");
    assert.equal(notifications[0].authoritative, true);
    assert.equal(notifications[0].item.contentId, "movie:external");
    assert.equal(notifications[0].item.positionMs, 1000);
  } finally {
    unsubscribe();
    values.clear();
  }
});

test("remove() forwards the authoritative flag the same way", async () => {
  values.clear();
  WatchProgressStore.upsert(
    { contentId: "movie:to-remove", contentType: "movie", positionMs: 1000, durationMs: 10000 },
    "1"
  );
  const { notifications, unsubscribe } = collectNotifications();
  try {
    WatchProgressStore.remove("movie:to-remove", null, "1", { authoritative: true });
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].reason, "remove");
    assert.equal(notifications[0].authoritative, true);
  } finally {
    unsubscribe();
    values.clear();
  }
});

test("replaceForProfile() always notifies with reason replaceForProfile", async () => {
  values.clear();
  const { notifications, unsubscribe } = collectNotifications();
  try {
    WatchProgressStore.replaceForProfile("1", [
      { contentId: "movie:bulk", contentType: "movie", positionMs: 1000, durationMs: 10000 }
    ]);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].reason, "replaceForProfile");
  } finally {
    unsubscribe();
    values.clear();
  }
});

test("removal notifies the exact removed card identities for immediate CW updates", () => {
  values.clear();
  WatchProgressStore.upsert(
    {
      contentId: "series",
      videoId: "e1",
      season: 1,
      episode: 1,
      positionMs: 1000,
      durationMs: 10000
    },
    "1"
  );
  WatchProgressStore.upsert(
    {
      contentId: "series",
      videoId: "e2",
      season: 1,
      episode: 2,
      positionMs: 1000,
      durationMs: 10000
    },
    "1"
  );
  const { notifications, unsubscribe } = collectNotifications();
  try {
    WatchProgressStore.remove("series", "e1", "1", { authoritative: true });
    assert.deepEqual(
      notifications[0].removedItems.map((item) => item.videoId),
      ["e1"]
    );
    assert.equal(WatchProgressStore.listForProfile("1").length, 1);
  } finally {
    unsubscribe();
    values.clear();
  }
});

test("one movie keeps one row however its video id is named", () => {
  values.clear();
  WatchProgressStore.upsert(
    {
      contentId: "movie:same",
      contentType: "movie",
      videoId: "source-a",
      positionMs: 1000,
      durationMs: 10000
    },
    "1"
  );
  WatchProgressStore.upsert(
    {
      contentId: "movie:same",
      contentType: "movie",
      videoId: "source-b",
      positionMs: 5000,
      durationMs: 10000
    },
    "1"
  );
  const items = WatchProgressStore.listForProfile("1");
  assert.equal(items.length, 1);
  assert.equal(items[0].positionMs, 5000);
  values.clear();
});

test("episodes of one series stay separate rows", () => {
  values.clear();
  WatchProgressStore.upsert(
    {
      contentId: "series:one",
      contentType: "series",
      season: 1,
      episode: 1,
      positionMs: 1000,
      durationMs: 10000
    },
    "1"
  );
  WatchProgressStore.upsert(
    {
      contentId: "series:one",
      contentType: "series",
      season: 1,
      episode: 2,
      positionMs: 2000,
      durationMs: 10000
    },
    "1"
  );
  assert.equal(WatchProgressStore.listForProfile("1").length, 2);
  values.clear();
});

test("an episode row outdates a movie row of the same content id", () => {
  values.clear();
  WatchProgressStore.upsert(
    { contentId: "series:collision", contentType: "movie", positionMs: 1000, durationMs: 10000 },
    "1"
  );
  WatchProgressStore.upsert(
    {
      contentId: "series:collision",
      contentType: "series",
      season: 2,
      episode: 3,
      positionMs: 3000,
      durationMs: 10000
    },
    "1"
  );
  // The movie key is the bare content id; the episode key carries s/e, so both
  // identities stay addressable instead of overwriting one another.
  assert.equal(WatchProgressStore.listForProfile("1").length, 2);
  values.clear();
});
