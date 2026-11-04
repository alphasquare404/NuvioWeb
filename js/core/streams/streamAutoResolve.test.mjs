import assert from "node:assert/strict";
import test from "node:test";
import {
  canSelectFromPartialList,
  reportAutoPlaySelection,
  streamSelectionDeadline,
  withinStreamSelectionDeadline,
  normalizeSelectionWaitSeconds,
  resolveAutoPlayStream,
  resolveHandoffReturnRoute,
  shouldAbandonAutoResolve,
  shouldPaintRouteHandoff
} from "./streamAutoResolve.js";

const FIRST_STREAM = { streamAutoPlayMode: "FIRST_STREAM", streamAutoPlayTimeoutSeconds: 5 };

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

test("a stalled addon cannot keep Finding stream beyond its deadline", async () => {
  let sendChunk;
  const result = await resolveAutoPlayStream({
    itemType: "movie",
    videoId: "tt1",
    settings: FIRST_STREAM,
    deadlineAt: Date.now() + 35,
    repository: {
      getStreamsFromAllAddons(type, id, options) {
        sendChunk = options.onChunk;
        options.onChunk({
          status: "success",
          data: groupFor([stream("Early", "https://a.test/early")])
        });
        return new Promise(() => {});
      }
    }
  });
  assert.equal(result.timedOut, false);
  assert.equal(result.selected?.url, "https://a.test/early");
  assert.equal(result.streams.length, 1);
  sendChunk({ status: "success", data: groupFor([stream("Late", "https://a.test/late")]) });
  assert.equal(result.streams.length, 1, "late chunks cannot mutate a finished attempt");
});

test("an eligible addon can start selection without waiting for a stalled addon", async () => {
  const result = await resolveAutoPlayStream({
    itemType: "movie",
    videoId: "tt1",
    settings: { ...FIRST_STREAM, streamAutoPlayTimeoutSeconds: 0 },
    returnOnFirstMatch: true,
    deadlineAt: Date.now() + 1000,
    repository: {
      getStreamsFromAllAddons(type, id, options) {
        options.onChunk({
          status: "success",
          data: groupFor([stream("First", "https://a.test/first")])
        });
        return new Promise(() => {});
      }
    }
  });
  assert.equal(result.selected.url, "https://a.test/first");
  assert.equal(result.complete, false);
});

test("selection phases share a deadline; Instant has a bounded discovery budget", async () => {
  assert.equal(streamSelectionDeadline(20, 1000), 21000);
  assert.equal(streamSelectionDeadline(0, 1000), 46000);
  assert.equal(streamSelectionDeadline(2147483647, 1000), Infinity);
  let called = false;
  const value = await withinStreamSelectionDeadline(
    () => {
      called = true;
    },
    Date.now() - 1,
    () => "timeout"
  );
  assert.equal(value, "timeout");
  assert.equal(called, false);
});

test("Instant starts source discovery rather than expiring at zero milliseconds", async () => {
  let calls = 0;
  const result = await resolveAutoPlayStream({
    itemType: "movie",
    videoId: "instant",
    settings: { ...FIRST_STREAM, streamAutoPlayTimeoutSeconds: 0 },
    returnOnFirstMatch: true,
    repository: {
      async getStreamsFromAllAddons(_t, _v, options) {
        calls++;
        const data = groupFor([stream("ready", "https://fixture.test/ready")]);
        options.onChunk({ status: "success", data });
        return { status: "success", data };
      }
    }
  });
  assert.equal(calls, 1);
  assert.equal(result.selected.url, "https://fixture.test/ready");
  assert.equal(result.timedOut, false);
});

test("Unlimited cannot release the initial page on a partial result even with returnOnFirstMatch", async () => {
  let complete,
    finished = false;
  const pending = resolveAutoPlayStream({
    itemType: "movie",
    videoId: "unlimited",
    settings: { ...FIRST_STREAM, streamAutoPlayTimeoutSeconds: 2147483647 },
    returnOnFirstMatch: true,
    repository: {
      getStreamsFromAllAddons(_t, _v, options) {
        options.onChunk({
          status: "success",
          data: groupFor([stream("first", "https://fixture.test/first")])
        });
        return new Promise((resolve) => {
          complete = resolve;
        });
      }
    }
  }).then((result) => {
    finished = true;
    return result;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  complete({
    status: "success",
    data: groupFor([
      stream("first", "https://fixture.test/first"),
      stream("last", "https://fixture.test/last")
    ])
  });
  const result = await pending;
  assert.equal(result.complete, true);
  assert.equal(result.streams.length, 2);
});

test("initial Instant compatibility selection keeps discovering after the first raw candidate is rejected", async () => {
  let push,
    complete,
    finished = false;
  const pending = resolveAutoPlayStream({
    itemType: "movie",
    videoId: "verified-partial",
    settings: { ...FIRST_STREAM, streamAutoPlayTimeoutSeconds: 0 },
    returnOnFirstMatch: true,
    repository: {
      getStreamsFromAllAddons(_t, _v, options) {
        push = options.onChunk;
        push({ status: "success", data: groupFor([stream("bad", "https://fixture.test/bad")]) });
        return new Promise((resolve) => {
          complete = resolve;
        });
      }
    },
    verifySelection: async (snapshot) => ({
      ...snapshot,
      selected: snapshot.streams.find((s) => s.url.endsWith("/good")) || null,
      probes: []
    })
  }).then((result) => {
    finished = true;
    return result;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  push({ status: "success", data: groupFor([stream("good", "https://fixture.test/good")]) });
  const result = await pending;
  assert.equal(result.selected.url, "https://fixture.test/good");
  assert.equal(result.complete, false);
  complete({ status: "success", data: [] });
});

test("Unlimited waits for the compatible complete revision and retains metadata handoff", async () => {
  let complete,
    finished = false;
  const pending = resolveAutoPlayStream({
    itemType: "movie",
    videoId: "verified-unlimited",
    settings: { ...FIRST_STREAM, streamAutoPlayTimeoutSeconds: 2147483647 },
    returnOnFirstMatch: true,
    repository: {
      getStreamsFromAllAddons(_t, _v, options) {
        options.onChunk({
          status: "success",
          data: groupFor([stream("first", "https://fixture.test/first")])
        });
        return new Promise((resolve) => {
          complete = resolve;
        });
      }
    },
    verifySelection: async (snapshot) => ({
      ...snapshot,
      selected: snapshot.streams.at(-1),
      probes: [["file-facts", { container: "mp4", videoCodec: "h264" }]]
    })
  }).then((result) => {
    finished = true;
    return result;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  complete({
    status: "success",
    data: groupFor([
      stream("first", "https://fixture.test/first"),
      stream("last", "https://fixture.test/last")
    ])
  });
  const result = await pending;
  assert.equal(result.selected.url, "https://fixture.test/last");
  assert.equal(result.complete, true);
  assert.equal(result.probes.length, 1);
});

test("a failed compatibility verifier does not spin or fall back to an unverified raw candidate", async () => {
  let calls = 0;
  const result = await resolveAutoPlayStream({
    itemType: "movie",
    videoId: "verification-failure",
    settings: { ...FIRST_STREAM, streamAutoPlayTimeoutSeconds: 0 },
    returnOnFirstMatch: true,
    repository: fakeRepository([[stream("raw", "https://fixture.test/raw")]]),
    verifySelection: async () => {
      calls++;
      throw Error("inspection failed");
    }
  });
  assert.equal(result.selected, null);
  assert.ok(calls <= 3);
});

test("Back aborts Unlimited selection promptly and late addon chunks cannot mutate the result", async () => {
  const controller = new AbortController();
  let push;
  const pending = resolveAutoPlayStream({
    itemType: "movie",
    videoId: "cancel",
    settings: { ...FIRST_STREAM, streamAutoPlayTimeoutSeconds: 2147483647 },
    signal: controller.signal,
    repository: {
      getStreamsFromAllAddons(_t, _v, o) {
        push = o.onChunk;
        return new Promise(() => {});
      }
    }
  });
  await new Promise((r) => setImmediate(r));
  controller.abort();
  const result = await pending;
  assert.equal(result.cancelled, true);
  push({ status: "success", data: groupFor([stream("late", "https://fixture.test/late")]) });
  assert.equal(result.streams.length, 0);
});
test("an already cancelled search never starts source discovery", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const result = await resolveAutoPlayStream({
    itemType: "movie",
    videoId: "cancelled",
    settings: FIRST_STREAM,
    signal: controller.signal,
    repository: {
      getStreamsFromAllAddons() {
        calls++;
      }
    }
  });
  assert.equal(calls, 0);
  assert.equal(result.cancelled, true);
});
test("fresh addon manifests preserve the allowed-addon scope when the initial cache was empty", async () => {
  const result = await resolveAutoPlayStream({
    itemType: "movie",
    videoId: "fresh",
    settings: {
      ...FIRST_STREAM,
      streamAutoPlaySource: "INSTALLED_ADDONS_ONLY",
      streamAutoPlaySelectedAddons: ["A"]
    },
    installedAddonNames: new Set(),
    repository: {
      async getStreamsFromAllAddons(_t, _v, o) {
        o.onAddon({ displayName: "A" });
        o.onAddon({ displayName: "B" });
        return {
          status: "success",
          data: [
            { addonName: "B", streams: [{ url: "https://fixture.test/b" }] },
            { addonName: "A", streams: [{ url: "https://fixture.test/a" }] }
          ]
        };
      }
    }
  });
  assert.equal(result.selected.addonName, "A");
});
test("selection diagnostics exclude source URLs, credentials, regex and raw exception text", (t) => {
  const logs = [];
  t.mock.method(console, "warn", (s) => logs.push(s));
  reportAutoPlaySelection(
    "detail",
    {
      reason: "error",
      streams: [{ url: "https://secret.test/?token=private" }],
      error: new Error("private")
    },
    { streamAutoPlayTimeoutSeconds: 3, streamAutoPlayRegex: "secret-regex" }
  );
  assert.equal(logs.length, 1);
  assert.match(logs[0], /selection-finished/);
  assert.doesNotMatch(logs[0], /secret|private|token/);
});
