import test from "node:test";
import assert from "node:assert/strict";
import {
  OFFLINE_PLAYBACK_TARGETS,
  canHandOffOfflineDownload,
  describeOfflineHandoffStorage,
  normalizeOfflinePlaybackTarget,
  readStorageHeadroom,
  resolveOfflinePlaybackTarget
} from "./offlineHandoffPolicy.js";

const COMPLETED = { status: "completed", fileName: "offline-movie-x.media" };

test("an unknown or missing setting falls back to asking rather than guessing", () => {
  assert.equal(normalizeOfflinePlaybackTarget(""), "ask");
  assert.equal(normalizeOfflinePlaybackTarget(null), "ask");
  assert.equal(normalizeOfflinePlaybackTarget("share"), "ask");
});

test("a stored setting is honoured, whatever its casing", () => {
  assert.equal(normalizeOfflinePlaybackTarget("EXTERNAL"), "external");
  assert.equal(normalizeOfflinePlaybackTarget(" internal "), "internal");
});

// A half-downloaded file handed to a player is a broken file that still takes
// the space of a whole one.
test("an unfinished download can never be handed off", () => {
  assert.equal(canHandOffOfflineDownload({ status: "downloading", fileName: "x" }), false);
  assert.equal(canHandOffOfflineDownload({ status: "paused", fileName: "x" }), false);
  assert.equal(canHandOffOfflineDownload({ status: "failed", fileName: "x" }), false);
  assert.equal(canHandOffOfflineDownload(null), false);
});

test("a completed download with a file can be handed off", () => {
  assert.equal(canHandOffOfflineDownload(COMPLETED), true);
});

test("a completed record whose file is gone cannot be handed off", () => {
  assert.equal(canHandOffOfflineDownload({ status: "completed", fileName: "" }), false);
});

test("the stored preference decides when a handoff is possible", () => {
  assert.equal(
    resolveOfflinePlaybackTarget({ setting: "external", download: COMPLETED }),
    OFFLINE_PLAYBACK_TARGETS.EXTERNAL
  );
  assert.equal(
    resolveOfflinePlaybackTarget({ setting: "ask", download: COMPLETED }),
    OFFLINE_PLAYBACK_TARGETS.ASK
  );
});

// Offering a choice that cannot be carried out is worse than not offering one,
// so both the unfinished file and the platform without the route fall through
// to the player that definitely works.
test("an impossible handoff resolves to the internal player without asking", () => {
  assert.equal(
    resolveOfflinePlaybackTarget({ setting: "external", download: { status: "downloading" } }),
    OFFLINE_PLAYBACK_TARGETS.INTERNAL
  );
  assert.equal(
    resolveOfflinePlaybackTarget({ setting: "ask", download: COMPLETED, supportsHandoff: false }),
    OFFLINE_PLAYBACK_TARGETS.INTERNAL
  );
});

test("the storage note names the size the player will take", () => {
  const described = describeOfflineHandoffStorage({
    sizeBytes: 451_600_000,
    freeBytes: 33_000_000_000
  });
  assert.equal(described.sizeLabel, "452 MB");
  assert.equal(described.tight, false);
  assert.match(described.message, /452 MB/);
  assert.match(described.message, /33\.0 GB free/);
});

test("a device short on room says so instead of reporting free space cheerfully", () => {
  const described = describeOfflineHandoffStorage({
    sizeBytes: 451_600_000,
    freeBytes: 460_000_000
  });
  assert.equal(described.tight, true);
  assert.match(described.message, /may fail part-way/);
});

test("an unknown free figure still produces a usable note", () => {
  const described = describeOfflineHandoffStorage({ sizeBytes: 8_000_000, freeBytes: null });
  assert.equal(described.freeLabel, "");
  assert.equal(described.tight, false);
  assert.equal(described.message, "The player keeps its own copy of this 8 MB file.");
});

test("headroom comes from the estimate, and a browser that gives none reports none", () => {
  assert.equal(readStorageHeadroom({ quota: 1000, usage: 400 }), 600);
  assert.equal(readStorageHeadroom({ quota: 400, usage: 1000 }), 0);
  assert.equal(readStorageHeadroom({}), null);
  assert.equal(readStorageHeadroom(null), null);
});
