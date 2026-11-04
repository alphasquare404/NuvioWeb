import test from "node:test";
import assert from "node:assert/strict";
import { runStartupStep } from "./startupFailure.mjs";
test("a storage UnknownError is attributed without exposing browser messages or claiming memory exhaustion", async () => {
  const events = [];
  await assert.rejects(
    runStartupStep(
      "storage-cleanup",
      () => {
        throw new DOMException(
          "https://private.invalid/?token=secret e.g. out of memory",
          "UnknownError"
        );
      },
      (facts) => events.push(facts)
    ),
    (error) => {
      assert.equal(error.message, "client-startup-storage-cleanup-unknown-error");
      assert.equal(error.remuxStartupPhase, "storage-cleanup");
      assert.equal(error.cause, undefined);
      return true;
    }
  );
  assert.deepEqual(events, [
    { phase: "storage-cleanup", exception: "unknown-error", reason: "unknown-error" }
  ]);
});
test("nested stages keep the precise original worker failure and report once", async () => {
  const events = [],
    report = (facts) => events.push(facts);
  await assert.rejects(
    runStartupStep(
      "producer-start",
      () =>
        runStartupStep(
          "media-worker",
          () => {
            throw new DOMException("internal details", "SecurityError");
          },
          report
        ),
      report
    ),
    /client-startup-media-worker-security-error/
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].phase, "media-worker");
});
test("successful operations retain values and source-open timeout stays recognizable", async () => {
  assert.equal(
    await runStartupStep(
      "cache-run",
      async () => 42,
      () => assert.fail()
    ),
    42
  );
  await assert.rejects(
    runStartupStep(
      "renderer-open",
      () => {
        throw Error("sourceopen-timeout");
      },
      () => {}
    ),
    /client-startup-renderer-open-sourceopen-timeout/
  );
});
test("invalid stage and reporting failure cannot expose or replace the original operation category", async () => {
  await assert.rejects(
    runStartupStep("private-token", () => assert.fail()),
    /invalid-startup-phase/
  );
  await assert.rejects(
    runStartupStep(
      "renderer-open",
      () => {
        throw new DOMException("private", "UnknownError");
      },
      () => {
        throw Error("reporter");
      }
    ),
    /client-startup-renderer-open-unknown-error/
  );
});
