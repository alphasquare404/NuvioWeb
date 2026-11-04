import assert from "node:assert/strict";
import test from "node:test";
import { findActiveCue, parseSubtitleText, parseSubtitleTimestamp } from "./subtitleTextParser.js";

test("timestamps are read in every shape the two formats use", () => {
  assert.equal(parseSubtitleTimestamp("00:00:01.500"), 1.5);
  assert.equal(parseSubtitleTimestamp("00:01:02,250"), 62.25);
  assert.equal(parseSubtitleTimestamp("01:00:00.000"), 3600);
  assert.equal(parseSubtitleTimestamp(" 00:00:03.000 "), 3);
  assert.equal(parseSubtitleTimestamp("not a time"), null);
  assert.equal(parseSubtitleTimestamp(""), null);
  assert.equal(parseSubtitleTimestamp(null), null);
});

test("a WebVTT file yields its cues in order", () => {
  const cues = parseSubtitleText(`WEBVTT

00:00:05.000 --> 00:00:07.500 align:start position:10%
Baris kedua

00:00:01.000 --> 00:00:04.000
Baris pertama
`);

  assert.deepEqual(cues, [
    { start: 1, end: 4, text: "Baris pertama" },
    { start: 5, end: 7.5, text: "Baris kedua" }
  ]);
});

test("an SRT file with index lines and commas parses the same way", () => {
  const cues = parseSubtitleText(`1
00:00:01,000 --> 00:00:02,000
Halo

2
00:00:02,500 --> 00:00:04,000
Dua baris
di sini
`);

  assert.deepEqual(cues, [
    { start: 1, end: 2, text: "Halo" },
    { start: 2.5, end: 4, text: "Dua baris\ndi sini" }
  ]);
});

test("markup and leaked ASS overrides never reach the screen", () => {
  const cues = parseSubtitleText(`1
00:00:01,000 --> 00:00:02,000
<i>miring</i> dan <c.yellow>kuning</c>

2
00:00:03,000 --> 00:00:04,000
{\\an8}di atas
`);

  assert.equal(cues[0].text, "miring dan kuning");
  assert.equal(cues[1].text, "di atas");
});

test("a broken block costs one cue, not the file", () => {
  const cues = parseSubtitleText(`1
00:00:05,000 --> 00:00:06,000
selamat

2
bukan waktu --> juga bukan

3
00:00:07,000 --> 00:00:08,000
sampai
`);

  assert.deepEqual(
    cues.map((cue) => cue.text),
    ["selamat", "sampai"]
  );
});

test("CRLF, a BOM, and an empty file are handled without ceremony", () => {
  const cues = parseSubtitleText("\uFEFF1\r\n00:00:01,000 --> 00:00:02,000\r\nbaris\r\n");
  assert.deepEqual(cues, [{ start: 1, end: 2, text: "baris" }]);
  assert.deepEqual(parseSubtitleText(""), []);
  assert.deepEqual(parseSubtitleText("WEBVTT\n\n"), []);
  assert.deepEqual(parseSubtitleText(null), []);
});

test("the active cue is found by time, including the boundaries", () => {
  const cues = [
    { start: 1, end: 2, text: "a" },
    { start: 5, end: 7, text: "b" }
  ];

  assert.equal(findActiveCue(cues, 1)?.text, "a");
  assert.equal(findActiveCue(cues, 1.5)?.text, "a");
  assert.equal(findActiveCue(cues, 2)?.text, "a");
  assert.equal(findActiveCue(cues, 3), null);
  assert.equal(findActiveCue(cues, 6.9)?.text, "b");
  assert.equal(findActiveCue(cues, 7.1), null);
  assert.equal(findActiveCue([], 1), null);
  assert.equal(findActiveCue(cues, Number.NaN), null);
});
