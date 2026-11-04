import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("./quickSetupScreen.js", import.meta.url), "utf8");
const initialization = source.slice(
  source.indexOf("    const stored ="),
  source.indexOf("    this.automationAvailability")
);
const start = source.indexOf("  commitStep(step)"),
  end = source.indexOf("\n  },", start);
function commitFor(stored, offered) {
  const writes = [],
    ctx = {};
  new Function("settings", "offered", "normalizeBrowserExternalPlayer", initialization).call(
    ctx,
    { browserExternalPlayer: stored },
    offered,
    (v) => v
  );
  const commit = new Function(
    "PlayerSettingsStore",
    "return ({" + source.slice(start, end + 5) + "})"
  )({ set: (v) => writes.push(v) }).commitStep;
  return { ctx, writes, commit };
}
test("accepting Internal on a device that cannot offer the stored external player persists Internal", () => {
  const h = commitFor("lenna", ["disabled"]);
  assert.equal(h.ctx.player, "disabled");
  h.commit.call(h.ctx, "player");
  assert.equal(h.writes[0].browserExternalPlayer, "disabled");
  h.commit.call(h.ctx, "player");
  assert.equal(h.writes.length, 1);
});
test("a valid existing choice remains untouched until the user changes it", () => {
  const h = commitFor("lenna", ["lenna", "disabled"]);
  h.commit.call(h.ctx, "player");
  assert.equal(h.writes.length, 0);
  h.ctx.player = "disabled";
  h.commit.call(h.ctx, "player");
  assert.equal(h.writes[0].browserExternalPlayer, "disabled");
});
