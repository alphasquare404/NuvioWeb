import assert from "node:assert/strict";
import test from "node:test";
import {
  beginOfflineMediaHandoff,
  buildOfflineProgressContext,
  deliverFileToDevice,
  isOfflineMediaHandoffSupported,
  resolveOfflineRuntimeMs
} from "./browserOfflineMediaHandoff.js";

function createBlob(size = 8, type = "") {
  const slices = [];
  const blob = {
    size,
    type,
    slice(start, end, sliceType) {
      slices.push({ start, end, sliceType });
      return { ...blob, type: sliceType, slices };
    },
    slices
  };
  return blob;
}

function createRuntime({ supportsDownload = true } = {}) {
  const created = [];
  const revoked = [];
  const timers = [];
  const appended = [];
  const anchors = [];
  const runtime = {
    crypto: { getRandomValues: (bytes) => bytes.fill(0xab) },
    location: { href: "https://nuviotest.alphasquare.my.id/library" },
    localStorage: (() => {
      const values = new Map();
      return {
        getItem: (key) => values.get(key) || null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key)
      };
    })(),
    URL: {
      createObjectURL: (blob) => {
        created.push(blob);
        return `blob:fake/${created.length}`;
      },
      revokeObjectURL: (url) => revoked.push(url)
    },
    setTimeout: (callback, delay) => timers.push({ callback, delay }),
    document: {
      body: { appendChild: (node) => appended.push(node) },
      createElement: () => {
        const anchor = {
          style: {},
          clicks: 0,
          removed: false,
          click() {
            this.clicks += 1;
          },
          remove() {
            this.removed = true;
          }
        };
        if (supportsDownload) anchor.download = "";
        anchors.push(anchor);
        return anchor;
      }
    }
  };
  return { runtime, created, revoked, timers, appended, anchors };
}

test("a browser without the download attribute is not offered the handoff", () => {
  assert.equal(isOfflineMediaHandoffSupported(createRuntime().runtime), true);
  assert.equal(
    isOfflineMediaHandoffSupported(createRuntime({ supportsDownload: false }).runtime),
    false
  );
  assert.equal(isOfflineMediaHandoffSupported({}), false);
});

test("the file is delivered under its readable name", () => {
  const { runtime, anchors } = createRuntime();
  assert.equal(
    deliverFileToDevice({
      blob: createBlob(),
      fileName: "Inception (2010).mp4",
      mimeType: "video/mp4",
      runtime
    }),
    true
  );
  assert.equal(anchors.at(-1).download, "Inception (2010).mp4");
  assert.equal(anchors.at(-1).clicks, 1);
});

// An OPFS file carries no media type, and the type is what decides whether iOS
// offers a video player at all -- a whole-blob slice re-labels it for free.
test("an untyped file is re-labelled without copying its bytes", () => {
  const { runtime, created } = createRuntime();
  const blob = createBlob(451_600_000, "");
  deliverFileToDevice({ blob, fileName: "clip.mp4", mimeType: "video/mp4", runtime });
  assert.deepEqual(blob.slices, [{ start: 0, end: 451_600_000, sliceType: "video/mp4" }]);
  assert.equal(created[0].type, "video/mp4");
});

test("a file already carrying the right type is passed straight through", () => {
  const { runtime, created } = createRuntime();
  const blob = createBlob(10, "video/mp4");
  deliverFileToDevice({ blob, fileName: "clip.mp4", mimeType: "video/mp4", runtime });
  assert.deepEqual(blob.slices, []);
  assert.equal(created[0], blob);
});

// Revoking as soon as the click returns cuts the transfer off mid-file: iOS is
// still reading the blob long after, and a 430MB file takes close to a minute.
test("the object URL outlives the click instead of being revoked immediately", () => {
  const { runtime, revoked, timers, anchors } = createRuntime();
  deliverFileToDevice({ blob: createBlob(), fileName: "clip.mp4", runtime });
  assert.deepEqual(revoked, []);
  assert.equal(anchors.at(-1).removed, false);
  assert.equal(timers[0].delay >= 30_000, true);
  timers[0].callback();
  assert.deepEqual(revoked, ["blob:fake/1"]);
  assert.equal(anchors.at(-1).removed, true);
});

test("nothing is delivered without a blob or a name", () => {
  const { runtime, anchors } = createRuntime();
  assert.equal(deliverFileToDevice({ blob: null, fileName: "clip.mp4", runtime }), false);
  assert.equal(deliverFileToDevice({ blob: createBlob(), fileName: "", runtime }), false);
  assert.equal(
    anchors.every((anchor) => anchor.clicks === 0),
    true
  );
});

test("a movie progress context points at the movie itself", () => {
  const context = buildOfflineProgressContext({
    contentType: "movie",
    mediaId: "tt1375666",
    title: "Inception",
    poster: "https://example.test/p.jpg"
  });
  assert.equal(context.itemId, "tt1375666");
  assert.equal(context.itemType, "movie");
  assert.equal(context.videoId, null);
  assert.equal(context.season, null);
  assert.equal(context.title, "Inception");
});

test("an episode progress context carries the series, season and episode", () => {
  const context = buildOfflineProgressContext({
    contentType: "episode",
    seriesId: "tt0903747",
    seriesTitle: "Breaking Bad",
    episodeId: "tt0903747:1:1",
    seasonNumber: 1,
    episodeNumber: 1,
    displaySnapshot: { episode: { title: "Pilot" } }
  });
  assert.equal(context.itemId, "tt0903747");
  assert.equal(context.itemType, "series");
  assert.equal(context.videoId, "tt0903747:1:1");
  assert.equal(context.season, 1);
  assert.equal(context.episode, 1);
  assert.equal(context.title, "Breaking Bad");
  assert.equal(context.episodeTitle, "Pilot");
});

test("a caller with better context overrides what the download record guessed", () => {
  const context = buildOfflineProgressContext(
    { contentType: "movie", mediaId: "fallback" },
    { itemId: "tt1375666", title: "Inception" }
  );
  assert.equal(context.itemId, "tt1375666");
  assert.equal(context.title, "Inception");
});

// A document handoff has no callback scheme of any kind, so if the handoff is
// not registered as manual the return prompt never appears and the watch is lost.
test("the handoff is registered as manual so the return prompt is the only report", () => {
  const { runtime } = createRuntime();
  const handoff = beginOfflineMediaHandoff({
    download: { contentType: "movie", mediaId: "tt1375666", title: "Inception" },
    profileId: "profile-1",
    runtime
  });
  assert.equal(handoff.automatic, false);
  assert.equal(handoff.progressMode, "manual");
  assert.equal(handoff.callbackCapable, false);
  assert.equal(handoff.manualPromptEligible, true);
  assert.equal(handoff.state, "manual-required");
  assert.equal(handoff.progressContext.itemId, "tt1375666");
});

test("a download with no identity registers no handoff rather than a broken one", () => {
  const { runtime } = createRuntime();
  assert.equal(beginOfflineMediaHandoff({ download: { contentType: "movie" }, runtime }), null);
});

test("a movie's runtime becomes the duration the manual prompt needs", () => {
  assert.equal(resolveOfflineRuntimeMs({ contentType: "movie", runtimeMinutes: 148 }), 8_880_000);
  assert.equal(
    resolveOfflineRuntimeMs({ contentType: "movie", displaySnapshot: { runtimeMinutes: 148 } }),
    8_880_000
  );
});

// A series record carries the show's runtime as well as the episode's, and the
// episode is the one actually on disk.
test("an episode prefers its own runtime over the series average", () => {
  assert.equal(
    resolveOfflineRuntimeMs({
      contentType: "episode",
      episodeRuntimeMinutes: 58,
      runtimeMinutes: 45
    }),
    3_480_000
  );
  assert.equal(
    resolveOfflineRuntimeMs({
      contentType: "episode",
      displaySnapshot: { episode: { runtimeMinutes: 58 }, runtimeMinutes: 45 }
    }),
    3_480_000
  );
});

test("an episode falls back to the series runtime when its own is missing", () => {
  assert.equal(resolveOfflineRuntimeMs({ contentType: "episode", runtimeMinutes: 45 }), 2_700_000);
});

test("a record with no runtime at all reports none rather than a bogus zero-length", () => {
  assert.equal(resolveOfflineRuntimeMs({}), 0);
  assert.equal(resolveOfflineRuntimeMs({ runtimeMinutes: 0 }), 0);
  assert.equal(resolveOfflineRuntimeMs({ runtimeMinutes: "not a number" }), 0);
});

// Without this the prompt shows "Runtime: Unknown", cannot bound what is typed,
// and the save is refused.
test("the handoff carries the runtime so the manual prompt can save a position", () => {
  const { runtime } = createRuntime();
  const handoff = beginOfflineMediaHandoff({
    download: {
      contentType: "episode",
      seriesId: "tt0306414",
      seriesTitle: "The Wire",
      episodeRuntimeMinutes: 59
    },
    runtime
  });
  assert.equal(handoff.knownDurationMs, 3_540_000);
});

test("a caller that knows the real duration is not overridden by the record", () => {
  const { runtime } = createRuntime();
  const handoff = beginOfflineMediaHandoff({
    download: { contentType: "movie", mediaId: "tt1375666", runtimeMinutes: 148 },
    knownDurationMs: 8_880_123,
    runtime
  });
  assert.equal(handoff.knownDurationMs, 8_880_123);
});
