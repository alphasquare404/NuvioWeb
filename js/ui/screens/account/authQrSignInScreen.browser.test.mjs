import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("./authQrSignInScreen.js", import.meta.url);

test("the browser QR screen has one Back, not two with different outcomes", async () => {
  const source = await readFile(sourceUrl, "utf8");

  // The card button ran `handleContinueAction`, which can continue without an
  // account; the floating one returns to the sign-in screen. Only the floating
  // one is drawn in the browser.
  assert.match(
    source,
    /this\.isDesktopBrowser\s*\?\s*""\s*:\s*`<button type="button" id="qr-back-btn"/
  );
});

test("a Back request in the browser goes to the same place as the visible button", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(
    source,
    /consumeBackRequest\(\)\s*\{\s*\/\/[\s\S]{0,400}?if \(this\.isDesktopBrowser\) \{\s*this\.handleDesktopBrowserBack\(\);\s*return true;\s*\}/
  );
});
