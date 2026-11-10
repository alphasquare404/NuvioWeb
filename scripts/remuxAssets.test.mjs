import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
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
    "mediabunny.LICENSE",
    "libav-audio-factory.js",
    "libav-audio.wasm",
    "software-video.js",
    "software-video.wasm",
    "software-video.NOTICE.md",
    "FFmpeg.LICENSE",
    "dav1d.LICENSE",
    "browser-audio-wasm-NOTICE.txt",
    "browser-audio-wasm-LGPL-2.1.txt",
    "browser-audio-wasm-GPL-2.0.txt",
    ...["ac3", "dts", "truehd", "aac-encoder", "prores"].flatMap((extension) => [
      "mediabunny-" + extension + ".LICENSE",
      "mediabunny-" + extension + ".NOTICE.md"
    ])
  ])
    assert.ok(files.includes(file));
  const { default: initSoftwareVideo } = await import(
    new URL(id + "/software-video.js", base).href
  );
  const decoder = await initSoftwareVideo();
  for (const [index, codec] of ["H.264", "HEVC", "VP8", "VP9", "AV1"].entries()) {
    const handle = decoder._decoder_open(index, 0, 0);
    assert.ok(handle, codec + " decoder was built into WebAssembly");
    decoder._decoder_close(handle);
  }

  const entry = await readFile(new URL(id + "/cache-worker.js", base), "utf8");
  for (const extension of ["ac3", "dts", "truehd", "aac-encoder", "prores"])
    assert.ok(
      files.some((file) => file.startsWith("mediabunny-" + extension + "-") && file.endsWith(".js"))
    );
  assert.ok(entry.includes("import("));
  assert.ok(!entry.includes("AC-3 codec worker"));
  const app = await readFile(new URL("../dist/app.bundle.js", import.meta.url), "utf8"),
    sw = await readFile(new URL("../dist/sw.js", import.meta.url), "utf8");
  assert.ok(app.includes(id));
  assert.equal(sw.includes("assets/libs/remux"), false);
  for (const name of ["cache-worker.js", "subtitle-worker.js"]) {
    const url = new URL(id + "/" + name, base);
    const source =
      name === "cache-worker.js"
        ? (
            await build({
              entryPoints: [fileURLToPath(url)],
              bundle: true,
              write: false,
              format: "iife"
            })
          ).outputFiles[0].text
        : await readFile(url, "utf8");
    const messages = [];
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
