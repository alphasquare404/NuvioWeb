import test from "node:test";
import assert from "node:assert/strict";
import { createPlaybackLoadingTrace } from "./playbackLoadingTrace.js";
test("loading logs track real stages and elapsed waits without recording private input", () => {
  const records = [];
  let time = 1000,
    tick,
    cancelled = false;
  const trace = createPlaybackLoadingTrace({
    now: () => time,
    write: (r) => records.push(r),
    schedule: (fn) => {
      tick = fn;
      return 1;
    },
    cancel: () => {
      cancelled = true;
    }
  });
  trace.begin("checking");
  trace.sample({
    paused: true,
    readyState: 0,
    engine: "client-remux",
    url: "secret",
    token: "secret",
    filename: "secret",
    error: "secret"
  });
  time += 5000;
  tick();
  trace.stage("metadata");
  time += 2000;
  trace.finish("error");
  assert.equal(records[1].stage, "checking");
  assert.equal(records[1].elapsedMs, 5000);
  assert.equal(records[2].stage, "metadata");
  assert.equal(records.at(-1).event, "error");
  assert.equal(cancelled, true);
  assert.doesNotMatch(JSON.stringify(records), /secret|filename|token|url/);
});
test("loading heartbeat is bounded and does not restart for repeated UI updates", () => {
  const records = [];
  let tick;
  const trace = createPlaybackLoadingTrace({
    write: (r) => records.push(r),
    schedule: (fn) => {
      tick = fn;
      return 1;
    },
    cancel() {}
  });
  trace.begin("finding");
  trace.begin("opening");
  for (let i = 0; i < 100; i++) tick();
  trace.finish();
  trace.finish();
  assert.equal(records.length, 62);
  trace.begin("opening");
  assert.equal(records.at(-1).attempt, 2);
  trace.finish();
});
