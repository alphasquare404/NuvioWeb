import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRemuxPolicy,
  normalizeRemuxCacheMiB,
  resolveRemuxRoute,
  assertConfiguredRemuxRoute
} from "./remuxPolicy.js";

test("explicit modes and invalid values never infer an unintended media server", () => {
  for (const mode of ["off", "client", "server"])
    assert.deepEqual(
      normalizeRemuxPolicy({ mode: "  " + mode.toUpperCase() + "  ", endpoint: "/api/remux" }),
      { mode, explicit: true, reason: null }
    );
  assert.equal(normalizeRemuxPolicy({ mode: "hybrid", endpoint: "/api/remux" }).mode, "off");
  assert.equal(normalizeRemuxPolicy({ mode: "hybrid" }).reason, "invalid-remux-mode");
  assert.deepEqual(normalizeRemuxPolicy(), { mode: "off", explicit: false, reason: null });
  assert.deepEqual(normalizeRemuxPolicy({ endpoint: "/api/remux" }), {
    mode: "server",
    explicit: false,
    reason: null
  });
});
test("disk cache remains bounded and invalid explicit budgets fail closed", () => {
  for (const value of [undefined, "", "  "]) assert.equal(normalizeRemuxCacheMiB(value), 512);
  for (const value of [0, 1, 127, -1, "abc", "128.5", "9007199254740992"])
    assert.equal(normalizeRemuxCacheMiB(value), 0);
  for (const [value, expected] of [
    [128, 128],
    [256, 256],
    [512, 512],
    [1024, 512],
    ["000128", 128],
    ["1000000000000000", 512]
  ])
    assert.equal(normalizeRemuxCacheMiB(value), expected);
});
test("routing separates device verdict from installed execution routes and selected audio", () => {
  for (const mode of ["off", "client", "server"]) {
    const policy = normalizeRemuxPolicy({ mode });
    assert.equal(resolveRemuxRoute({ policy, method: "direct" }).route, "direct");
    const plan = resolveRemuxRoute({ policy, method: "remux", audioIndex: 2 });
    assert.equal(plan.state, "unavailable");
    assert.equal(plan.audioIndex, 2);
    assert.equal(
      resolveRemuxRoute({ policy, method: "audio-transcode" }).reason,
      "audio-transcode-policy-separate"
    );
    assert.equal(resolveRemuxRoute({ policy, method: "unknown" }).state, "needs-preflight");
    assert.equal(resolveRemuxRoute({ policy, method: "transcode" }).state, "unavailable");
  }
  const legacy = normalizeRemuxPolicy({ endpoint: "/api/remux" });
  assert.equal(resolveRemuxRoute({ policy: legacy, method: "remux" }).route, "server");
  assert.doesNotThrow(() => assertConfiguredRemuxRoute(legacy));
  assert.doesNotThrow(() => assertConfiguredRemuxRoute(normalizeRemuxPolicy()));
  assert.throws(() => assertConfiguredRemuxRoute(normalizeRemuxPolicy({ mode: "client" })), {
    code: "REMUX_ROUTE_UNAVAILABLE",
    reason: "client-remux-not-installed"
  });
  assert.equal(
    resolveRemuxRoute({
      policy: normalizeRemuxPolicy({ mode: "client" }),
      method: "remux",
      clientAvailable: true
    }).route,
    "client"
  );
  assert.equal(
    resolveRemuxRoute({
      policy: normalizeRemuxPolicy({ mode: "server" }),
      method: "remux",
      serverAvailable: true
    }).route,
    "server"
  );
});

test("saved copy relay URLs are distinguished from audio conversion and third-party HLS", async () => {
  const { isConfiguredCopyRelayUrl } = await import("./remuxPolicy.js");
  const options = { endpoint: "/api/transcode", baseUrl: "https://app.test/" };
  assert.equal(
    isConfiguredCopyRelayUrl("/api/transcode/hls/index.m3u8?u=x&v=copy&a=copy", options),
    true
  );
  assert.equal(isConfiguredCopyRelayUrl("/api/transcode?u=x&v=copy&a=copy", options), true);
  assert.equal(
    isConfiguredCopyRelayUrl("/api/transcode/hls/index.m3u8?u=x&v=copy&a=aac", options),
    false
  );
  assert.equal(
    isConfiguredCopyRelayUrl(
      "https://other.test/api/transcode/hls/index.m3u8?u=x&v=copy&a=copy",
      options
    ),
    false
  );
  assert.equal(isConfiguredCopyRelayUrl("https://cdn.test/movie.m3u8", options), false);
});
