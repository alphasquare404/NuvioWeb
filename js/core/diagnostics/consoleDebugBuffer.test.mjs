import assert from "node:assert/strict";
import test from "node:test";
import { getConsoleDebugEvents } from "./consoleDebugBuffer.js";

// The on-device Debug Console is the only way to see what went wrong on a
// phone, and an error that reaches it with its message stripped is worth
// nothing. That is what happened on iOS: the formatter preferred `stack`, and
// WebKit's stack carries only frames, so once their URLs were redacted a failed
// cloud call read "ki@[redacted]" -- a minified function name and no diagnosis.
//
// Importing the module installs the console hook, so a captured event is
// whatever console.warn was handed, formatted the way the device shows it.

function lastMessageAfter(run) {
  const before = getConsoleDebugEvents().length;
  run();
  const events = getConsoleDebugEvents().slice(before);
  return events.map((event) => String(event.message || ""));
}

// WebKit: frames only, the message appears nowhere in the stack.
function webkitError(message, extra = {}) {
  const error = new Error(message);
  error.stack = "ki@https://example.test/dist/app.bundle.js:1:2\n@https://example.test/x.js:3:4";
  return Object.assign(error, extra);
}

// V8: the stack already opens with "Name: message".
function v8Error(message, extra = {}) {
  const error = new Error(message);
  error.stack = `Error: ${message}\n    at ki (https://example.test/dist/app.bundle.js:1:2)`;
  return Object.assign(error, extra);
}

test("a WebKit error keeps its message once the frames are redacted", () => {
  const [message] = lastMessageAfter(() =>
    console.warn("Watch progress sync push failed", webkitError("Load failed"))
  );
  assert.match(message, /Error: Load failed/);
});

// The HTTP client puts the server's answer on the error rather than in the
// message, and that is usually the whole diagnosis.
test("the status and code a failed request carries are shown", () => {
  const [message] = lastMessageAfter(() =>
    console.warn(
      "Watch progress sync pull failed",
      webkitError("", { status: 401, code: "PGRST301" })
    )
  );
  assert.match(message, /status=401/);
  assert.match(message, /code=PGRST301/);
});

test("a V8 error does not repeat its message twice", () => {
  const [message] = lastMessageAfter(() =>
    console.warn("failed", v8Error("Network request failed"))
  );
  assert.equal(message.match(/Network request failed/g)?.length, 1);
});

test("frames are still redacted", () => {
  const [message] = lastMessageAfter(() => console.warn("failed", webkitError("Load failed")));
  assert.doesNotMatch(message, /example\.test/);
  assert.match(message, /\[redacted\]/);
});

test("a bearer token never reaches the console", () => {
  const [message] = lastMessageAfter(() =>
    console.warn("failed", webkitError("rejected", { detail: "Bearer abc.def.ghi" }))
  );
  assert.doesNotMatch(message, /abc\.def\.ghi/);
});

test("something thrown that is not an error still prints", () => {
  const messages = lastMessageAfter(() => {
    console.warn("failed", "plain string");
    console.warn("failed", null);
    console.warn("failed", 42);
  });
  assert.match(messages[0], /plain string/);
  assert.match(messages[1], /null/);
  assert.match(messages[2], /42/);
});

// A nested error inside a logged object goes through the same formatter.
test("an error nested in a logged object keeps its message too", () => {
  const [message] = lastMessageAfter(() =>
    console.warn("failed", { where: "pull", cause: webkitError("Load failed") })
  );
  assert.match(message, /Load failed/);
});
