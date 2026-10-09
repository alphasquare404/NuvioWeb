import assert from "node:assert/strict";
import test from "node:test";

import { shouldRevealFocusedStreamItem, streamFocusRevealKey } from "./streamFocusReveal.js";

const card = (row, action = "play") => streamFocusRevealKey({ zone: "card", row, action });

test("the first application reveals, so an entered screen shows its row", () => {
  assert.equal(shouldRevealFocusedStreamItem("", card(4)), true);
  assert.equal(shouldRevealFocusedStreamItem(null, card(4)), true);
});

// The reported fault. A download re-renders the list several times a second and
// every render applies the focus again. Revealing on each of those pulled the
// list back to the focused card, and scrolling away lasted until the next byte.
test("re-applying the same focus does not move the list", () => {
  assert.equal(shouldRevealFocusedStreamItem(card(4), card(4)), false);
});

test("moving to another row reveals", () => {
  assert.equal(shouldRevealFocusedStreamItem(card(4), card(5)), true);
});

// Left and right move between a card's actions without changing its row, and
// an action can sit outside the visible part of the card.
test("moving to another action on the same row reveals", () => {
  assert.equal(shouldRevealFocusedStreamItem(card(4, "play"), card(4, "download")), true);
});

test("the filter row and the cards are never mistaken for each other", () => {
  const filter = streamFocusRevealKey({ zone: "filter", index: 4 });
  assert.notEqual(filter, card(4));
  assert.equal(shouldRevealFocusedStreamItem(filter, card(4)), true);
});

test("a missing descriptor is a key of its own rather than a crash", () => {
  assert.equal(streamFocusRevealKey(null), "");
  assert.equal(streamFocusRevealKey({ zone: "card" }), "card:0:play");
});
