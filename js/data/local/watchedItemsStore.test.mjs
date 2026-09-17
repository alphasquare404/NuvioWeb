import assert from "node:assert/strict";
import test from "node:test";

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) || null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
  clear: () => values.clear()
};

const { WatchedItemsStore } = await import("./watchedItemsStore.js");

function collectNotifications() {
  const notifications = [];
  const unsubscribe = WatchedItemsStore.subscribe((payload) => notifications.push(payload));
  return { notifications, unsubscribe };
}

test("upsert() defaults authoritative to false", async () => {
  values.clear();
  const { notifications, unsubscribe } = collectNotifications();
  try {
    WatchedItemsStore.upsert({ contentId: "movie:ordinary", contentType: "movie" }, "1");
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
    WatchedItemsStore.upsert({ contentId: "movie:external", contentType: "movie" }, "1", {
      authoritative: true
    });
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].reason, "upsert");
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
    WatchedItemsStore.replaceForProfile("1", [{ contentId: "movie:bulk", contentType: "movie" }]);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].reason, "replaceForProfile");
  } finally {
    unsubscribe();
    values.clear();
  }
});
