import assert from "node:assert/strict";
import test from "node:test";
import { subtitleReleaseName } from "./subtitle.js";

// The one name a subtitle is known by, from the dialog that offers it through
// to the track list in the player.
//
// Four places used to answer this, each with a shorter fallback chain than the
// one before: the picker read fileName, filename, name and id; the repository
// dropped id; the download descriptor dropped name as well; and the stored
// offline record kept only the first two. The name did not fail to travel -- it
// was trimmed at every handover until nothing was left, which is why nine
// downloaded English subtitles for one episode all read identically.
//
// Reading the same four fields everywhere is the whole fix. `id` is included
// because addons routinely put the release there and nowhere else, and it is
// what the picker already showed when the subtitle was chosen.

const RELEASE = "[HI]The Wire SEASON 1, 1080p.BluRay.x265-RARBG [23.976 FPS]_1";

test("the release survives wherever the addon put it", () => {
  assert.equal(subtitleReleaseName({ fileName: RELEASE }), RELEASE);
  assert.equal(subtitleReleaseName({ filename: RELEASE }), RELEASE);
  assert.equal(subtitleReleaseName({ name: RELEASE }), RELEASE);
  assert.equal(subtitleReleaseName({ id: RELEASE }), RELEASE);
});

// The reported case: the release lives only in `id`, so every chain that
// stopped short of it stored an empty string and stored it faithfully.
test("an id-only subtitle is named rather than left blank", () => {
  assert.equal(subtitleReleaseName({ lang: "eng", id: RELEASE }), RELEASE);
});

test("the earlier fields win when more than one is present", () => {
  assert.equal(
    subtitleReleaseName({ fileName: "first", filename: "second", name: "third", id: "fourth" }),
    "first"
  );
  assert.equal(subtitleReleaseName({ name: "third", id: "fourth" }), "third");
});

// Two downloaded tracks for one title have to be told apart, which is the
// entire point of carrying the name.
test("two subtitles of the same language stay distinguishable", () => {
  const a = { lang: "eng", id: "The.Wire.S01E02.1080p.BluRay.x265-RARBG" };
  const b = { lang: "eng", id: "The.Wire.S01E02.720p.WEB-DL.x264-GROUP" };
  assert.notEqual(subtitleReleaseName(a), subtitleReleaseName(b));
});

test("whitespace around a name is not part of it", () => {
  assert.equal(subtitleReleaseName({ fileName: "  spaced  " }), "spaced");
});

// Nothing to go on stays empty, so callers can still decide what to show
// instead rather than being handed "undefined" to render.
test("a subtitle with no name at all is empty, never a stand-in", () => {
  assert.equal(subtitleReleaseName({ lang: "eng" }), "");
  assert.equal(subtitleReleaseName({}), "");
  assert.equal(subtitleReleaseName(), "");
  assert.equal(subtitleReleaseName(null), "");
});

// Numeric ids happen, and a number is still something to render.
test("a non-string field is read as text", () => {
  assert.equal(subtitleReleaseName({ id: 4321 }), "4321");
});
