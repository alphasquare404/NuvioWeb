import assert from "node:assert/strict";
import test from "node:test";

const { createTrackingScrobbleService } = await import("./trackingScrobbleService.js");

function fakeProvider({ enabled = true } = {}) {
  const calls = [];
  return {
    calls,
    isEnabled: () => enabled,
    start: (context) => calls.push(["start", context]),
    pause: (context) => calls.push(["pause", context]),
    stop: (context) => calls.push(["stop", context]),
    reportPosition: (context) => calls.push(["reportPosition", context]),
    cancel: () => calls.push(["cancel"])
  };
}

function movie(percent) {
  return {
    contentId: "tt0133093",
    contentType: "movie",
    title: "The Matrix",
    positionMs: percent * 1000,
    durationMs: 100_000,
    progressPercent: percent
  };
}

test("a finished playback closes the provider session with a stop", () => {
  // A history write marks the title watched but cannot end the session; only
  // the stop does. This is the exit that used to be left "scrobbling".
  const provider = fakeProvider();
  const service = createTrackingScrobbleService([provider]);
  assert.equal(service.complete(movie(100)), true);
  assert.deepEqual(
    provider.calls.map(([action]) => action),
    ["stop"]
  );
  assert.equal(provider.calls[0][1].progressPercent, 100);
});

test("the same finish is posted only once", () => {
  // The player's lifecycle can report the same exit several times.
  const provider = fakeProvider();
  const service = createTrackingScrobbleService([provider]);
  assert.equal(service.complete(movie(100)), true);
  assert.equal(service.complete(movie(100)), false);
  assert.equal(provider.calls.length, 1);
});

test("cancel lets a later session report the same title again", () => {
  const provider = fakeProvider();
  const service = createTrackingScrobbleService([provider]);
  service.complete(movie(100));
  service.cancel();
  service.complete(movie(100));
  assert.equal(provider.calls.filter(([action]) => action === "stop").length, 2);
});

test("a partial position is still a report, not a finish", () => {
  const provider = fakeProvider();
  const service = createTrackingScrobbleService([provider]);
  assert.equal(service.report(movie(85)), true);
  assert.deepEqual(
    provider.calls.map(([action]) => action),
    ["reportPosition"]
  );
});

test("a position below the provider threshold is recorded as a stop", () => {
  const provider = fakeProvider();
  const service = createTrackingScrobbleService([provider]);
  service.report(movie(42));
  assert.deepEqual(
    provider.calls.map(([action]) => action),
    ["stop"]
  );
});

test("a completed position is never sent as a partial report", () => {
  const provider = fakeProvider();
  const service = createTrackingScrobbleService([provider]);
  assert.equal(service.report(movie(100)), false);
  assert.equal(provider.calls.length, 0);
});

test("nothing is sent when no provider owns playback", () => {
  const provider = fakeProvider({ enabled: false });
  const service = createTrackingScrobbleService([provider]);
  assert.equal(service.complete(movie(100)), false);
  assert.equal(service.report(movie(85)), false);
  assert.equal(provider.calls.length, 0);
});
