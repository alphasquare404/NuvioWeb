import assert from "node:assert/strict";
import test from "node:test";
import {
  copyDeviceAuthorizationCode,
  openDeviceAuthorizationLink
} from "./browserDeviceCodeActions.js";

test("copies exactly the visible Device Code without changing authorization state", async () => {
  const copied = [];
  const result = await copyDeviceAuthorizationCode("ABCD-1234", {
    clipboard: { writeText: async (value) => copied.push(value) }
  });

  assert.equal(result, true);
  assert.deepEqual(copied, ["ABCD-1234"]);
});

test("clipboard failure falls back safely and remains non-fatal", async () => {
  const copied = [];
  const input = {
    setAttribute() {},
    style: {},
    select() {},
    remove() {}
  };
  const result = await copyDeviceAuthorizationCode("ABCD-1234", {
    clipboard: { writeText: async () => Promise.reject(new Error("blocked")) },
    documentRef: {
      createElement: () => input,
      body: { appendChild: (element) => copied.push(element) },
      execCommand: (command) => command === "copy"
    }
  });

  assert.equal(result, true);
  assert.deepEqual(copied, [input]);
});

test("copy failure without an available fallback remains non-fatal", async () => {
  const result = await copyDeviceAuthorizationCode("ABCD-1234", {
    clipboard: { writeText: async () => Promise.reject(new Error("blocked")) },
    documentRef: null
  });

  assert.equal(result, false);
});

test("opens only each provider's trusted HTTPS verification URL in a new tab", () => {
  const calls = [];
  const open = (...args) => calls.push(args);

  assert.equal(
    openDeviceAuthorizationLink("torbox", "https://tor.box/device?code=ABCD", { open }),
    true
  );
  assert.equal(
    openDeviceAuthorizationLink("premiumize", "https://www.premiumize.me/device", { open }),
    true
  );
  assert.deepEqual(calls, [
    ["https://tor.box/device?code=ABCD", "_blank", "noopener,noreferrer"],
    ["https://www.premiumize.me/device", "_blank", "noopener,noreferrer"]
  ]);
});

test("rejects arbitrary, insecure, and mismatched verification links without navigation", () => {
  const calls = [];
  const open = (...args) => calls.push(args);

  assert.equal(openDeviceAuthorizationLink("torbox", "http://tor.box/device", { open }), false);
  assert.equal(openDeviceAuthorizationLink("torbox", "https://evil.example/device", { open }), false);
  assert.equal(openDeviceAuthorizationLink("torbox", "https://tor.box:444/device", { open }), false);
  assert.equal(
    openDeviceAuthorizationLink("premiumize", "https://premiumize.me/device", { open }),
    false
  );
  assert.deepEqual(calls, []);
});
