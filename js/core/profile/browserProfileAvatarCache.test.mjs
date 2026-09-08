import test from "node:test";
import assert from "node:assert/strict";

test("profile avatar cache reuses a durable image on an offline cold start", async () => {
  const originals = new Map(
    ["caches", "fetch", "location", "navigator", "URL", "localStorage"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key)
    ])
  );
  const setGlobal = (key, value) => {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  const records = new Map();
  const storage = new Map();
  const NativeUrl = globalThis.URL;
  let fetches = 0;
  try {
    globalThis.__NUVIO_INCLUDE_TRAKT_CLIENT_SECRET__ = false;
    globalThis.__NUVIO_PLATFORM__ = "browser";
    setGlobal("location", new URL("https://app.nuvio.test/"));
    setGlobal("navigator", { onLine: true });
    setGlobal("localStorage", {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key)
    });
    class TestUrl extends NativeUrl {}
    TestUrl.createObjectURL = (blob) => `blob:avatar/${blob.size}`;
    TestUrl.revokeObjectURL = () => {};
    setGlobal("URL", TestUrl);
    setGlobal("caches", {
      open: async () => ({
        match: async (request) => records.get(request.url) || null,
        put: async (request, response) => records.set(request.url, response),
        delete: async (request) => records.delete(request.url)
      })
    });
    setGlobal("fetch", async () => {
      fetches += 1;
      return new Response(new Blob(["avatar"], { type: "image/png" }), { status: 200 });
    });

    const { resolveBrowserProfileAvatar } = await import(`./browserProfileAvatarCache.js?test=${Date.now()}`);
    const profile = { id: "2", avatarId: "anime-1" };
    assert.equal(await resolveBrowserProfileAvatar(profile, "https://cdn.nuvio.test/avatars/a.png?temporary=1"), "blob:avatar/6");
    assert.equal(fetches, 1);

    globalThis.navigator.onLine = false;
    assert.equal(await resolveBrowserProfileAvatar(profile, ""), "blob:avatar/6");
    assert.equal(fetches, 1);
    assert.doesNotMatch(storage.get("browserProfileAvatarCacheIndex"), /temporary=1/);
  } finally {
    originals.forEach((descriptor, key) => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    });
    delete globalThis.__NUVIO_PLATFORM__;
  }
});
