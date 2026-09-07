import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserOfflineSubtitleSnapshot } from "./browserOfflineSubtitlePicker.js";

test("shared offline subtitle picker snapshot keeps distinct releases and dedupes a repeated release", () => {
  const snapshot = createBrowserOfflineSubtitleSnapshot([
    { id: "one", addonName: "A", lang: "eng", fileName: "Release.One.srt", url: "https://subs.example/one.srt?token=a" },
    { id: "two", addonName: "A", lang: "eng", fileName: "Release.Two.srt", url: "https://subs.example/two.srt?token=b" },
    { id: "one", addonName: "A", lang: "eng", fileName: "Release.One.srt", url: "https://subs.example/one.srt?token=c" }
  ]);
  assert.equal(snapshot.length, 2);
  assert.deepEqual(snapshot.map((entry) => entry.language), ["English", "English"]);
});
