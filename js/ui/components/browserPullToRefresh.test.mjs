import test from "node:test";
import assert from "node:assert/strict";
import { BrowserPullToRefresh } from "./browserPullToRefresh.js";

test("pull refresh chooses the active scroll owner before a merely scrollable fallback", () => {
  const html = { scrollTop: 0, scrollHeight: 1000, clientHeight: 600 };
  const body = { scrollTop: 120, scrollHeight: 1000, clientHeight: 600 };
  const owner = BrowserPullToRefresh.getScrollOwner({ scrollingElement: html, body, documentElement: html });
  assert.equal(owner, body);
});

test("pull refresh only accepts a downward vertical gesture", () => {
  assert.equal(BrowserPullToRefresh.getIntent({ deltaX: 2, deltaY: 4 }), "pending");
  assert.equal(BrowserPullToRefresh.getIntent({ deltaX: 10, deltaY: 36 }), "pull");
  assert.equal(BrowserPullToRefresh.getIntent({ deltaX: 36, deltaY: 10 }), "cancel");
  assert.equal(BrowserPullToRefresh.getIntent({ deltaX: 4, deltaY: -36 }), "cancel");
});

test("pull refresh uses resistance and requires a deliberate threshold", () => {
  assert.equal(BrowserPullToRefresh.getVisualDistance(100), 50);
  assert.equal(BrowserPullToRefresh.isReady(83), false);
  assert.equal(BrowserPullToRefresh.isReady(84), true);
});
