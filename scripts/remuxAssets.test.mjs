import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import vm from "node:vm";
test("remux assets are local, lazy and bind workers to the same immutable protocol version", async () => {
  const base = new URL("../dist/assets/libs/remux/", import.meta.url),
    ids = await readdir(base);
  assert.equal(ids.length, 1);
  const id = ids[0];
  assert.match(id, /^[a-f0-9]+$/);
  const files = await readdir(new URL(id + "/", base));
  for (const file of [
    "client-runtime.js",
    "cache-worker.js",
    "subtitle-worker.js",
    "mediabunny.LICENSE"
  ])
    assert.ok(files.includes(file));
  const app = await readFile(new URL("../dist/app.bundle.js", import.meta.url), "utf8"),
    sw = await readFile(new URL("../dist/sw.js", import.meta.url), "utf8");
  assert.ok(app.includes(id));
  assert.equal(sw.includes("assets/libs/remux"), false);
  for (const name of ["cache-worker.js", "subtitle-worker.js"]) {
    const source = await readFile(new URL(id + "/" + name, base), "utf8"),
      messages = [];
    const context = {
      self: {},
      postMessage: (message) => messages.push(message),
      setInterval,
      clearInterval,
      setTimeout,
      clearTimeout,
      TextDecoder,
      TextEncoder,
      console,
      AbortController,
      performance,
      URL
    };
    vm.runInNewContext(source, context);
    context.self.onmessage({
      data: {
        type: name === "cache-worker.js" ? "start" : "open",
        version: "stale",
        jobId: "test",
        sourceId: "test"
      }
    });
    assert.equal(messages[0]?.reason, "remux-version-mismatch");
  }
});
