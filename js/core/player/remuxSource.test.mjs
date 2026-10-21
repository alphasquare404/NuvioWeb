import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRemuxSource,
  buildRemuxUrl,
  isRemuxEndpointConfigured,
  shouldRemuxSource
} from "./remuxSource.js";

const ENDPOINT = "/api/remux";

test("nothing is rewired until an endpoint exists", () => {
  assert.equal(isRemuxEndpointConfigured(""), false);
  assert.equal(isRemuxEndpointConfigured("   "), false);
  assert.equal(isRemuxEndpointConfigured(ENDPOINT), true);
  assert.equal(shouldRemuxSource("https://cdn.test/a.mkv", ""), false);
});

test("an mkv source is recognised, with or without a query", () => {
  assert.equal(shouldRemuxSource("https://cdn.test/a.mkv", ENDPOINT), true);
  assert.equal(shouldRemuxSource("https://cdn.test/a.MKV", ENDPOINT), true);
  assert.equal(shouldRemuxSource("https://cdn.test/a.mkv?token=1&x=2", ENDPOINT), true);
  assert.equal(shouldRemuxSource("https://cdn.test/a.mkv#t=10", ENDPOINT), true);
});

test("everything else is left alone", () => {
  assert.equal(shouldRemuxSource("https://cdn.test/a.mp4", ENDPOINT), false);
  assert.equal(shouldRemuxSource("https://cdn.test/a.mkv.torrent", ENDPOINT), false);
  assert.equal(shouldRemuxSource("blob:https://app.test/1234", ENDPOINT), false);
  assert.equal(shouldRemuxSource("", ENDPOINT), false);
});

test("a source already pointing at the endpoint is not wrapped again", () => {
  const wrapped = buildRemuxUrl("https://cdn.test/a.mkv", ENDPOINT);
  assert.equal(shouldRemuxSource(wrapped, ENDPOINT), false);
  assert.equal(shouldRemuxSource(wrapped, ENDPOINT), false);
});

test("the wrapper encodes the source so its own query survives", () => {
  const url = buildRemuxUrl("https://cdn.test/a.mkv?token=1&x=2", ENDPOINT);
  assert.equal(url.startsWith("/api/remux?u="), true);
  const encoded = url.slice("/api/remux?u=".length);
  assert.equal(decodeURIComponent(encoded), "https://cdn.test/a.mkv?token=1&x=2");
  // An endpoint that already carries a query keeps working.
  assert.equal(buildRemuxUrl("https://cdn.test/a.mkv", "/api/remux?v=2").includes("?v=2&u="), true);
});

test("the player params are copied, not mutated", () => {
  const params = { streamUrl: "https://cdn.test/a.mkv", itemId: "x" };
  const next = applyRemuxSource(params, ENDPOINT);
  assert.notEqual(next, params);
  assert.equal(params.streamUrl, "https://cdn.test/a.mkv");
  assert.equal(next.itemId, "x");
  assert.equal(next.streamUrl.startsWith("/api/remux?u="), true);

  // A non-mkv source is returned untouched, same object.
  const mp4 = { streamUrl: "https://cdn.test/a.mp4" };
  assert.equal(applyRemuxSource(mp4, ENDPOINT), mp4);
});
