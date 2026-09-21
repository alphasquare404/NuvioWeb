import assert from "node:assert/strict";
import test from "node:test";
import { canOfferOfflineSubtitleHandoff } from "./browserOfflinePlaybackChoice.js";
import { deliverPreparedOfflineFile } from "./browserOfflineMediaHandoff.js";

// The Detail hero and the stream list both decide whether to show the button.
// Keeping the question in one pure place is what stops them drifting apart.
function runtimeWith({ supportsDownload = true } = {}) {
  return {
    URL: { createObjectURL: () => "blob:x" },
    document: {
      createElement: () => (supportsDownload ? { download: "" } : {})
    }
  };
}

test("a download with a subtitle on disk is offered", () => {
  assert.equal(canOfferOfflineSubtitleHandoff([{ subtitleId: "sub-1" }], runtimeWith()), true);
});

test("a download with no subtitle is not offered", () => {
  assert.equal(canOfferOfflineSubtitleHandoff([], runtimeWith()), false);
  assert.equal(canOfferOfflineSubtitleHandoff(null, runtimeWith()), false);
  assert.equal(canOfferOfflineSubtitleHandoff(undefined, runtimeWith()), false);
});

// A record without an id cannot be fetched back out of the store, so a button
// built from one would open a sheet with nothing in it.
test("records missing an id do not count as something to send", () => {
  assert.equal(canOfferOfflineSubtitleHandoff([{ lang: "en" }, {}], runtimeWith()), false);
  assert.equal(
    canOfferOfflineSubtitleHandoff([{ lang: "en" }, { subtitleId: "sub-2" }], runtimeWith()),
    true
  );
});

test("a browser that cannot hand files over is never offered the button", () => {
  assert.equal(
    canOfferOfflineSubtitleHandoff(
      [{ subtitleId: "sub-1" }],
      runtimeWith({ supportsDownload: false })
    ),
    false
  );
  assert.equal(canOfferOfflineSubtitleHandoff([{ subtitleId: "sub-1" }], {}), false);
});

// The dialog closed onto nothing because the file was still being read out of
// IndexedDB and OPFS when the tap's permission to open a sheet had already
// lapsed. Delivery has to be callable straight from a click handler.
test("delivering a prepared file is synchronous, not a promise", () => {
  const clicks = [];
  const runtime = {
    URL: { createObjectURL: () => "blob:x", revokeObjectURL: () => {} },
    setTimeout: () => {},
    document: {
      body: { appendChild: () => {} },
      createElement: () => ({
        style: {},
        download: "",
        click() {
          clicks.push(this.download);
        },
        remove() {}
      })
    }
  };
  const result = deliverPreparedOfflineFile(
    { blob: { size: 10, type: "" }, fileName: "Movie.en.srt", mimeType: "application/x-subrip" },
    runtime
  );
  assert.equal(result, true);
  assert.equal(typeof result.then, "undefined");
  assert.deepEqual(clicks, ["Movie.en.srt"]);
});

test("an entry that was never prepared delivers nothing rather than half of one", () => {
  assert.equal(deliverPreparedOfflineFile(null), false);
  assert.equal(deliverPreparedOfflineFile({ fileName: "Movie.en.srt" }), false);
  assert.equal(deliverPreparedOfflineFile({ blob: { size: 1 } }), false);
});
