import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CONCURRENT_DOWNLOADS,
  orderQueuedBrowserOfflineDownloads
} from "./browserOfflineDownloadQueueState.js";

test("offline queue keeps one transfer slot and uses persisted FIFO sequence", () => {
  assert.equal(MAX_CONCURRENT_DOWNLOADS, 1);
  const ordered = orderQueuedBrowserOfflineDownloads([
    { downloadId: "third", status: "queued", queueSequence: 30, queuedAt: 30 },
    { downloadId: "active", status: "downloading", queueSequence: 1, queuedAt: 1 },
    { downloadId: "first", status: "queued", queueSequence: 10, queuedAt: 10 },
    { downloadId: "second", status: "queued", queueSequence: 20, queuedAt: 20 },
    { downloadId: "paused", status: "paused", queueSequence: null, queuedAt: null }
  ]);
  assert.deepEqual(
    ordered.map((download) => download.downloadId),
    ["first", "second", "third"]
  );
});

test("offline queue uses queued time and id as stable fallback ordering", () => {
  const ordered = orderQueuedBrowserOfflineDownloads([
    { downloadId: "later", status: "queued", queuedAt: 20 },
    { downloadId: "alpha", status: "queued", queuedAt: 10 },
    { downloadId: "beta", status: "queued", queuedAt: 10 }
  ]);
  assert.deepEqual(
    ordered.map((download) => download.downloadId),
    ["alpha", "beta", "later"]
  );
});
