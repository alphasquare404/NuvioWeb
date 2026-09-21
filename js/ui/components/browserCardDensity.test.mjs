import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Small-screen card sizing used to be a per-surface literal: Home, Search,
// Collection, Cast, Library, Catalog See All and Discover each carried their
// own copy of the same "about 40% of the viewport" idea, and drifted. These
// guard the shared basis that replaced them.
//
// Node cannot lay out CSS, so these check the one thing that is actually
// checkable and that regressed before: that the density is declared once and
// consumed, rather than copied per screen.

// Git hands these files to a Windows working tree with CRLF endings, and one
// assertion below slices on a literal line break. Read raw, the test failed on
// any fresh checkout there while passing everywhere else -- a property of the
// checkout, not of the CSS it is supposed to be guarding.
const readSource = async (url) => (await readFile(url, "utf8")).replace(/\r\n/g, "\n");

const desktopCss = await readSource(new URL("../../../css/desktop.css", import.meta.url));
const componentsCss = await readSource(new URL("../../../css/components.css", import.meta.url));
const libraryScreen = await readSource(
  new URL("../screens/library/libraryScreen.js", import.meta.url)
);

const countOf = (source, pattern) => (source.match(pattern) || []).length;

test("the density basis is declared once per breakpoint, not per surface", () => {
  const declarations = countOf(desktopCss, /^\s*--browser-card-min:/gm);
  assert.equal(declarations, 2, "exactly two declarations: phone portrait and landscape phone");
  // Both live on the shared browser root so every surface inherits them.
  const owningSelector = desktopCss
    .split(/^\s*--browser-card-min:/gm)
    .slice(0, -1)
    .map((before) => before.slice(before.lastIndexOf("{", before.length) - 200).trim());
  for (const chunk of owningSelector) {
    assert.match(chunk, /\.desktop-browser \{[^}]*$/, "declared on .desktop-browser itself");
  }
});

test("portrait uses viewport width and landscape uses viewport height", () => {
  // A landscape phone is short, not narrow: sizing it by width is what handed
  // an 844x390 device tablet-sized cards on a 390px-tall viewport.
  assert.match(desktopCss, /--browser-card-min: clamp\(\d+px, \d+vw, \d+px\);/);
  assert.match(desktopCss, /--browser-card-min: clamp\(\d+px, \d+vh, \d+px\);/);
});

test("landscape phones are caught by the project's existing short-screen query", () => {
  assert.match(
    desktopCss,
    /@media \(max-width: 1023px\) and \(max-height: 500px\) and \(orientation: landscape\) \{\s*\n\s*\.desktop-browser \{/,
    "reuses the max-height: 500px convention already used for hero geometry"
  );
  // Without the width bound, a short wide desktop window would match too and
  // get phone card sizing.
  assert.doesNotMatch(desktopCss, /@media \(max-height: 500px\) and \(orientation: landscape\)/);
});

test("grid surfaces consume the basis instead of repeating a literal", () => {
  const gridUses = countOf(desktopCss, /minmax\(var\(--browser-card-min[^)]*\)[^)]*\)/g);
  assert.ok(gridUses >= 9, `every card grid reads the basis (found ${gridUses})`);
  // Library, Catalog See All and Collection each had their own identical copy.
  assert.equal(
    countOf(desktopCss, /minmax\(min\(42vw, 168px\), 1fr\)/g),
    1,
    "the duplicated phone grid literal is gone from card grids (Settings keeps its own)"
  );
});

test("rails take the standard width and grids take the minimum", () => {
  // A grid stretches its columns past the minimum; a rail sits exactly on the
  // value it is given. Feeding both the same number is what made Home and
  // Search render ~107px next to Library's ~125px at the same viewport.
  for (const [name, pattern] of [
    ["Home posters", /--browser-home-poster-width: var\(--browser-card-standard/],
    ["Home tablet posters", /--browser-home-tablet-poster-width: var\(--browser-card-standard/],
    ["Search", /--search-desktop-card-width: var\(--browser-card-standard/],
    ["Collection rows", /flex: 0 0 var\(--browser-card-standard, clamp\(156px/],
    ["Cast", /flex: 0 0 var\(--browser-card-standard, 168px\)/]
  ]) {
    assert.match(desktopCss, pattern, `${name} sizes from the standard rail width`);
  }
  assert.doesNotMatch(
    desktopCss,
    /--browser-home-poster-width: var\(--browser-card-min/,
    "no rail may size itself from the grid minimum"
  );
  assert.doesNotMatch(desktopCss, /--search-desktop-card-width: var\(--browser-card-min/);
});

test("the standard width is the three-column result the approved grids render", () => {
  // Library, Discover and Collection are the visual reference. Their portrait
  // cards are (viewport - gutters - gaps) / 3, so a rail that wants to match
  // them has to be that same number rather than the grid's minimum.
  assert.match(
    desktopCss,
    /--browser-card-standard: clamp\(\d+px, calc\(\(100vw - \d+px\) \/ 3\), \d+px\);/,
    "portrait standard width is derived, not guessed"
  );
  assert.match(desktopCss, /--browser-card-standard: clamp\(\d+px, \d+(?:\.\d+)?vh, \d+px\);/);
});

test("compact phone posters share one radius token", () => {
  assert.equal(
    (desktopCss.match(/^\s*--browser-card-radius:/gm) || []).length,
    2,
    "declared once per breakpoint"
  );
  // Home and Search were the only standard surfaces still carrying the 24px
  // desktop radius down to a ~110px card; the approved grids were already 14px.
  assert.match(desktopCss, /--home-poster-radius: var\(--browser-card-radius\)/);
  assert.match(
    desktopCss,
    /home-poster-card:not\(\.is-landscape\)/,
    "landscape tiles keep their own radius"
  );
});

test("section headings and section rhythm come from shared tokens", () => {
  for (const prop of [
    "--browser-section-title-size",
    "--browser-section-gap",
    "--browser-section-head-gap"
  ]) {
    const declared = desktopCss.split(prop + ":").length - 1;
    assert.equal(declared, 2, `${prop} is declared once per phone breakpoint`);
  }
  assert.match(desktopCss, /font-size: var\(--browser-section-title-size\)/);
  // Page titles ("Library", "Search") are a different role and must not follow
  // the section-heading scale.
  assert.doesNotMatch(desktopCss, /library-title[^{]*\{[^}]*--browser-section-title-size/);
});

test("landscape tiles keep their own shape rather than becoming square", () => {
  // Continue Watching and landscape collection tiles are 16:9; they are
  // expressed against the same basis but must not collapse to a poster width.
  assert.match(
    desktopCss,
    /--browser-card-landscape-width: calc\(var\(--browser-card-standard\) \* [\d.]+\)/
  );
  assert.match(
    desktopCss,
    /--browser-home-continue-width: var\(\s*\n?\s*--browser-card-landscape-width/
  );
  assert.match(
    desktopCss,
    /is-collection-landscape \{\s*\n\s*flex-basis: var\(--browser-card-landscape-width/
  );
});

test("every consumer keeps its previous value as the fallback", () => {
  // The basis is only declared on small screens. Desktop and portrait tablets
  // never match those queries, so each consumer must still carry the value it
  // had before or those layouts silently collapse.
  const uses = desktopCss.match(/var\(--browser-card-(?:min|standard)[^;]*\)/g) || [];
  const insidePhoneBlock = uses.filter((u) => !/,/.test(u));
  assert.ok(
    uses.length - insidePhoneBlock.length >= 8,
    "most consumers pass a fallback for the breakpoints that do not define the basis"
  );
});

test("Library no longer writes a poster width that no breakpoint can override", () => {
  // An inline custom property outranks every stylesheet rule, so this pinned
  // Library's poster geometry at the desktop size on every screen.
  assert.doesNotMatch(libraryScreen, /--library-poster-width:\$\{/);
  assert.doesNotMatch(libraryScreen, /const posterWidth = 252/);
  assert.doesNotMatch(libraryScreen, /libraryStyle/);
  assert.match(
    componentsCss,
    /\.library-shell \{\s*\n\s*--library-poster-width: 252px;/,
    "the same values now live in CSS, where a breakpoint can reach them"
  );
});

test("rail prefetch measures the real gap instead of assuming the desktop one", async () => {
  // nearEndThreshold = (cardWidth + gap) * 4. With a hardcoded 24 the stride
  // was overstated on phones (real gap 12px), and compacting the cards shortened
  // the prefetch runway further.
  const home = await readFile(new URL("../screens/home/homeScreen.js", import.meta.url), "utf8");
  const collection = await readFile(
    new URL("../screens/collection/folderDetailScreen.js", import.meta.url),
    "utf8"
  );
  for (const [name, source] of [
    ["Home", home],
    ["Collection", collection]
  ]) {
    assert.match(
      source,
      /columnGap \|\| trackStyles\?\.gap \|\| "0"/,
      `${name} reads the computed gap`
    );
    assert.match(source, /nearEndThreshold = \(cardWidth \+ gap\) \* 4/, `${name} uses it`);
  }
  assert.doesNotMatch(home, /gapApprox/, "the assumed-gap constant is gone");
  assert.doesNotMatch(collection, /cardWidth \+ 24/, "the assumed-gap literal is gone");
});

test("Home rails match Search's pitch structurally, not by compensation", () => {
  // .home-poster-card / .home-poster-frame carried `border: 2px solid
  // transparent`, reserving 4px for a focus ring that is actually drawn with
  // box-shadow. That made Home's outer card wider and its artwork narrower than
  // Search's at the same token, so the rails never showed the same sliver of the
  // next card. Dropping the border on phone makes the two structurally equal.
  assert.match(
    desktopCss,
    /home-poster-card,[\s\S]{0,200}home-poster-frame \{[\s\S]{0,40}border-width: 0;/,
    "the reservation is removed rather than compensated for"
  );
  assert.doesNotMatch(
    desktopCss,
    /--browser-card-frame-inset/,
    "no compensation arithmetic remains anywhere"
  );
  // The frame was height-driven, which made artwork narrower than its card.
  assert.match(
    desktopCss,
    /home-poster-frame \{[\s\S]{0,40}height: auto;[\s\S]{0,40}aspect-ratio: 2 \/ 3;/
  );
});

test("phone standard media titles are one line with an ellipsis", () => {
  const block = desktopCss.slice(desktopCss.indexOf("One line plus ellipsis"));
  for (const prop of [
    "white-space: nowrap",
    "text-overflow: ellipsis",
    "min-height: 0",
    "-webkit-line-clamp: none"
  ]) {
    assert.ok(block.includes(prop), `${prop} is applied to phone card titles`);
  }
  // Every standard media surface, not just the one that was reported.
  for (const sel of [
    "home-poster-title",
    "search-result-name",
    "seeall-card-title",
    "library-grid-title",
    "detail-morelike-name"
  ]) {
    assert.ok(block.slice(0, 1400).includes(sel), `${sel} uses the one-line rule`);
  }
  assert.match(desktopCss, /--browser-card-meta-gap: \d+px;/, "year sits a token gap below");
});

test("More Like This is a standard portrait rail, the trailer rail is not", () => {
  // Detail's recommendation rail kept its own clamp(138px, 40vw, 164px) and so
  // missed the first migration entirely.
  assert.match(desktopCss, /detail-morelike-card[\s\S]{0,80}var\(--browser-card-standard/);
  assert.doesNotMatch(desktopCss, /width: clamp\(138px, 40vw, 164px\)/, "old literal is gone");
  // Trailers reuse the same track class for landscape cards and must be excluded.
  assert.match(desktopCss, /\.detail-morelike-track:not\(\.detail-trailer-track\)/);
  assert.match(
    desktopCss,
    /flex-basis: clamp\(240px, 70vw, 300px\)/,
    "trailer keeps its own width"
  );
});

test("landscape tiles share one radius with Continue Watching", () => {
  assert.equal(
    (desktopCss.match(/^\s*--browser-card-landscape-radius:/gm) || []).length,
    2,
    "declared once per phone breakpoint"
  );
  assert.match(
    desktopCss,
    /is-collection-landscape \{[\s\S]{0,140}--browser-card-landscape-radius/
  );
});

test("a rail and its heading are inset by the same token", () => {
  // Rails used to start at the screen edge while their heading started at the
  // gutter, so the first card never lined up with its section title.
  const inset = /var\(--browser-home-heading-inset, var\(--browser-page-gutter\)\)/g;
  assert.ok(
    (desktopCss.match(inset) || []).length >= 3,
    "heading padding, track padding and scroll padding all read the same inset"
  );
  // Portrait supplies the whole inset itself; landscape adds nothing because its
  // rows container already pads with the hero's own gutter.
  assert.match(
    desktopCss,
    /--browser-home-heading-inset: max\(16px, var\(--browser-safe-area-left\)\)/
  );
  assert.match(desktopCss, /--browser-home-heading-inset: 0px;/);
});

test("landscape Home rows do not re-apply the safe area the shell already applied", () => {
  // The landscape rows container pads itself with --browser-home-tablet-gutter,
  // the same token the hero copy uses. Adding env(safe-area-inset-left) on top
  // of that double-counted the notch: on a desktop emulator the inset is 0 so
  // the rows measured flush with the hero, but on a notched iPhone in landscape
  // it is ~44px and pushed every heading and first card that far inboard.
  const landscape = desktopCss.slice(
    desktopCss.indexOf(
      "@media (max-width: 1023px) and (max-height: 500px) and (orientation: landscape)"
    )
  );
  const block = landscape.slice(0, landscape.indexOf("}\n}") + 3);
  assert.match(block, /--browser-home-heading-inset: 0px;/, "landscape rows add nothing");
  assert.doesNotMatch(
    block,
    /--browser-home-heading-inset: var\(--browser-safe-area-left/,
    "the safe area is applied once, by the shell, not again by the rows"
  );
  // Portrait is a different structure -- its rows container has no inline
  // padding, so the heading inset is the only source there and must stay.
  assert.match(
    desktopCss,
    /--browser-home-heading-inset: max\(16px, var\(--browser-safe-area-left\)\)/
  );
});

test("a focused phone card keeps a visible ring even when the shadow is suppressed", () => {
  // The phone rules zero the card/frame border so Home's artwork matches
  // Search's. The focus ring normally comes from box-shadow -- but
  // `.performance-constrained` disables that with !important, and before this
  // the 2px border was the only thing left drawing a ring. Zeroing it removed
  // the focus indicator entirely on low-end devices.
  assert.match(
    desktopCss,
    /home-poster-card,[\s\S]{0,200}home-poster-frame \{[\s\S]{0,40}border-width: 0;/,
    "the phone border is zeroed"
  );
  const ring = desktopCss.match(
    /\.performance-constrained [^{]*home-poster-card\.focused[^{]*\{[^}]*\}/
  );
  assert.ok(ring, "a focused, performance-constrained card has its own rule");
  assert.match(ring[0], /outline: \d+px solid/, "the ring is an outline");
  // An outline paints outside the box, so it cannot change card width or pitch.
  // A border or padding here would reintroduce the Home/Search mismatch.
  assert.doesNotMatch(ring[0], /border-width|padding|margin/, "the ring must not affect layout");
});
