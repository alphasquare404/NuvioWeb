import assert from "node:assert/strict";
import test from "node:test";
import { createEgressBudget, monthStamp } from "./egressBudget.mjs";

test("zero means no budget at all", () => {
  const budget = createEgressBudget({ monthlyBytes: 0 });
  budget.add(10 * 1024 * 1024 * 1024);
  assert.equal(budget.exhausted(), false);
  assert.equal(budget.remaining(), 0, "no ceiling, no remaining figure to report");
  assert.deepEqual(budget.snapshot(), {
    monthlyEgressBytes: 0,
    egressUsedThisMonth: 10 * 1024 * 1024 * 1024,
    egressRemainingBytes: 0
  });
});

test("bytes are counted until the allowance is spent", () => {
  const budget = createEgressBudget({ monthlyBytes: 1000 });
  budget.add(600);
  assert.equal(budget.exhausted(), false);
  assert.equal(budget.remaining(), 400);
  budget.add(400);
  assert.equal(budget.exhausted(), true, "spending exactly the allowance exhausts it");
  assert.equal(budget.remaining(), 0);
});

test("the counter rolls over when the month changes", () => {
  let clock = Date.UTC(2026, 0, 31, 23, 0, 0);
  const budget = createEgressBudget({ now: () => clock, monthlyBytes: 1000 });
  budget.add(900);
  assert.equal(budget.exhausted(), false);

  clock = Date.UTC(2026, 1, 1, 0, 30, 0);
  assert.equal(monthStamp(clock), "2026-02");
  assert.equal(budget.used(), 0, "a new month starts from zero");
  assert.equal(budget.exhausted(), false);
});

test("a retry hint points at the first moment the allowance returns", () => {
  const clock = Date.UTC(2026, 4, 31, 20, 0, 0);
  const budget = createEgressBudget({ now: () => clock, monthlyBytes: 10 });
  const seconds = budget.retryAfterSeconds();
  // 20:00 on the last day of May to midnight on 1 June is four hours.
  assert.equal(seconds, 4 * 60 * 60);
});
