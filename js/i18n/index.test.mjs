import test from "node:test";
import assert from "node:assert/strict";
import { loadLocaleMessagesWithFallback } from "./localeLoader.js";

test("locale loading uses the selected locale over the cached default resource", async () => {
  const requested = [];
  const messages = await loadLocaleMessagesWithFallback("de", async (path) => {
    requested.push(path);
    return path === "values/strings.xml" ? { greeting: "Hello", base: "Base" } : { greeting: "Hallo" };
  });
  assert.deepEqual(requested, ["values/strings.xml", "values-de/strings.xml"]);
  assert.deepEqual(messages, { greeting: "Hallo", base: "Base" });
});

test("locale loading falls back to default messages when the selected locale is unavailable", async () => {
  const messages = await loadLocaleMessagesWithFallback("de", async (path) => {
    if (path === "values/strings.xml") return { greeting: "Hello" };
    throw new Error("offline cache miss");
  });
  assert.deepEqual(messages, { greeting: "Hello" });
});

test("a locale cache failure never aborts application initialization", async () => {
  const messages = await loadLocaleMessagesWithFallback("en", async () => {
    throw new Error("offline cache miss");
  });
  assert.deepEqual(messages, {});
});
