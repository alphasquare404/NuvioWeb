import assert from "node:assert/strict";
import test from "node:test";
import {
  BROWSER_PICTURE_IN_PICTURE_STANDARD,
  BROWSER_PICTURE_IN_PICTURE_WEBKIT,
  enterBrowserPictureInPicture,
  exitBrowserPictureInPicture,
  getBrowserPictureInPictureCapability,
  isBrowserPictureInPictureActive,
  isBrowserPictureInPictureUnavailableForSession,
  shouldMarkBrowserPictureInPictureUnavailable
} from "./browserPictureInPicture.js";

test("standard Picture-in-Picture stays available in a standalone PWA when the active video supports it", () => {
  const video = { requestPictureInPicture() {} };
  const documentRef = {
    pictureInPictureEnabled: true,
    exitPictureInPicture() {},
    pictureInPictureElement: null
  };
  const standalonePwaRuntime = { navigator: { standalone: true } };

  assert.equal(standalonePwaRuntime.navigator.standalone, true);
  assert.equal(getBrowserPictureInPictureCapability(video, documentRef), BROWSER_PICTURE_IN_PICTURE_STANDARD);
});

test("Picture-in-Picture support is unavailable when the active video exposes no usable API", () => {
  assert.equal(getBrowserPictureInPictureCapability({}, { pictureInPictureEnabled: true }), null);
});

test("WebKit presentation mode is used only when standard Picture-in-Picture is unavailable", () => {
  const video = {
    webkitSetPresentationMode() {},
    webkitSupportsPresentationMode: (mode) => mode === "picture-in-picture",
    webkitPresentationMode: "inline"
  };
  const documentRef = { pictureInPictureEnabled: false };

  assert.equal(getBrowserPictureInPictureCapability(video, documentRef), BROWSER_PICTURE_IN_PICTURE_WEBKIT);
  assert.equal(isBrowserPictureInPictureActive(video, documentRef), false);
  video.webkitPresentationMode = "picture-in-picture";
  assert.equal(isBrowserPictureInPictureActive(video, documentRef), true);
});

test("standard Picture-in-Picture lifecycle state follows the browser-owned active element", () => {
  const video = { requestPictureInPicture() {} };
  const documentRef = {
    pictureInPictureEnabled: true,
    exitPictureInPicture() {},
    pictureInPictureElement: null
  };

  assert.equal(isBrowserPictureInPictureActive(video, documentRef), false);
  documentRef.pictureInPictureElement = video;
  assert.equal(isBrowserPictureInPictureActive(video, documentRef), true);
  documentRef.pictureInPictureElement = null;
  assert.equal(isBrowserPictureInPictureActive(video, documentRef), false);
});

test("standard PiP enters through the active video and exits through the document API", async () => {
  let entered = 0;
  let exited = 0;
  const video = { requestPictureInPicture: async () => entered++ };
  const documentRef = {
    pictureInPictureEnabled: true,
    exitPictureInPicture: async () => exited++,
    pictureInPictureElement: null
  };

  assert.equal(await enterBrowserPictureInPicture(video, documentRef), true);
  assert.equal(entered, 1);
  documentRef.pictureInPictureElement = video;
  assert.equal(await exitBrowserPictureInPicture(video, documentRef), true);
  assert.equal(exited, 1);
});

test("PiP entry failures propagate for the Player to handle without changing playback state", async () => {
  const video = { requestPictureInPicture: async () => Promise.reject(new DOMException("Denied", "NotAllowedError")) };
  const documentRef = { pictureInPictureEnabled: true, exitPictureInPicture() {} };

  await assert.rejects(() => enterBrowserPictureInPicture(video, documentRef), { name: "NotAllowedError" });
});

test("only NotSupportedError suppresses PiP for the current video session", () => {
  const video = {};
  assert.equal(shouldMarkBrowserPictureInPictureUnavailable({ name: "NotSupportedError" }), true);
  assert.equal(shouldMarkBrowserPictureInPictureUnavailable({ name: "NotAllowedError" }), false);
  assert.equal(shouldMarkBrowserPictureInPictureUnavailable({ name: "InvalidStateError" }), false);
  assert.equal(
    isBrowserPictureInPictureUnavailableForSession({
      video,
      session: 3,
      unavailableVideo: video,
      unavailableSession: 3
    }),
    true
  );
  assert.equal(
    isBrowserPictureInPictureUnavailableForSession({
      video,
      session: 4,
      unavailableVideo: video,
      unavailableSession: 3
    }),
    false
  );
  assert.equal(
    isBrowserPictureInPictureUnavailableForSession({
      video: {},
      session: 3,
      unavailableVideo: video,
      unavailableSession: 3
    }),
    false
  );
});
