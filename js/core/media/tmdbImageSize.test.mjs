import assert from "node:assert/strict";
import test from "node:test";

import { capTmdbImageSize } from "./tmdbImageSize.js";

// The measurement that produced this file: a hero logo arrived as
// 14481x3568 -- 197MB once decoded -- and an iPhone's web process was killed
// every time the hero rotated to it.
test("an original-size TMDB image is capped for the job it does", () => {
  const original = "https://image.tmdb.org/t/p/original/abc123.png";
  assert.equal(capTmdbImageSize(original, "logo"), "https://image.tmdb.org/t/p/w780/abc123.png");
  assert.equal(capTmdbImageSize(original, "poster"), "https://image.tmdb.org/t/p/w500/abc123.png");
  assert.equal(
    capTmdbImageSize(original, "backdrop"),
    "https://image.tmdb.org/t/p/w1280/abc123.png"
  );
});

test("anything already small enough is left as it is", () => {
  const small = "https://image.tmdb.org/t/p/w342/abc123.jpg";
  assert.equal(capTmdbImageSize(small, "poster"), small);
  assert.equal(capTmdbImageSize(small, "backdrop"), small);
  const exact = "https://image.tmdb.org/t/p/w500/abc123.jpg";
  assert.equal(capTmdbImageSize(exact, "poster"), exact);
});

test("a bigger named size is brought down to the cap", () => {
  assert.equal(
    capTmdbImageSize("https://image.tmdb.org/t/p/w1280/abc.jpg", "poster"),
    "https://image.tmdb.org/t/p/w500/abc.jpg"
  );
});

// Addons serve artwork from anywhere, and a URL this cannot resize must come
// back untouched rather than mangled.
test("images from anywhere else pass through unchanged", () => {
  const metahub = "https://images.metahub.space/logo/medium/tt0133093/img";
  assert.equal(capTmdbImageSize(metahub, "logo"), metahub);
  assert.equal(capTmdbImageSize("", "logo"), "");
  assert.equal(capTmdbImageSize(null, "poster"), "");
  assert.equal(
    capTmdbImageSize("https://cdn.xperience-app.com/covers/default/genres.webp", "poster"),
    "https://cdn.xperience-app.com/covers/default/genres.webp"
  );
});

test("an unknown role is treated as a card", () => {
  assert.equal(
    capTmdbImageSize("https://image.tmdb.org/t/p/original/abc.jpg", "something-else"),
    "https://image.tmdb.org/t/p/w500/abc.jpg"
  );
});

// The hero draws one picture across the whole screen, so it is sized for that
// screen rather than for a card.
test("hero artwork asks the host for the size it will actually be drawn at", () => {
  const metahubBackground = "https://images.metahub.space/background/medium/tt0133093/img";
  const metahubPoster = "https://images.metahub.space/poster/small/tt0133093/img";
  assert.equal(
    capTmdbImageSize(metahubBackground, "heroBackdrop"),
    "https://images.metahub.space/background/large/tt0133093/img"
  );
  assert.equal(
    capTmdbImageSize(metahubPoster, "heroPoster"),
    "https://images.metahub.space/poster/large/tt0133093/img"
  );
  // A card is a card: the small one is right there, and there are dozens.
  assert.equal(capTmdbImageSize(metahubBackground, "backdrop"), metahubBackground);
  assert.equal(
    capTmdbImageSize("https://image.tmdb.org/t/p/original/plate.jpg", "heroPoster"),
    "https://image.tmdb.org/t/p/w780/plate.jpg"
  );
});

// The one device that was killed for memory is the one that crops the picture
// and so would gain least from the pixels.
test("a phone keeps the capped backdrop while a wide screen gets the original", () => {
  const original = "https://image.tmdb.org/t/p/original/wide.jpg";
  const width = globalThis.innerWidth;
  try {
    globalThis.innerWidth = 390;
    assert.equal(
      capTmdbImageSize(original, "heroBackdrop"),
      "https://image.tmdb.org/t/p/w1280/wide.jpg"
    );
    globalThis.innerWidth = 1440;
    assert.equal(capTmdbImageSize(original, "heroBackdrop"), original);
  } finally {
    globalThis.innerWidth = width;
  }
});

// The hero is written to several times from several sources, so its size has
// to be the one it asked for -- not whichever source wrote last.
test("hero artwork is raised to its size, not only lowered to it", () => {
  const width = globalThis.innerWidth;
  try {
    globalThis.innerWidth = 1440;
    assert.equal(
      capTmdbImageSize("https://image.tmdb.org/t/p/w1280/wide.jpg", "heroBackdrop"),
      "https://image.tmdb.org/t/p/original/wide.jpg"
    );
    assert.equal(
      capTmdbImageSize("https://image.tmdb.org/t/p/w500/plate.jpg", "heroPoster"),
      "https://image.tmdb.org/t/p/w780/plate.jpg"
    );
    // A card still only ever shrinks.
    assert.equal(
      capTmdbImageSize("https://image.tmdb.org/t/p/w342/card.jpg", "poster"),
      "https://image.tmdb.org/t/p/w342/card.jpg"
    );
  } finally {
    globalThis.innerWidth = width;
  }
});
