import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveBrowserPlayerShortcutRoute,
  shouldBlurBrowserPlayerToolbarAfterPointer
} from "./playerBrowserShortcutRouting.js";

test("pointer-clicked fullscreen cannot take ownership of the Space shortcut", () => {
  assert.equal(shouldBlurBrowserPlayerToolbarAfterPointer({ detail: 1 }), true);
  assert.equal(
    resolveBrowserPlayerShortcutRoute({ keyCode: 32, dialogOpen: false }),
    "play-pause"
  );
});

test("subtitle and audio dialogs block shortcuts only while they are open", () => {
  assert.equal(
    resolveBrowserPlayerShortcutRoute({ keyCode: 32, dialogOpen: true }),
    "dialog"
  );
  assert.equal(
    resolveBrowserPlayerShortcutRoute({ keyCode: 32, dialogOpen: false }),
    "play-pause"
  );
  assert.equal(
    resolveBrowserPlayerShortcutRoute({ keyCode: 39, dialogOpen: false }),
    "seek"
  );
});

test("normal Player Space and Arrow shortcuts do not require a focused toolbar control", () => {
  assert.equal(resolveBrowserPlayerShortcutRoute({ keyCode: 32 }), "play-pause");
  assert.equal(resolveBrowserPlayerShortcutRoute({ keyCode: 37 }), "seek");
  assert.equal(
    resolveBrowserPlayerShortcutRoute({ keyCode: 39, dialogOpen: false }),
    "seek"
  );
});

test("browser Player dialogs and real inputs retain keyboard ownership", () => {
  assert.equal(
    resolveBrowserPlayerShortcutRoute({ keyCode: 39, editable: true }),
    "native-input"
  );
});

test("browser fullscreen Escape remains a native browser operation", () => {
  assert.equal(
    resolveBrowserPlayerShortcutRoute({ isBackKey: true, fullscreen: true }),
    "allow-fullscreen-exit"
  );
  assert.equal(resolveBrowserPlayerShortcutRoute({ isBackKey: true }), "back");
});
