import assert from "node:assert/strict";
import test from "node:test";
import { PlayerController } from "./playerController.js";

const context = { itemId: "series:1", itemType: "series", videoId: "episode:3", season: 1, episode: 3 };

test("an external return owns the active session until the user resumes built-in playback", () => {
  const controller = {
    externalProgressHandoff: { key: PlayerController.buildProgressSnapshotKey(context), authoritativePositionMs: 720_000, completed: false },
    buildProgressSnapshotKey: PlayerController.buildProgressSnapshotKey
  };
  assert.equal(PlayerController.shouldSuppressStaleInternalProgress.call(controller, context, 301_000), true);
  assert.equal(PlayerController.shouldSuppressStaleInternalProgress.call(controller, context, 740_000), false);
  PlayerController.releaseExternalPlaybackOwnership.call(controller);
  assert.equal(PlayerController.shouldSuppressStaleInternalProgress.call(controller, context, 510_000), false);
});

test("an external explicit completion prevents a late internal flush from resurrecting progress", () => {
  const controller = {
    externalProgressHandoff: { key: PlayerController.buildProgressSnapshotKey(context), authoritativePositionMs: 1_411_200, completed: true },
    buildProgressSnapshotKey: PlayerController.buildProgressSnapshotKey
  };
  assert.equal(PlayerController.shouldSuppressStaleInternalProgress.call(controller, context, 301_000), true);
  PlayerController.releaseExternalPlaybackOwnership.call(controller);
  assert.equal(PlayerController.shouldSuppressStaleInternalProgress.call(controller, context, 30_000), false);
});
