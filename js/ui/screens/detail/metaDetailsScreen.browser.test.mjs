import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const metaDetailsScreenUrl = new URL("./metaDetailsScreen.js", import.meta.url);

async function metaDetailsScreenSource() {
  return readFile(metaDetailsScreenUrl, "utf8");
}

test("choosing a season redraws only what the season changes", async () => {
  // A full render restored the scroll from a value captured elsewhere -- zero --
  // so the page jumped to the top, and rebuilding the dropdown under the finger
  // that had just used it is the flash of it reappearing. The rail never did
  // either, so the select should not.
  const source = await metaDetailsScreenSource();

  assert.match(
    source,
    /this\.selectedSeason = season;\s*if \(!this\.refreshSeasonSelection\(\)\) \{\s*this\.render\(this\.meta, \{ selector: "\.series-season-select" \}\);/
  );
  // The three things a season owns: its label, its download action, its episodes.
  assert.match(
    source,
    /refreshSeasonSelection\(\) \{[\s\S]*?series-season-select-value[\s\S]*?series-season-download-row[\s\S]*?return this\.refreshEpisodeTrack\(\);/
  );
});
