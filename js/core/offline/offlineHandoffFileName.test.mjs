import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOfflineHandoffFileName,
  buildOfflineHandoffSubtitleFileName,
  resolveOfflineHandoffContainer,
  resolveOfflineSubtitleContainer
} from "./offlineHandoffFileName.js";

const MOVIE = {
  contentType: "movie",
  title: "Inception",
  year: "2010",
  mimeType: "video/mp4"
};

const EPISODE = {
  contentType: "episode",
  seriesTitle: "Breaking Bad",
  title: "Pilot",
  year: "2008",
  seasonNumber: 1,
  episodeNumber: 1,
  mimeType: "video/mp4",
  displaySnapshot: { title: "Breaking Bad", episode: { title: "Pilot" } }
};

test("a movie is named title and year", () => {
  assert.equal(buildOfflineHandoffFileName(MOVIE), "Inception (2010).mp4");
});

test("an episode carries series, year, season/episode and episode title", () => {
  assert.equal(buildOfflineHandoffFileName(EPISODE), "Breaking Bad (2008) - S01E01 - Pilot.mp4");
});

test("season and episode numbers are padded so a file list sorts correctly", () => {
  const name = buildOfflineHandoffFileName({ ...EPISODE, seasonNumber: 2, episodeNumber: 7 });
  assert.match(name, /- S02E07 -/);
});

test("numbers past ten are not truncated by the padding", () => {
  const name = buildOfflineHandoffFileName({ ...EPISODE, seasonNumber: 12, episodeNumber: 134 });
  assert.match(name, /- S12E134 -/);
});

test("a year is taken out of a range, because a series record carries one", () => {
  const name = buildOfflineHandoffFileName({
    ...EPISODE,
    year: "",
    displaySnapshot: { ...EPISODE.displaySnapshot, yearRange: "2008-2013" }
  });
  assert.match(name, /^Breaking Bad \(2008\) -/);
});

test("a missing year drops the parentheses rather than printing an empty pair", () => {
  assert.equal(buildOfflineHandoffFileName({ ...MOVIE, year: "" }), "Inception.mp4");
});

// A name that ends up as "S01E04 - Episode 4" reads like a bug, and the download
// record really does fall back to that when no title was ever resolved.
test("a placeholder episode title is dropped instead of repeating the number", () => {
  const name = buildOfflineHandoffFileName({
    ...EPISODE,
    title: "Episode 4",
    episodeNumber: 4,
    displaySnapshot: { title: "Breaking Bad", episode: {} }
  });
  assert.equal(name, "Breaking Bad (2008) - S01E04.mp4");
});

test("a real title that merely starts with the word episode is kept", () => {
  const name = buildOfflineHandoffFileName({
    ...EPISODE,
    episodeNumber: 4,
    displaySnapshot: { title: "Breaking Bad", episode: { title: "Episode IV: A New Hope" } }
  });
  assert.match(name, /- S01E04 - Episode IV A New Hope\.mp4$/);
});

// The whole point of naming the file is that it survives the trip into another
// app; a slash or a colon would make it unopenable or silently renamed there.
test("characters that filesystems reject are removed", () => {
  const name = buildOfflineHandoffFileName({
    ...MOVIE,
    title: 'Face/Off: "Director\\s Cut" <2|3> ?*'
  });
  assert.equal(/[/\\:*?"<>|]/.test(name), false);
  assert.match(name, /^Face Off/);
});

test("a name never ends in a dot or space before its extension", () => {
  const name = buildOfflineHandoffFileName({ ...MOVIE, title: "Movie Title. ", year: "" });
  assert.equal(name, "Movie Title.mp4");
});

test("a title long enough to break a filesystem is capped", () => {
  const name = buildOfflineHandoffFileName({ ...MOVIE, title: "A".repeat(400) });
  assert.equal(name.length <= 160, true);
  assert.match(name, /\.mp4$/);
});

test("an empty record still produces an openable name", () => {
  assert.equal(buildOfflineHandoffFileName({}), "Video.mp4");
});

// iOS appends the media type's own extension when the name disagrees with it,
// which is how a file arrived as "The Detail.mkv.mp4". One source of truth for
// both is the fix, and the recorded type is the one the app already plays with.
test("the extension follows the recorded media type so the two cannot disagree", () => {
  assert.deepEqual(resolveOfflineHandoffContainer({ mimeType: "video/x-matroska" }), {
    extension: "mkv",
    mimeType: "video/x-matroska"
  });
  assert.match(buildOfflineHandoffFileName({ ...MOVIE, mimeType: "video/x-matroska" }), /\.mkv$/);
});

test("a source filename's own extension never overrides the media type", () => {
  const name = buildOfflineHandoffFileName({
    ...MOVIE,
    filename: "Inception.2010.1080p.mkv",
    mimeType: "video/mp4"
  });
  assert.equal(name, "Inception (2010).mp4");
});

test("an unknown mime type falls back to a matching pair, not a mismatched one", () => {
  assert.deepEqual(resolveOfflineHandoffContainer({ mimeType: "application/octet-stream" }), {
    extension: "mp4",
    mimeType: "video/mp4"
  });
  assert.deepEqual(resolveOfflineHandoffContainer({}), { extension: "mp4", mimeType: "video/mp4" });
});

// A player pairs a sidecar with a video by filename, so the two have to match
// exactly apart from the language tag and the extension.
test("a subtitle is named after its video so a player pairs them itself", () => {
  assert.equal(
    buildOfflineHandoffSubtitleFileName(MOVIE, { lang: "Indonesian", extension: "srt" }),
    "Inception (2010).Indonesian.srt"
  );
  assert.equal(
    buildOfflineHandoffSubtitleFileName(EPISODE, { lang: "en", extension: "vtt" }),
    "Breaking Bad (2008) - S01E01 - Pilot.en.vtt"
  );
});

test("a subtitle without a language keeps the bare video name", () => {
  assert.equal(buildOfflineHandoffSubtitleFileName(MOVIE, {}), "Inception (2010).srt");
});

// The record stores an .srt as "text/plain", and iOS would turn that name into
// ".srt.txt" -- at which point the player stops finding it.
test("a subtitle's extension and media type name the same format", () => {
  assert.deepEqual(resolveOfflineSubtitleContainer({ extension: "vtt" }), {
    extension: "vtt",
    mimeType: "text/vtt"
  });
  assert.deepEqual(resolveOfflineSubtitleContainer({ extension: "srt" }), {
    extension: "srt",
    mimeType: "application/x-subrip"
  });
  assert.notEqual(resolveOfflineSubtitleContainer({ extension: "srt" }).mimeType, "text/plain");
});

test("an unrecognised subtitle format falls back to a matching pair", () => {
  assert.deepEqual(resolveOfflineSubtitleContainer({ extension: "ass" }), {
    extension: "srt",
    mimeType: "application/x-subrip"
  });
  assert.deepEqual(resolveOfflineSubtitleContainer({}), {
    extension: "srt",
    mimeType: "application/x-subrip"
  });
});
