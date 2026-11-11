import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
test("addon candidates are available to autoplay before badge images finish loading", async () => {
  const source = readFileSync(new URL("./streamScreen.js", import.meta.url), "utf8");
  const start = source.indexOf("  async loadStreams()"),
    body = source.slice(start, source.indexOf("\n  },", start) + 6);
  let releaseImages,
    releaseRepository,
    selectionCalls = 0;
  const row = { id: "a", addonName: "A", url: "https://fixture.test/a.mp4" };
  const ctx = vm.runInNewContext("({" + body + "})", {
    Set,
    Promise,
    normalizeType: (v) => v,
    StreamBadgeSettingsStore: { snapshot: () => ({ showAddonLogo: false }) },
    mergeStreamItems: (a, b) => [...a, ...b],
    flattenStreams: (r) => r.data.flatMap((g) => g.streams),
    preloadMatchedStreamBadgeImages: () =>
      new Promise((r) => {
        releaseImages = r;
      }),
    streamRepository: {
      getStreamsFromAllAddons(_t, _v, o) {
        o.onChunk({ status: "success", data: [{ addonName: "A", streams: [row] }] });
        return new Promise((r) => {
          releaseRepository = r;
        });
      }
    }
  });
  Object.assign(ctx, {
    params: { itemType: "movie", videoId: "tt1" },
    loadToken: 1,
    hasRenderedStreamRouteShell: true,
    buildPluginSourceChips: () => [],
    applyAddonLogos: (v) => v,
    maybeAutoResumeStream() {},
    maybeAutoPlayStream() {
      selectionCalls++;
    }
  });
  const pending = ctx.loadStreams();
  await Promise.resolve();
  assert.equal(ctx.streams[0].id, "a");
  assert.equal(selectionCalls, 1);
  ctx.loadToken++;
  releaseImages();
  releaseRepository({ status: "success", data: [] });
  await pending;
});
