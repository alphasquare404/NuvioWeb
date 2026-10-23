import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { browserCompatibilityPolicy } from "../../../scripts/browserCompatibilityPolicy.mjs";

async function bundledApi(file, document) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(file, import.meta.url))],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "CapabilityTest",
    minify: true,
    target: [`chrome${browserCompatibilityPolicy.chromiumVersion}`]
  });
  const context = {
    document,
    navigator: { userAgent: "Chrome", maxTouchPoints: 0 },
    setTimeout,
    clearTimeout
  };
  runInNewContext(result.outputFiles[0].text, context);
  return context.CapabilityTest;
}
function mediaDocument() {
  const document = {
    createElement(name) {
      assert.equal(this, document);
      assert.equal(name, "video");
      return { canPlayType: () => "probably" };
    }
  };
  return document;
}
test("production-target capability detection keeps the DOM receiver in default arguments", async () => {
  const api = await bundledApi("./deviceCapabilities.js", mediaDocument());
  assert.equal(api.detectDeviceCapabilities().h264, true);
});
test("production-target per-file assessment creates its default media element safely", async () => {
  const api = await bundledApi("./playbackCapabilities.js", mediaDocument());
  const result = await api.assessPlaybackCapabilities({
    container: "mp4",
    videoCodec: "h264",
    codecString: "avc1.640028",
    audioStreams: [{ index: 0, codec: "aac", profile: "LC" }]
  });
  assert.equal(result.video, true);
  assert.equal(result.audio[0].supported, true);
});

test("production-target startup snapshot initializes safely before any profile exists", async () => {
  const api = await bundledApi("./deviceCapabilitySession.js", mediaDocument());
  const snapshot = api.initializeDeviceCapabilitySession();
  assert.equal(snapshot.codecs.h264, true);
  assert.equal(snapshot.hdr, null);
  assert.strictEqual(api.initializeDeviceCapabilitySession().codecs, snapshot.codecs);
});
