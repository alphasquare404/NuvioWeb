import assert from "node:assert/strict";
import test from "node:test";

import { summariseOfflineDownloads } from "./offlineDownloadSummary.js";

test("nothing in motion says nothing at all", () => {
  assert.equal(summariseOfflineDownloads([]), "");
  assert.equal(summariseOfflineDownloads(), "");
  assert.equal(summariseOfflineDownloads(null), "");
});

test("each kind is counted and read in the order it happens", () => {
  const line = summariseOfflineDownloads([
    { status: "completed" },
    { status: "downloading" },
    { status: "queued" },
    { status: "queued" }
  ]);
  assert.equal(line, "1 downloading · 2 queued · 1 offline");
});

test("a kind with nothing in it is left out rather than printed as zero", () => {
  assert.equal(summariseOfflineDownloads([{ status: "completed" }]), "1 offline");
});

// A failed or paused download is the card's business. The header is a count,
// and a count cannot say why something stopped, so it does not try.
test("stopped downloads are not counted as happening", () => {
  assert.equal(
    summariseOfflineDownloads([{ status: "failed" }, { status: "paused" }, { status: "idle" }]),
    ""
  );
  assert.equal(
    summariseOfflineDownloads([{ status: "failed" }, { status: "downloading" }]),
    "1 downloading"
  );
});

test("a record with no status at all is ignored rather than throwing", () => {
  assert.equal(
    summariseOfflineDownloads([{}, null, undefined, { status: "downloading" }]),
    "1 downloading"
  );
});
