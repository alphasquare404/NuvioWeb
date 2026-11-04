import test from "node:test";
import assert from "node:assert/strict";
import { createStartupPlayback, startupWindow } from "./startupPlayback.mjs";
function fixture({ target = 91.617, time = 0, rejected = false, duration = 200 } = {}) {
  class Video extends EventTarget {
    seeking = false;
    calls = [];
    time = time;
    duration = duration;
    get buffered() {
      return {
        length: buffered ? 1 : 0,
        start: () => Math.max(0, target - 4),
        end: () => target + seconds
      };
    }
    get currentTime() {
      return this.time;
    }
    set currentTime(value) {
      this.calls.push(["seek", value]);
      this.time = value;
      this.seeking = true;
    }
    play() {
      this.calls.push(["play", this.currentTime]);
      return rejected ? Promise.reject(Error("blocked")) : Promise.resolve();
    }
    settle() {
      this.seeking = false;
      this.dispatchEvent(new Event("seeked"));
    }
  }
  const video = new Video(),
    phases = [];
  let active = true,
    wantsPlay = true,
    buffered = false,
    seconds = 4.1,
    blocked = 0,
    internalSeek = null;
  const startup = createStartupPlayback({
    video,
    target,
    isActive: () => active,
    wantsPlay: () => wantsPlay,
    noteSeek: (time) => {
      internalSeek = time;
    },
    onPhase: (phase) => phases.push(phase),
    onBlocked: () => blocked++
  });
  return {
    video,
    startup,
    phases,
    buffer: (ahead = 4.1) => {
      buffered = true;
      seconds = ahead;
    },
    pause: () => {
      wantsPlay = false;
    },
    detach: () => {
      active = false;
    },
    get blocked() {
      return blocked;
    },
    get internalSeek() {
      return internalSeek;
    }
  };
}
test("startup cannot seek or play into a partial muxer unit even when its target is visible", () => {
  const f = fixture();
  f.buffer();
  f.startup.completeBoundary(false);
  assert.deepEqual(f.video.calls, []);
  assert.equal(f.startup.ready, false);
  f.startup.completeBoundary(true);
  assert.deepEqual(f.video.calls, [["seek", 91.617]]);
  assert.equal(f.internalSeek, 91.617);
  assert.equal(f.startup.ready, false);
  f.video.settle();
  assert.deepEqual(f.video.calls, [
    ["seek", 91.617],
    ["play", 91.617]
  ]);
  assert.equal(f.startup.ready, true);
  f.startup.completeBoundary(true);
  f.video.settle();
  assert.equal(f.video.calls.length, 2);
  f.startup.dispose();
});
test("a complete unit without the requested target must not consume startup", () => {
  const f = fixture();
  f.startup.completeBoundary(true);
  assert.deepEqual(f.video.calls, []);
  f.buffer();
  f.startup.completeBoundary(true);
  f.video.settle();
  assert.equal(f.startup.ready, true);
  f.startup.dispose();
});
test("play from zero begins after a complete unit without waiting for a nonexistent seek event", () => {
  const f = fixture({ target: 0 });
  f.buffer();
  f.startup.completeBoundary(true);
  assert.deepEqual(f.video.calls, [["play", 0]]);
  assert.equal(f.startup.ready, true);
  f.startup.dispose();
});
test("pause while an initial seek settles is preserved", () => {
  const f = fixture();
  f.buffer();
  f.startup.completeBoundary(true);
  f.pause();
  f.video.settle();
  assert.equal(f.startup.ready, true);
  assert.deepEqual(f.video.calls, [["seek", 91.617]]);
  f.startup.dispose();
});
test("detached and disposed renderers cannot start playback from late seek events", () => {
  for (const change of ["detach", "dispose"]) {
    const f = fixture();
    f.buffer();
    f.startup.completeBoundary(true);
    if (change === "detach") f.detach();
    else f.startup.dispose();
    f.video.settle();
    assert.deepEqual(f.video.calls, [["seek", 91.617]]);
    f.startup.dispose();
  }
});
test("autoplay rejection is reported without another seek, loop, or unhandled rejection", async () => {
  const f = fixture({ target: 0, rejected: true });
  f.buffer();
  f.startup.completeBoundary(true);
  await Promise.resolve();
  assert.equal(f.blocked, 1);
  assert.deepEqual(f.video.calls, [["play", 0]]);
  f.startup.dispose();
});

test("the physical iPhone's 0.35-second tail cannot start; a later complete window can", () => {
  const f = fixture();
  f.buffer(0.3506666667);
  f.startup.completeBoundary(true);
  assert.equal(f.startup.ready, false);
  assert.deepEqual(f.video.calls, []);
  assert.equal(f.phases.at(-1), "buffering-startup");
  f.buffer(4.3506666667);
  f.startup.completeBoundary(false);
  assert.deepEqual(f.video.calls, []);
  f.startup.completeBoundary(true);
  f.video.settle();
  assert.deepEqual(f.video.calls, [
    ["seek", 91.617],
    ["play", 91.617]
  ]);
  f.startup.dispose();
});
test("near the end of a film, startup requires only the remaining playable tail", () => {
  const f = fixture({ target: 199.8, duration: 200 });
  f.buffer(0.17);
  f.startup.completeBoundary(true);
  f.video.settle();
  assert.equal(f.startup.ready, true);
  f.startup.dispose();
});
test("future disjoint ranges do not satisfy startup coverage at the requested time", () => {
  const video = {
    duration: 200,
    buffered: { length: 2, start: (i) => (i ? 100 : 88), end: (i) => (i ? 120 : 91.968) }
  };
  const result = startupWindow(video, 91.617);
  assert(Math.abs(result.ahead - 0.351) < 0.001);
  assert.equal(result.required, 4);
});
