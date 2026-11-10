import test from "node:test";
import assert from "node:assert/strict";
import { clientRemuxFailureFacts, runStartupStep } from "./startupFailure.mjs";
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

test("remux failure exports playback and Range facts without arbitrary error text or source credentials", () => {
  const video = { error: { code: 4 }, readyState: 0, networkState: 2 };
  const error = new TypeError("https://source.example/private-token/video");
  assert.deepEqual(
    clientRemuxFailureFacts(
      "producer",
      error,
      {
        pipelinePhase: "source-open",
        rangeStep: "request",
        lastRangeStatus: 0,
        sourceUrl: error.message,
        video: "private-token"
      },
      video
    ),
    {
      phase: "producer",
      reason: "TypeError",
      nativeMediaErrorCode: 4,
      readyState: 0,
      networkState: 2,
      pipelinePhase: "source-open",
      rangeStep: "request",
      lastRangeStatus: 0
    }
  );
  assert.equal(
    clientRemuxFailureFacts("producer", new Error("private-token"), {}, video).reason,
    "operation-failed"
  );
});

test("software decoder failure logs its allowlisted operation and numeric error code", () => {
  const video = { readyState: 0, networkState: 2 };
  const error = Error("client-transcode-software-video-decode-failed");
  const facts = clientRemuxFailureFacts(
    "producer",
    error,
    { softwareVideoStage: "receive", softwareVideoCode: -1094995529 },
    video
  );
  assert.equal(facts.reason, error.message);
  assert.equal(facts.softwareVideoStage, "receive");
  assert.equal(facts.softwareVideoCode, -1094995529);
  const unsafe = clientRemuxFailureFacts(
    "producer",
    error,
    { softwareVideoStage: "private-token", softwareVideoCode: "private-token" },
    video
  );
  assert.equal(unsafe.softwareVideoStage, undefined);
  assert.equal(unsafe.softwareVideoCode, undefined);
});

test("invalid Range response logs only safe response metadata", () => {
  const video = { readyState: 0, networkState: 2 };
  const stats = {
    lastRangeStatus: 200,
    invalidRangeHost: "cdn.example",
    invalidRangeContentType: "video/mp4",
    invalidRangeContentLength: 123
  };
  const facts = clientRemuxFailureFacts("producer", Error("range-response-invalid"), stats, video);
  assert.equal(facts.responseHost, "cdn.example");
  assert.equal(facts.responseContentType, "video/mp4");
  assert.equal(facts.responseContentLength, 123);
  const unsafe = clientRemuxFailureFacts(
    "producer",
    Error("range-response-invalid"),
    {
      ...stats,
      invalidRangeHost: "https://cdn.example/private",
      invalidRangeContentType: "private"
    },
    video
  );
  assert.equal(unsafe.responseHost, undefined);
  assert.equal(unsafe.responseContentType, undefined);
});
