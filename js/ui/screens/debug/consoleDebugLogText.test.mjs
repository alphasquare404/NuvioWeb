import assert from "node:assert/strict";
import test from "node:test";
import { buildLogText } from "./consoleDebugLogText.js";

// What lands in the clipboard when the Copy button is pressed.
//
// A log read off a phone screen is a log nobody reports accurately, so the copy
// has to be complete on its own: every captured line, in order, with the build
// and browser that produced them. The screen shows the same events, but the
// paste is what actually reaches a bug report.

const runtime = {
  location: { href: "http://192.168.2.2:4174/" },
  navigator: { userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0)" }
};

const events = [
  { id: 1, level: "warn", timestamp: Date.UTC(2026, 0, 1), args: ["[CW] refresh-patch pos=1000"] },
  { id: 2, level: "error", timestamp: Date.UTC(2026, 0, 1), message: "boom" }
];

test("every captured event reaches the clipboard", () => {
  const text = buildLogText(events, { runtime });
  assert.match(text, /\[CW\] refresh-patch pos=1000/);
  assert.match(text, /boom/);
  assert.match(text, /events: 2/);
});

test("the environment travels with the log", () => {
  const text = buildLogText(events, { runtime });
  assert.match(text, /http:\/\/192\.168\.2\.2:4174\//);
  assert.match(text, /iPad; CPU OS 18_0/);
});

test("levels are labelled so a warning is not read as an error", () => {
  const text = buildLogText(events, { runtime });
  assert.match(text, /#1 WARN/);
  assert.match(text, /#2 ERROR/);
});

// Order is the whole diagnostic value: which write happened before which.
test("events keep the order they were captured in", () => {
  const text = buildLogText(events, { runtime });
  assert.ok(text.indexOf("#1 WARN") < text.indexOf("#2 ERROR"));
});

// A multi-argument console call is one event; joining its parts is what keeps a
// stack attached to the message it belongs to.
test("a multi-argument event keeps all of its parts", () => {
  const text = buildLogText([{ id: 3, level: "error", timestamp: 0, args: ["msg", "stack"] }], {
    runtime
  });
  assert.match(text, /msg/);
  assert.match(text, /stack/);
});

// Pressing Copy on an empty log should still produce something explicable
// rather than an empty clipboard that looks like a broken button.
test("an empty log still reports the environment", () => {
  const text = buildLogText([], { runtime });
  assert.match(text, /events: 0/);
  assert.match(text, /iPad/);
});

test("a runtime that cannot answer is recorded as unknown, not crashed", () => {
  const text = buildLogText(events, { runtime: {} });
  assert.match(text, /url: -/);
  assert.match(text, /userAgent: -/);
});

// Which build produced a log. The service worker can serve an older cached
// bundle than the one on the server, so a log without its build stamp cannot
// confirm a fix is even running -- which is how one fix got tested twice
// against the build that predated it.
test("the log names the build that produced it", () => {
  assert.match(buildLogText([], { runtime }), /build: /);
});
