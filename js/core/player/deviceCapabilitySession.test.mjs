import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  initializeDeviceCapabilitySession,
  getCapabilityRevision
} from "./deviceCapabilitySession.js";
import { getHdrPlaybackSupport, invalidateHdrPlaybackSupport } from "./hdrSupport.js";
import { getDeviceCapabilities, invalidateDeviceCapabilities } from "./deviceCapabilities.js";

test("startup warms device answers once, and relevant change events refresh one snapshot", async () => {
  const original = Object.fromEntries(
    ["document", "matchMedia", "addEventListener", "fetch"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key)
    ])
  );
  let codecCalls = 0;
  let hdrCalls = 0;
  let hdr = false;
  const mediaListeners = [];
  let pageshow;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: () => ({
        canPlayType: () => {
          codecCalls++;
          return "probably";
        }
      })
    }
  });
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    value: (query) => {
      hdrCalls++;
      return {
        matches:
          query === "(video-dynamic-range: high)"
            ? hdr
            : query === "(video-dynamic-range: standard)",
        addEventListener: (type, callback) => mediaListeners.push(callback)
      };
    }
  });
  Object.defineProperty(globalThis, "addEventListener", {
    configurable: true,
    value: (type, callback) => {
      if (type === "pageshow") pageshow = callback;
    }
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: () => {
      throw Error("startup capability checks must not contact a server");
    }
  });
  try {
    invalidateDeviceCapabilities();
    invalidateHdrPlaybackSupport();
    const first = initializeDeviceCapabilitySession();
    assert.equal(first.hdr, false);
    assert.equal(first.codecs.h264, true);
    const counts = [codecCalls, hdrCalls];
    for (let i = 0; i < 10; i++) {
      initializeDeviceCapabilitySession();
      getDeviceCapabilities();
      getHdrPlaybackSupport();
    }
    assert.deepEqual([codecCalls, hdrCalls], counts);
    assert.equal(mediaListeners.length, 4, "repeat initialization must not duplicate listeners");
    const revision = getCapabilityRevision();
    hdr = true;
    mediaListeners[0]();
    mediaListeners[1]();
    await Promise.resolve();
    assert.equal(getCapabilityRevision(), revision + 1, "coalesce a burst of display changes");
    assert.equal(getHdrPlaybackSupport(), true);
    assert.equal(codecCalls, counts[0] * 2);
    pageshow({ persisted: false });
    await Promise.resolve();
    assert.equal(
      getCapabilityRevision(),
      revision + 1,
      "ordinary pageshow is not another startup scan"
    );
    pageshow({ persisted: true });
    await Promise.resolve();
    assert.equal(
      getCapabilityRevision(),
      revision + 2,
      "returning from page suspension refreshes the device"
    );
  } finally {
    for (const [key, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    invalidateDeviceCapabilities();
    invalidateHdrPlaybackSupport();
  }
});

test("app bootstrap initializes playback capabilities before profile/auth navigation", async () => {
  const source = await readFile(new URL("../../app.js", import.meta.url), "utf8");
  const startup = source.slice(source.indexOf("async function bootstrapApp()"));
  const init = startup.indexOf("initializeDeviceCapabilitySession();");
  assert.ok(init > startup.indexOf("Platform.init();"));
  assert.ok(init < startup.indexOf("await I18n.init();"));
  assert.ok(init < startup.indexOf("Router.init();"));
  assert.ok(init < startup.indexOf("await AuthManager.bootstrap();"));
});
