import assert from "node:assert/strict";
import test from "node:test";

// The module reads settings through the resolver, and the resolver reads the
// profile store, so the storage shim goes up before either is imported.
const values = new Map();
globalThis.localStorage = {
  getItem: (key) => (values.has(key) ? values.get(key) : null),
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
  clear: () => values.clear()
};

const { resolveExternalHandoffMediaUrl } = await import("./externalHandoffMediaUrl.js");
const { DirectDebridResolver } = await import("../../core/debrid/directDebridResolver.js");

// Only the three calls the handoff makes. Each test says what the provider
// would answer and counts what was actually asked of it.
function stubResolver({ canResolve = false, cached = null, resolved = null } = {}) {
  const calls = { canResolve: 0, cached: 0, resolve: 0 };
  DirectDebridResolver.canResolveStream = () => {
    calls.canResolve += 1;
    return canResolve;
  };
  DirectDebridResolver.cachedPlayableStream = () => {
    calls.cached += 1;
    return cached;
  };
  DirectDebridResolver.resolve = async () => {
    calls.resolve += 1;
    return resolved || { status: "error" };
  };
  return calls;
}

const PLAYABLE = "https://debrid.example/stream/file.mkv";

test("a stream that already carries a link is handed over as it is", async () => {
  const calls = stubResolver({ canResolve: true });
  const url = await resolveExternalHandoffMediaUrl({ url: PLAYABLE });
  assert.equal(url, PLAYABLE);
  assert.equal(calls.resolve, 0, "and the provider is not asked for what we already have");
});

// The reported fault. A cached debrid torrent -- the card reads "TB Instant" --
// reaches this point with an info hash and no link, because the link is only
// created when the provider is asked. The external route used to read the empty
// URL, build no launch, and fall back to the internal player, so the
// external/internal setting looked ignored for exactly these streams.
test("a debrid stream with no link yet is resolved before the handoff", async () => {
  const calls = stubResolver({
    canResolve: true,
    resolved: { status: "success", stream: { url: PLAYABLE } }
  });
  const url = await resolveExternalHandoffMediaUrl({
    infoHash: "86028e872ea55dbd9e6d09464ec45a27fb9daa71",
    name: "4K TB Instant"
  });
  assert.equal(url, PLAYABLE, "the external player gets a link, not an empty string");
  assert.equal(calls.resolve, 1);
});

test("an already-resolved link is reused without asking the provider again", async () => {
  const calls = stubResolver({ canResolve: true, cached: { url: PLAYABLE } });
  const url = await resolveExternalHandoffMediaUrl({ infoHash: "abc" });
  assert.equal(url, PLAYABLE);
  assert.equal(calls.resolve, 0, "preparation already paid for this one");
});

// A magnet is a torrent, not something an external player can fetch, so it
// counts as no link at all rather than as one worth handing over.
test("a magnet is not treated as a link", async () => {
  const calls = stubResolver({
    canResolve: true,
    resolved: { status: "success", stream: { url: PLAYABLE } }
  });
  const url = await resolveExternalHandoffMediaUrl({ url: "magnet:?xt=urn:btih:abc" });
  assert.equal(url, PLAYABLE);
  assert.equal(calls.resolve, 1, "it is resolved rather than passed on");
});

test("a stream no provider can resolve hands over nothing", async () => {
  const calls = stubResolver({ canResolve: false });
  assert.equal(await resolveExternalHandoffMediaUrl({ infoHash: "abc" }), "");
  assert.equal(calls.resolve, 0);
});

// Nothing is reported here. Returning "" sends the caller to the internal
// player, which asks the same resolver and owns the error message.
test("a failed resolution hands over nothing rather than throwing", async () => {
  stubResolver({ canResolve: true, resolved: { status: "not_cached" } });
  assert.equal(await resolveExternalHandoffMediaUrl({ infoHash: "abc" }), "");

  DirectDebridResolver.canResolveStream = () => true;
  DirectDebridResolver.cachedPlayableStream = () => null;
  DirectDebridResolver.resolve = async () => {
    throw new Error("network down");
  };
  assert.equal(await resolveExternalHandoffMediaUrl({ infoHash: "abc" }), "");
});

// The list has no loading screen of its own, so a wait on the provider has to
// say something. A link that is already in hand must not announce a wait that
// is not happening.
test("only a real network wait announces itself", async () => {
  let announced = 0;
  const announce = () => {
    announced += 1;
  };

  stubResolver({ canResolve: true, cached: { url: PLAYABLE } });
  await resolveExternalHandoffMediaUrl({ infoHash: "abc" }, { onNetworkResolve: announce });
  assert.equal(announced, 0, "a cached link is immediate");

  await resolveExternalHandoffMediaUrl({ url: PLAYABLE }, { onNetworkResolve: announce });
  assert.equal(announced, 0, "and so is a link the stream already carried");

  stubResolver({
    canResolve: true,
    resolved: { status: "success", stream: { url: PLAYABLE } }
  });
  await resolveExternalHandoffMediaUrl({ infoHash: "abc" }, { onNetworkResolve: announce });
  assert.equal(announced, 1);
});

// A series resolves per episode. Passing the wrong one back would hand the
// external player a different episode's file, which is worse than not playing.
test("the episode being played is the one resolved", async () => {
  let seen = null;
  DirectDebridResolver.canResolveStream = () => true;
  DirectDebridResolver.cachedPlayableStream = () => null;
  DirectDebridResolver.resolve = async (_stream, context) => {
    seen = context;
    return { status: "success", stream: { url: PLAYABLE } };
  };
  await resolveExternalHandoffMediaUrl({ infoHash: "abc" }, { season: 2, episode: 7 });
  assert.deepEqual(seen, { season: 2, episode: 7 });
});
