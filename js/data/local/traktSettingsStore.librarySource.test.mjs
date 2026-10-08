import assert from "node:assert/strict";
import test from "node:test";

// The store reaches localStorage through LocalStore, which swallows a failure
// and returns the default -- so without a stub the value never persists, the
// "did it change?" guard never sees a change, and the notification path under
// test is never reached.
const entries = new Map();
globalThis.localStorage = {
  getItem: (key) => (entries.has(key) ? entries.get(key) : null),
  setItem: (key, value) => entries.set(key, String(value)),
  removeItem: (key) => entries.delete(key),
  clear: () => entries.clear()
};

const { TraktSettingsStore, TraktLibrarySourceMode } = await import("./traktSettingsStore.js");

function startFrom(mode) {
  TraktSettingsStore.setLibrarySourceMode(mode);
  assert.equal(TraktSettingsStore.get().librarySourceMode, mode, "test setup did not persist");
}

test("changing the library source tells every screen listening for it", () => {
  startFrom(TraktLibrarySourceMode.TRAKT);

  // Library, Detail, the desktop hover preview, Search and Catalog each
  // subscribe and re-read only when told to. The call to notify them existed
  // with no function behind it, so this threw after persisting: the value
  // changed and not one screen heard about it.
  const heard = [];
  const unsubscribe = [
    TraktSettingsStore.subscribeLibrarySource(() => heard.push("library")),
    TraktSettingsStore.subscribeLibrarySource(() => heard.push("detail")),
    TraktSettingsStore.subscribeLibrarySource(() => heard.push("search"))
  ];

  const next = TraktSettingsStore.setLibrarySourceMode(TraktLibrarySourceMode.LOCAL);

  assert.equal(next.librarySourceMode, TraktLibrarySourceMode.LOCAL);
  assert.deepEqual(heard.sort(), ["detail", "library", "search"]);

  unsubscribe.forEach((off) => off());
});

test("one failing screen does not swallow the change for the others", () => {
  startFrom(TraktLibrarySourceMode.LOCAL);

  const heard = [];
  const offs = [
    TraktSettingsStore.subscribeLibrarySource(() => heard.push("before")),
    TraktSettingsStore.subscribeLibrarySource(() => {
      throw new Error("this screen is mid-teardown");
    }),
    TraktSettingsStore.subscribeLibrarySource(() => heard.push("after"))
  ];

  // The throw is reported, not propagated: a screen that fails while being torn
  // down must not cost the remaining screens their refresh, and must not throw
  // back into the caller that only wanted to change a setting.
  assert.doesNotThrow(() => TraktSettingsStore.setLibrarySourceMode(TraktLibrarySourceMode.TRAKT));
  assert.deepEqual(heard, ["before", "after"]);

  offs.forEach((off) => off());
});

test("re-choosing the source already in use notifies nobody", () => {
  startFrom(TraktLibrarySourceMode.TRAKT);

  let notified = 0;
  const off = TraktSettingsStore.subscribeLibrarySource(() => {
    notified += 1;
  });

  // Selecting the active option is not a change, and five screens re-reading
  // their data for it would be work nobody asked for.
  TraktSettingsStore.setLibrarySourceMode(TraktLibrarySourceMode.TRAKT);
  assert.equal(notified, 0);

  off();
});

test("an unsubscribed screen stops hearing about it", () => {
  startFrom(TraktLibrarySourceMode.TRAKT);

  let notified = 0;
  const off = TraktSettingsStore.subscribeLibrarySource(() => {
    notified += 1;
  });
  off();

  TraktSettingsStore.setLibrarySourceMode(TraktLibrarySourceMode.LOCAL);
  assert.equal(notified, 0, "a torn-down screen must not be called back");
});
