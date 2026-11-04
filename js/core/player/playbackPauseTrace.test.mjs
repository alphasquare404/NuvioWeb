import test from "node:test";
import assert from "node:assert/strict";
import { createPlaybackPauseTrace } from "./playbackPauseTrace.js";
function fixture() {
  let time = 1000,
    next = 0;
  const records = [],
    tasks = new Map(),
    handlers = new Map();
  const buffered = [];
  const video = {
    paused: false,
    muted: false,
    seeking: false,
    ended: false,
    currentTime: 42,
    duration: 1000,
    playbackRate: 1,
    readyState: 4,
    networkState: 2,
    buffered: {
      get length() {
        return buffered.length;
      },
      start: (i) => buffered[i][0],
      end: (i) => buffered[i][1]
    },
    seekable: { length: 0 },
    error: null,
    addEventListener: (name, handler) => handlers.set(name, handler),
    removeEventListener: (name) => handlers.delete(name),
    getVideoPlaybackQuality: () => ({ totalVideoFrames: 120 })
  };
  const context = {
    presented: true,
    engine: "client-remux",
    route: "remux",
    remuxMode: "client",
    offline: false,
    remux: {
      state: "backpressure",
      cacheEnabled: true,
      cacheBytes: 5000,
      cacheLimitBytes: 100000,
      cacheUnits: 3,
      cacheHits: 2,
      backpressureReason: "time"
    }
  };
  const trace = createPlaybackPauseTrace({
    now: () => time,
    write: (r) => records.push(r),
    schedule: (fn, delay) => {
      const id = ++next;
      tasks.set(id, { fn, delay });
      return id;
    },
    cancel: (id) => tasks.delete(id)
  });
  trace.attach(video, () => context);
  return {
    trace,
    video,
    context,
    records,
    tasks,
    handlers,
    buffered,
    setTime: (t) => (time = t),
    fire: (name) => handlers.get(name)?.()
  };
}
test("pause duration, cache and buffer loss remain visible through resume and error", () => {
  const h = fixture();
  h.buffered.push([30, 75]);
  h.trace.pauseRequest();
  h.video.paused = true;
  h.fire("pause");
  h.setTime(121000);
  h.buffered.length = 0;
  h.trace.resumeRequest();
  const resume = h.records.at(-1);
  assert.equal(resume.pauseDurationMs, 120000);
  assert.deepEqual(resume.buffered, []);
  assert.equal(resume.cacheBytes, 5000);
  assert.equal(resume.cacheEnabled, true);
  assert.deepEqual(
    [...h.tasks.values()].map((t) => t.delay),
    [1000, 5000, 15000, 30000, 60000]
  );
  h.video.paused = false;
  h.fire("play");
  h.fire("waiting");
  h.setTime(126000);
  h.video.error = { code: 3, message: "secret URL" };
  h.fire("error");
  assert.equal(h.records.at(-1).event, "error");
  assert.equal(h.records.at(-1).mediaErrorCode, 3);
  assert.equal(h.records.at(-1).sinceResumeMs, 5000);
  assert.equal(h.tasks.size, 0);
});
test("diagnostics whitelist fields and never serialize source URLs, headers, tracks or errors", () => {
  const h = fixture();
  const secret = "SECRET_PRIVATE_TOKEN";
  Object.assign(h.context, {
    url: secret,
    token: secret,
    engine: secret,
    route: secret,
    remuxMode: secret
  });
  Object.assign(h.context.remux, {
    state: secret,
    reason: secret,
    audioTracks: [{ url: secret }],
    cacheBytes: secret,
    cacheDisabledReason: secret
  });
  h.video.error = { code: 4, message: secret };
  h.trace.pauseRequest();
  h.trace.resumeRequest();
  h.trace.playRejected({ name: secret, message: secret, stack: secret });
  assert.doesNotMatch(
    JSON.stringify(h.records),
    /SECRET_PRIVATE_TOKEN|audioTracks|headers|stack|message|url|token/
  );
  assert.equal(h.records.at(-1).exception, "OtherError");
});
test("detaching or replacing playback cancels timers and stale checks cannot attach to another pause", () => {
  const h = fixture();
  h.trace.pauseRequest();
  h.trace.resumeRequest();
  const stale = [...h.tasks.values()][0].fn;
  h.trace.detach();
  assert.equal(h.handlers.size, 0);
  assert.equal(h.tasks.size, 0);
  const count = h.records.length;
  stale();
  assert.equal(h.records.length, count);
  h.trace.attach(h.video, () => h.context);
  h.trace.pauseRequest();
  const current = h.records.length;
  stale();
  assert.equal(h.records.length, current);
});
test("waiting storms are bounded while the final failure still gets recorded", () => {
  const h = fixture();
  h.trace.pauseRequest();
  h.trace.resumeRequest();
  for (let i = 0; i < 200; i++) h.fire("waiting");
  assert.equal(h.records.length, 40);
  h.fire("error");
  assert.equal(h.records.at(-1).event, "error");
  for (let i = 0; i < 200; i++) h.fire("error");
  assert.equal(h.records.length, 44);
});
test("startup pauses are ignored and the observer never starts, stops or seeks playback", () => {
  const h = fixture();
  h.context.presented = false;
  h.video.play = () => assert.fail("logging must not play video");
  h.video.pause = () => assert.fail("logging must not pause video");
  h.fire("pause");
  h.fire("play");
  assert.equal(h.records.length, 0);
  h.context.presented = true;
  h.fire("pause");
  h.fire("play");
  h.fire("playing");
  assert.equal(h.video.currentTime, 42);
  assert.equal(h.video.muted, false);
  assert.equal(h.video.playbackRate, 1);
});
