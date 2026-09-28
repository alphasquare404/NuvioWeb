import assert from "node:assert/strict";
import test from "node:test";

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) || null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
  clear: () => values.clear()
};

const { shouldOfferInstall, isAppInstalled } = await import("./browserInstallPrompt.js");

test("the banner is offered to a browser that has not installed or refused", () => {
  assert.equal(shouldOfferInstall({ isBrowser: true, installed: false, dismissed: false }), true);
});

test("an installed app is never asked to install itself", () => {
  assert.equal(shouldOfferInstall({ isBrowser: true, installed: true, dismissed: false }), false);
});

test("a refusal is final", () => {
  assert.equal(shouldOfferInstall({ isBrowser: true, installed: false, dismissed: true }), false);
});

test("nothing is offered off the browser", () => {
  assert.equal(shouldOfferInstall({ isBrowser: false, installed: false, dismissed: false }), false);
  assert.equal(shouldOfferInstall({}), false);
});

// The standalone checks read two different APIs because iOS answers on only
// one of them; neither may exist at all. `navigator` is getter-only in Node,
// hence defineProperty rather than assignment.
function setNavigator(value) {
  Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });
}

test("installed is read from either standalone signal, and absence is not a crash", () => {
  const originalMatchMedia = globalThis.matchMedia;
  const originalNavigator = globalThis.navigator;

  delete globalThis.matchMedia;
  setNavigator({});
  assert.equal(isAppInstalled(), false);

  globalThis.matchMedia = (query) => ({ matches: query === "(display-mode: standalone)" });
  assert.equal(isAppInstalled(), true);

  globalThis.matchMedia = () => ({ matches: false });
  setNavigator({ standalone: true });
  assert.equal(isAppInstalled(), true);

  if (originalMatchMedia) globalThis.matchMedia = originalMatchMedia;
  else delete globalThis.matchMedia;
  setNavigator(originalNavigator);
});
