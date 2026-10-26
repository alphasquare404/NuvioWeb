import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProbeMode, normalizeClientProbeConcurrency } from "./probeMode.js";

test("client concurrency defaults to one and only explicitly accepts two", () => {
  assert.equal(normalizeClientProbeConcurrency(" 2 "), 2);
  for (const value of [undefined, "", 0, 1, 3, 100, "invalid"])
    assert.equal(normalizeClientProbeConcurrency(value), 1);
});
test("hoster modes preserve server default and legacy off, explicit mode wins, invalid mode fails closed", () => {
  assert.equal(normalizeProbeMode(), "server");
  assert.equal(normalizeProbeMode("", "false"), "off");
  assert.equal(normalizeProbeMode(" CLIENT ", "false"), "client");
  assert.equal(normalizeProbeMode("server", "false"), "server");
  assert.equal(normalizeProbeMode("off", "true"), "off");
  assert.equal(normalizeProbeMode("both"), "off");
});
