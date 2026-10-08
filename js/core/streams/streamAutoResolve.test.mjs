import assert from "node:assert/strict";
import test from "node:test";
import {
  canSelectFromPartialList,
  normalizeSelectionWaitSeconds,
  resolveAutoPlayStream,
  resolveHandoffReturnRoute,
  shouldAbandonAutoResolve,
  shouldPaintRouteHandoff
} from "./streamAutoResolve.js";

const FIRST_STREAM = { streamAutoPlayMode: "FIRST_STREAM", streamAutoPlayTimeoutSeconds: 0 };

function stream(name, url) {
  return { name, title: name, url, addonName: "Addon" };
}

function groupFor(streams) {
  return [{ addonName: "Addon", streams }];
}

// A repository that hands out chunks the way the real one does, then resolves
// with the whole result.
function fakeRepository(chunks) {
  return {
    async getStreamsFromAllAddons(type, videoId, options) {
      for (const chunk of chunks) {
        options?.onChunk?.({ status: "success", data: groupFor(chunk) });
        await Promise.resolve();
      }
      return { status: "success", data: groupFor(chunks.flat()) };
    }
  };
}

test("auto-play off resolves to nothing and fetches nothing", async () => {
  let called = false;
  const result = await resolveAutoPlayStream({
    itemType: "movie",
    videoId: "tt1",
    settings: { streamAutoPlayMode: "MANUAL" },
    repository: {
      async getStreamsFromAllAddons() {
        called = true;
        return { status: "success", data: [] };
      }
    }
  });
  assert.equal(result.selected, null);
  assert.equal(result.reason, "disabled");
  assert.equal(called, false, "a disabled setting must not reach the network");
});

test("the first matching stream wins as soon as it arrives", async () => {
  const result = await resolveAutoPlayStream({
    itemType: "movie",
    videoId: "tt1",
    settings: FIRST_STREAM,
    repository: fakeRepository([
      [stream("One 1080p", "https://a.example/1")],
      [stream("Two 1080p", "https://a.example/2")]
    ])
  });
  assert.equal(result.reason, "selected");
  assert.equal(result.selected.url, "https://a.example/1");
  // Everything fetched comes back regardless, so the caller never fetches twice.
  assert.equal(result.streams.length, 2);
});

test("nothing matching still returns the whole list for the screen to show", async () => {
  const result = await resolveAutoPlayStream({
    itemType: "movie",
    videoId: "tt1",
    settings: { streamAutoPlayMode: "REGEX_MATCH", streamAutoPlayRegex: "2160p" },
    repository: fakeRepository([[stream("One 1080p", "https://a.example/1")]])
  });
  assert.equal(result.selected, null);
  assert.equal(result.reason, "no-match");
  assert.equal(result.streams.length, 1, "the fetch is not wasted");
});

test("a grace period keeps a partial list from deciding too early", async () => {
  // Wait is five seconds and the clock never advances, so no chunk may decide.
  // The complete list still decides, because the grace period is about waiting
  // for better sources, not about refusing to choose at all.
  const result = await resolveAutoPlayStream({
    itemType: "movie",
    videoId: "tt1",
    settings: { ...FIRST_STREAM, streamAutoPlayTimeoutSeconds: 5 },
    now: () => 1000,
    repository: fakeRepository([
      [stream("Early", "https://a.example/early")],
      [stream("Late", "https://a.example/late")]
    ])
  });
  assert.equal(result.reason, "selected");
  assert.equal(result.selected.url, "https://a.example/early");
  assert.equal(result.streams.length, 2);
});

test("the wait sentinel means only a complete list may decide", () => {
  assert.equal(canSelectFromPartialList({ waitSeconds: 0 }), true);
  assert.equal(canSelectFromPartialList({ waitSeconds: 3, elapsedMs: 0 }), false);
  assert.equal(canSelectFromPartialList({ waitSeconds: 3, elapsedMs: 3000 }), true);
  // The stream screen's own "never choose early" value.
  assert.equal(canSelectFromPartialList({ waitSeconds: 2147483647, elapsedMs: 1e12 }), false);
  assert.equal(normalizeSelectionWaitSeconds("4"), 4);
  assert.equal(normalizeSelectionWaitSeconds(-2), 0);
  assert.equal(normalizeSelectionWaitSeconds(null), 0);
});

test("a cancelled resolution chooses nothing, however good the match", async () => {
  const result = await resolveAutoPlayStream({
    itemType: "movie",
    videoId: "tt1",
    settings: FIRST_STREAM,
    shouldCancel: () => true,
    repository: fakeRepository([[stream("One 1080p", "https://a.example/1")]])
  });
  assert.equal(result.cancelled, true);
  assert.equal(result.selected, null);
});

test("a failed fetch is reported, not thrown", async () => {
  const result = await resolveAutoPlayStream({
    itemType: "movie",
    videoId: "tt1",
    settings: FIRST_STREAM,
    repository: {
      async getStreamsFromAllAddons() {
        throw new Error("addon exploded");
      }
    }
  });
  assert.equal(result.reason, "error");
  assert.equal(result.selected, null);
  // The caller falls back to the stream screen, which reports errors the way it
  // always has; throwing here would take the screen down instead.
  assert.equal(result.error.message, "addon exploded");
});

test("no target is not a fetch", async () => {
  for (const params of [
    { itemType: "", videoId: "tt1" },
    { itemType: "movie", videoId: "" }
  ]) {
    const result = await resolveAutoPlayStream({
      ...params,
      settings: FIRST_STREAM,
      repository: {
        async getStreamsFromAllAddons() {
          throw new Error("must not be called");
        }
      }
    });
    assert.equal(result.reason, "no-target");
  }
});

test("an answer still belongs to the page that is still asking", () => {
  assert.equal(
    shouldAbandonAutoResolve({ startedToken: 3, currentToken: 3, currentRoute: "detail" }),
    false
  );
});

test("a newer resolve abandons the older one", () => {
  // Tapping a second episode while the first is still resolving. The first
  // answer may arrive later and must not open a player for it.
  assert.equal(
    shouldAbandonAutoResolve({ startedToken: 3, currentToken: 4, currentRoute: "detail" }),
    true
  );
});

test("leaving the detail screen abandons the answer", () => {
  // Whatever the person went on to do, a stream chosen for the title they
  // walked away from must never take over.
  for (const route of ["home", "stream", "player", "library", "", null, undefined]) {
    assert.equal(
      shouldAbandonAutoResolve({ startedToken: 3, currentToken: 3, currentRoute: route }),
      true,
      `route ${String(route)} must not keep the answer alive`
    );
  }
});

test("not knowing where it is counts as abandoned", () => {
  // Fail safe rather than fail silent: a caller that reports nothing loses its
  // answer instead of acting on one it cannot vouch for.
  assert.equal(shouldAbandonAutoResolve(), true);
  assert.equal(shouldAbandonAutoResolve({}), true);
});

test("Continue Watching gets a waiting screen instead of the detail page", () => {
  assert.equal(shouldPaintRouteHandoff({ autoOpenContinueWatching: true, isBrowser: true }), true);
});

test("a television keeps its page, because the waiting screen has no styles there", () => {
  // The styles sit behind `.desktop-browser`, which every browser carries and
  // no television does. Hiding the page there would swap it for unstyled
  // markup -- worse than the screen this avoids.
  assert.equal(
    shouldPaintRouteHandoff({ autoOpenContinueWatching: true, isBrowser: false }),
    false
  );
  assert.equal(shouldPaintRouteHandoff({ autoOpenContinueWatching: true }), false);
});

test("coming back from the player shows the page, never the waiting screen", () => {
  // The player returns to this same route, and that time the page is where the
  // person meant to land. Holding it back would strand them on a spinner with
  // nothing coming and nothing on it to press.
  assert.equal(
    shouldPaintRouteHandoff({
      autoOpenContinueWatching: true,
      isBackNavigation: true,
      isBrowser: true
    }),
    false
  );
});

test("every other way into detail still paints detail", () => {
  // Opening a title from Home, Search or a collection asks for this page. Only
  // the Continue Watching route is passing through it.
  assert.equal(
    shouldPaintRouteHandoff({ autoOpenContinueWatching: false, isBrowser: true }),
    false
  );
  assert.equal(shouldPaintRouteHandoff({}), false);
  assert.equal(shouldPaintRouteHandoff(), false);
});

test("nothing selected automatically keeps the picker as the place Back returns to", () => {
  // The requirement this exists to protect: when auto selection finds nothing,
  // the stream list is what the person was shown and what they may want again.
  assert.equal(resolveHandoffReturnRoute({ handedOff: false }), "stream");
  assert.equal(
    resolveHandoffReturnRoute({ handedOff: false, continueWatchingBackHome: true }),
    "stream"
  );
  assert.equal(resolveHandoffReturnRoute({}), "stream");
  assert.equal(resolveHandoffReturnRoute(), "stream");
});

test("a handoff from Continue Watching returns Home", () => {
  // Its Detail was replaced on the way in, so there is no Detail entry left.
  assert.equal(
    resolveHandoffReturnRoute({ handedOff: true, continueWatchingBackHome: true }),
    "home"
  );
});

test("a handoff from the detail page returns to the detail page", () => {
  assert.equal(resolveHandoffReturnRoute({ handedOff: true }), "detail");
  assert.equal(
    resolveHandoffReturnRoute({ handedOff: true, continueWatchingBackHome: false }),
    "detail"
  );
});
