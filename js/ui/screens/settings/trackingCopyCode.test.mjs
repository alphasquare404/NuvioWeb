import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("./settingsScreen.js", import.meta.url), "utf8");
function copyMethod(states, copy) {
  const start = source.indexOf("  async copyTrackingDeviceCode(provider) {");
  const end = source.indexOf("\n  },", start);
  const services = ["trakt", "simkl", "mdblist"].map((provider) => ({
    getCurrentAuthState: () => states[provider]
  }));
  return new Function(
    "TraktAuthService",
    "SimklAuthService",
    "MdbListAuthService",
    "copyDeviceAuthorizationCode",
    "t",
    "return ({" + source.slice(start, end + 5) + "}).copyTrackingDeviceCode"
  )(...services, copy, (_key, _params, fallback) => fallback);
}
test("all tracking providers copy the current device code and report success", async () => {
  const states = {
    trakt: { userCode: "TRAKT" },
    simkl: { userCode: "SIMKL" },
    mdblist: { userCode: "MDBLIST" }
  };
  const copied = [];
  const run = copyMethod(states, async (code) => {
    copied.push(code);
    return true;
  });
  const ctx = {};
  for (const [provider, prefix] of [
    ["trakt", "desktopTrakt"],
    ["simkl", "desktopSimkl"],
    ["mdblist", "desktopMdbList"]
  ]) {
    assert.equal(await run.call(ctx, provider), true);
    assert.equal(ctx[`${prefix}StatusMessage`], "Copied!");
    assert.equal(ctx[`${prefix}ErrorMessage`], null);
    assert.ok(source.includes(`inlineButton("tracking:desktop:${provider}:copy",`));
  }
  assert.deepEqual(copied, ["TRAKT", "SIMKL", "MDBLIST"]);
});
test("missing or rejected clipboard codes never claim success", async () => {
  const states = { trakt: { userCode: "" } };
  let count = 0;
  const run = copyMethod(states, async () => {
    count++;
    return false;
  });
  const ctx = {};
  assert.equal(await run.call(ctx, "trakt"), false);
  assert.equal(count, 0);
  states.trakt.userCode = "CODE";
  assert.equal(await run.call(ctx, "trakt"), false);
  assert.equal(ctx.desktopTraktStatusMessage, null);
  assert.equal(ctx.desktopTraktErrorMessage, "Copy failed");
});
test("a code replaced during clipboard access does not receive stale feedback", async () => {
  const states = { trakt: { userCode: "OLD" } };
  const run = copyMethod(states, async () => {
    states.trakt.userCode = "NEW";
    return true;
  });
  const ctx = {};
  await run.call(ctx, "trakt");
  assert.equal(ctx.desktopTraktStatusMessage, undefined);
});
