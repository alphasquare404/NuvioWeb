import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldAllowPlaybackDuringStartupAudioGate,
  canReleasePlayingStartupAudioGate
} from "./startupAudioGatePolicy.js";
test("client remux can run muted during startup rather than waiting paused for canplay", () => {
  assert.equal(
    shouldAllowPlaybackDuringStartupAudioGate({
      isHlsPlayback: false,
      isClientRemuxPlayback: true
    }),
    true
  );
  assert.equal(shouldAllowPlaybackDuringStartupAudioGate({ isHlsPlayback: true }), true);
  assert.equal(shouldAllowPlaybackDuringStartupAudioGate({ isHlsPlayback: false }), false);
  assert.equal(shouldAllowPlaybackDuringStartupAudioGate(), false);
});
test("startup sound gate still waits for an actual presented frame", () => {
  assert.equal(canReleasePlayingStartupAudioGate({ allowPlayback: true, readyState: 2 }), false);
  assert.equal(
    canReleasePlayingStartupAudioGate({
      allowPlayback: true,
      readyState: 3,
      hasPresentedPlaybackFrame: false
    }),
    false
  );
  assert.equal(
    canReleasePlayingStartupAudioGate({
      allowPlayback: true,
      readyState: 3,
      hasPresentedPlaybackFrame: true
    }),
    true
  );
});
