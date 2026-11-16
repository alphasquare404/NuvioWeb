import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareDecodeAudioFromGesture,
  takeDecodeAudioContext,
  applyPlaybackAudioSession
} from "./decodeAudioContext.js";

test("Decode & Play reuses the context unlocked during the initial gesture", () => {
  const activation = { isActive: false };
  const calls = [];
  class AudioContext {
    constructor() {
      this.state = "suspended";
      calls.push("created");
    }
    async resume() {
      calls.push("resumed");
      if (activation.isActive) this.state = "running";
    }
  }
  const globals = {
    AudioContext,
    isSecureContext: true,
    navigator: { userActivation: activation }
  };
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  try {
    const settings = { mediabunnyMode: "decode" };
    prepareDecodeAudioFromGesture(settings);
    assert.deepEqual(calls, []);
    activation.isActive = true;
    prepareDecodeAudioFromGesture({ mediabunnyMode: "process" });
    assert.deepEqual(calls, []);
    prepareDecodeAudioFromGesture(settings);
    activation.isActive = false;
    assert.equal(takeDecodeAudioContext().state, "running");
    assert.deepEqual(calls, ["created", "resumed"]);
  } finally {
    for (const key of Object.keys(globals)) {
      if (descriptors[key]) Object.defineProperty(globalThis, key, descriptors[key]);
      else delete globalThis[key];
    }
  }
});

test("decode playback claims an audio session that ignores the ring switch", () => {
  const session = { type: "auto" };
  applyPlaybackAudioSession({ navigator: { audioSession: session } });
  assert.equal(session.type, "playback");
});

test("browsers without an audio session API are left alone", () => {
  applyPlaybackAudioSession({ navigator: {} });
  applyPlaybackAudioSession({});
  assert.ok(true);
});

test("a session that rejects assignment does not break playback setup", () => {
  const session = {
    get type() {
      return "auto";
    },
    set type(_value) {
      throw new Error("readonly");
    }
  };
  assert.doesNotThrow(() => applyPlaybackAudioSession({ navigator: { audioSession: session } }));
});
