import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldThrottleAhead,
  BufferBudget,
  MAX_PLAYBACK_COMPRESSED_BYTES
} from "./bufferBudget.mjs";
test("a playing decoder that needs more future data can fill beyond the normal time window", () => {
  let buffered = 0,
    readyState = 2,
    appends = 0;
  while (readyState < 3 && appends < 10) {
    if (shouldThrottleAhead({ aheadSeconds: buffered, readyState, paused: false })) break;
    buffered += 4;
    appends++;
    if (buffered >= 20) readyState = 3;
  }
  assert.equal(readyState, 3);
  assert.equal(buffered, 20);
  assert.equal(shouldThrottleAhead({ aheadSeconds: buffered, readyState, paused: false }), true);
});
test("paused playback and a ready decoder keep the existing ahead limit", () => {
  assert.equal(shouldThrottleAhead({ aheadSeconds: 16, readyState: 2, paused: true }), true);
  assert.equal(shouldThrottleAhead({ aheadSeconds: 16, readyState: 3, paused: false }), true);
  assert.equal(shouldThrottleAhead({ aheadSeconds: 12, readyState: 4, paused: false }), false);
});

test("readiness buffering still refuses output that exceeds the hard compressed-byte budget", () => {
  const unit = 25 * 1024 * 1024,
    budget = new BufferBudget({ maxBytes: MAX_PLAYBACK_COMPRESSED_BYTES });
  budget.reserve(unit);
  budget.append(unit, 20, true);
  budget.reserve(unit);
  budget.append(unit, 40, true);
  assert.equal(shouldThrottleAhead({ aheadSeconds: 40, readyState: 2, paused: false }), false);
  assert.equal(budget.plan(8 * 1024 * 1024, 0).bytePressure, true);
  assert.throws(() => budget.reserve(8 * 1024 * 1024), /compressed-byte-budget/);
  assert.ok(budget.heldBytes <= budget.limitBytes);
  assert.ok(budget.limitBytes <= MAX_PLAYBACK_COMPRESSED_BYTES);
});

test("observed MMS stop blocks feeding even before canplay; bootstrap and renewed demand are allowed", async () => {
  const { isManagedBufferBlocked: blocked } = await import("./bufferBudget.mjs");
  assert.equal(
    blocked({ signalSeen: true, allowed: false, seekApplied: true, hasBufferedData: true }),
    true
  );
  assert.equal(
    blocked({ signalSeen: false, allowed: false, seekApplied: true, hasBufferedData: true }),
    false
  );
  assert.equal(
    blocked({ signalSeen: true, allowed: true, seekApplied: true, hasBufferedData: true }),
    false
  );
  assert.equal(
    blocked({ signalSeen: true, allowed: false, seekApplied: false, hasBufferedData: true }),
    false
  );
  assert.equal(
    blocked({ signalSeen: true, allowed: false, seekApplied: true, hasBufferedData: false }),
    false
  );
});
