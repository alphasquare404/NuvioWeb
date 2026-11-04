import assert from "node:assert/strict";
import test from "node:test";
import {
  hasWebCodecs,
  preflightSource,
  shouldRoutePlayerToMovi,
  shouldUseMovi
} from "./moviCapability.js";

test("WebCodecs presence is read from the injected scope", () => {
  assert.equal(hasWebCodecs({}), false);
  assert.equal(hasWebCodecs({ VideoDecoder: function Fake() {} }), true);
});

test("the movi engine is used only when it was chosen and the device can decode", () => {
  const capable = { webCodecs: true };
  const incapable = { webCodecs: false };

  assert.equal(shouldUseMovi({ playerEngine: "movi" }, capable), true);
  assert.equal(shouldUseMovi({ playerEngine: "movi" }, incapable), false);
  assert.equal(shouldUseMovi({ playerEngine: "native" }, capable), false);
  assert.equal(shouldUseMovi({}, capable), false);
  assert.equal(shouldUseMovi(null, capable), false);
  assert.equal(shouldUseMovi({ playerEngine: " MOVI " }, capable), true);
});

test("preflight accepts a source the browser is allowed to read", async () => {
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push({ url, options });
    return {
      ok: true,
      status: 206,
      headers: {
        get: (name) => (name.toLowerCase() === "content-type" ? "video/x-matroska" : null)
      }
    };
  };

  const result = await preflightSource("https://example.test/movie.mkv", { fetchImpl });

  assert.equal(result.ok, true);
  assert.equal(result.status, 206);
  assert.equal(result.contentType, "video/x-matroska");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].options.headers.Range, "bytes=0-1");
  assert.equal(seen[0].options.mode, "cors");
});

test("a host that answers with an error is unreachable, and says which error", async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, headers: { get: () => null } });
  const result = await preflightSource("https://example.test/expired", { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.code, "source-unreachable");
  assert.equal(result.reason, "http");
  assert.equal(result.status, 403);
});

test("a cross-origin read the browser refuses is reported as unreachable, not as a decode failure", async () => {
  const fetchImpl = async () => {
    throw new TypeError("Load failed");
  };
  const result = await preflightSource("https://cdn.example.test/direct-link", { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.code, "source-unreachable");
  assert.equal(result.reason, "network");
  assert.match(result.message, /Load failed/);
});

test("an empty source or a missing fetch never reaches the network", async () => {
  assert.equal((await preflightSource("   ")).reason, "empty-source");
  assert.equal(
    (await preflightSource("https://example.test/a", { fetchImpl: null })).reason,
    "no-fetch"
  );
});

test("the player route is answered by movi only for an http source and a chosen engine", () => {
  const movi = { playerEngine: "movi" };
  const native = { playerEngine: "native" };
  const capableContext = { webCodecs: true };

  assert.equal(
    shouldRoutePlayerToMovi({ streamUrl: "https://cdn.test/movie.mkv" }, movi, capableContext),
    true
  );
  assert.equal(
    shouldRoutePlayerToMovi({ streamUrl: "https://cdn.test/movie.mkv" }, native, capableContext),
    false
  );
  // A downloaded file is a blob: URL. It is local, so the CORS rule that guards
  // remote sources does not apply — and it is where movi matters most, because a
  // downloaded MKV or AV1 is what the built-in player cannot open at all.
  assert.equal(
    shouldRoutePlayerToMovi({ streamUrl: "blob:https://app.test/1234" }, movi, capableContext),
    true
  );
  assert.equal(
    shouldRoutePlayerToMovi({ streamUrl: "blob:https://app.test/1234" }, native, capableContext),
    false
  );
  assert.equal(
    shouldRoutePlayerToMovi({ streamUrl: "https://cdn.test/movie.mkv" }, movi, {
      webCodecs: false
    }),
    false
  );
  assert.equal(shouldRoutePlayerToMovi({}, movi, capableContext), false);
  assert.equal(shouldRoutePlayerToMovi(null, movi, capableContext), false);
});
