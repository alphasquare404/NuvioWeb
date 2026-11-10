import test from "node:test";
import assert from "node:assert/strict";
import { installStartupPlaybackDiagnostics } from "./startupPlaybackDiagnostics.js";

function fixture(play = () => Promise.resolve()) {
  const listeners = new Map();
  const video = {
    paused: true,
    muted: true,
    volume: 1,
    currentTime: 0,
    readyState: 3,
    play,
    pause() {
      this.paused = true;
    },
    addEventListener(name, fn) {
      listeners.set(name, fn);
    },
    removeEventListener(name) {
      listeners.delete(name);
    },
    src: "https://secret.example/media?token=private"
  };
  const controller = {
    video,
    isPlaying: false,
    startupPresentationAudioMuted: true,
    setStartupPresentationAudioMuted(value) {
      this.startupPresentationAudioMuted = value;
      video.muted = value;
    },
    resume() {
      return video.play();
    }
  };
  return { video, controller, listeners };
}

test("diagnostics preserve play promises, record rejection safely, and restore original methods", async (t) => {
  const error = Object.assign(new Error("https://secret.example/?token=private"), {
    name: "NotAllowedError"
  });
  const pending = Promise.reject(error);
  const { video, controller, listeners } = fixture(() => pending);
  const originalPlay = video.play,
    originalResume = controller.resume;
  const events = [];
  const cleanup = installStartupPlaybackDiagnostics({
    controller,
    screen: {},
    emit: (event) => events.push(event)
  });
  t.after(cleanup);
  assert.equal(controller.resume(), pending);
  await assert.rejects(pending, (actual) => actual === error);
  await Promise.resolve();
  assert.ok(
    events.some(
      (event) => event.event === "video.play:rejected" && event.error === "NotAllowedError"
    )
  );
  controller.setStartupPresentationAudioMuted(false);
  assert.equal(video.muted, false);
  listeners.get("volumechange")();
  assert.equal(events.at(-1).muted, false);
  assert.ok(!JSON.stringify(events).includes("secret"));
  assert.ok(!JSON.stringify(events).includes("private"));
  cleanup();
  assert.equal(video.play, originalPlay);
  assert.equal(controller.resume, originalResume);
  assert.equal(listeners.size, 0);
});

test("diagnostics keep synchronous failures and limit event volume", (t) => {
  const error = new Error("private detail");
  const { video, controller } = fixture(() => {
    throw error;
  });
  const events = [];
  const cleanup = installStartupPlaybackDiagnostics({
    controller,
    screen: {},
    emit: (event) => events.push(event),
    maxEvents: 5
  });
  t.after(cleanup);
  for (let i = 0; i < 10; i++)
    assert.throws(
      () => video.play(),
      (actual) => actual === error
    );
  assert.equal(events.length, 5);
  assert.ok(
    events.some((event) => event.event === "video.play:threw" && event.error === "OtherError")
  );
});

test("a failing log sink cannot interrupt playback", (t) => {
  const { video, controller } = fixture(() => 42);
  t.after(
    installStartupPlaybackDiagnostics({
      controller,
      screen: {},
      emit() {
        throw new Error("offline");
      }
    })
  );
  assert.equal(video.play(), 42);
  controller.setStartupPresentationAudioMuted(false);
  assert.equal(video.muted, false);
});
