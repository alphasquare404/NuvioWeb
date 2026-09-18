import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { patchContinueWatchingDisplayProgress } from "./continueWatchingProgressPatch.js";

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("./homeScreen.js", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  plugins: [
    {
      name: "isolate-home-router",
      setup(buildApi) {
        buildApi.onResolve({ filter: /navigation\/router\.js$/ }, () => ({
          path: "router",
          namespace: "test"
        }));
        buildApi.onLoad({ filter: /.*/, namespace: "test" }, () => ({
          contents: "export const Router = {};"
        }));
      }
    }
  ]
});
const { renderContinueWatchingSection } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`
);
const episode = {
  contentId: "tt-test",
  contentType: "series",
  season: 1,
  episode: 2,
  title: "Example",
  durationMs: 100000
};

test("Next Up and unstarted cards omit the progress track in every card style", () => {
  for (const cardStyle of ["card", "wide", "poster"]) {
    for (const progress of [
      { isNextUp: true, positionMs: 0 },
      { isNextUp: true, progressPercent: 90, positionMs: 90000 },
      { positionMs: 0 },
      { durationMs: 0, positionMs: 10000 },
      { durationMs: 0, progressPercent: "invalid" }
    ]) {
      assert.doesNotMatch(
        renderContinueWatchingSection([{ ...episode, ...progress }], { cardStyle }),
        /class="home-continue-progress"/
      );
    }
  }
});

test("cards use updated playback position before an older provider percentage", () => {
  const displayed = [{ ...episode, positionMs: 10000, progressPercent: 10 }];
  const updated = patchContinueWatchingDisplayProgress(displayed, {
    ...episode,
    positionMs: 50000
  });
  assert.match(renderContinueWatchingSection(updated), /width:50%/);
  assert.doesNotMatch(renderContinueWatchingSection(updated), /width:10%/);
  assert.match(
    renderContinueWatchingSection([{ ...episode, durationMs: 0, progressPercent: 25 }]),
    /width:25%/
  );
});
