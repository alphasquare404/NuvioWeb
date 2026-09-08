import test from "node:test";
import assert from "node:assert/strict";
import { resolveBrowserStreamCardClickAction } from "./browserStreamCardClick.js";

function targetFor({ offline = null, source = null } = {}) {
  return {
    closest(selector) {
      if (selector === "button[data-offline-action]") return offline;
      return source;
    }
  };
}

test("nested download icon click routes once to Download Options instead of playback", () => {
  const download = { dataset: { offlineAction: "download", streamId: "movie-stream" } };
  const card = { dataset: { action: "playStream" } };
  assert.deepEqual(
    resolveBrowserStreamCardClickAction(targetFor({ offline: download, source: card }), (node) => node === download || node === card),
    { kind: "offline", action: "download", streamId: "movie-stream" }
  );
});

test("card body routes to normal playback when no offline action is targeted", () => {
  const card = { dataset: { action: "playStream" } };
  assert.deepEqual(
    resolveBrowserStreamCardClickAction(targetFor({ source: card }), (node) => node === card),
    { kind: "source", element: card }
  );
});

test("download routing is independent of external player preference and media kind", () => {
  for (const player of ["disabled", "infuse", "vlc"]) {
    for (const streamId of ["movie-stream", "episode-stream"]) {
      const download = { dataset: { offlineAction: "download", streamId } };
      const route = resolveBrowserStreamCardClickAction(targetFor({ offline: download }), (node) => node === download);
      assert.equal(route?.kind, "offline", `${player} must not change download routing`);
      assert.equal(route?.action, "download");
      assert.equal(route?.streamId, streamId);
    }
  }
});

test("a download action outside the stream container is ignored", () => {
  const download = { dataset: { offlineAction: "download", streamId: "movie-stream" } };
  assert.equal(resolveBrowserStreamCardClickAction(targetFor({ offline: download }), () => false), null);
});
