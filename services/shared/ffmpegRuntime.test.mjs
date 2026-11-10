import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  ffmpegCandidates,
  inspectFFmpegRuntime,
  publicFFmpegCapabilities
} from "./ffmpegRuntime.mjs";
import { createRemuxBridgeHandler } from "../remux-bridge/bridge.mjs";
import { createTranscodeBridgeHandler } from "../transcode-bridge/bridge.mjs";

function fakeRun({
  aac = true,
  x264 = true,
  mp4 = true,
  hls = true,
  https = true,
  fail = []
} = {}) {
  return async (file, args, options) => {
    assert.ok(options.timeout > 0);
    assert.equal(options.windowsHide, true);
    if (fail.includes(file)) throw Object.assign(Error("not executable"), { code: "ENOENT" });
    const outputs = {
      "-version": "ffmpeg version 6.1.1",
      "-muxers": `${mp4 ? " E mp4 MP4 format\n" : ""}${hls ? " E hls HLS format\n" : ""}`,
      "-encoders": `${aac ? " A..... aac AAC audio\n" : ""}${x264 ? " V....D libx264 H.264 encoder\n" : ""}`,
      "-protocols": `http\n${https ? "https\n" : ""}`
    };
    return { stdout: outputs[args[1]] };
  };
}

test("host override is authoritative and package binary precedes PATH", () => {
  assert.deepEqual(ffmpegCandidates({ override: " /host/ffmpeg ", bundled: "/package/ffmpeg" }), [
    { path: "/host/ffmpeg", source: "override" }
  ]);
  assert.deepEqual(ffmpegCandidates({ override: "", bundled: "/package/ffmpeg" }), [
    { path: "/package/ffmpeg", source: "bundled" },
    { path: "ffmpeg", source: "system" }
  ]);
  assert.deepEqual(ffmpegCandidates({ override: "", bundled: "" }), [
    { path: "ffmpeg", source: "system" }
  ]);
});

const bundled = [{ path: "/package/ffmpeg", source: "bundled" }];
test("capability check confirms MP4, HLS, HTTPS and AAC independently", async () => {
  const runtime = await inspectFFmpegRuntime({ candidates: bundled, run: fakeRun() });
  assert.equal(runtime.remux, true);
  assert.equal(runtime.audioTranscoding, true);
  assert.equal(runtime.videoTranscoding, true);
  const noX264 = await inspectFFmpegRuntime({ candidates: bundled, run: fakeRun({ x264: false }) });
  assert.equal(noX264.audioTranscoding, true);
  assert.equal(noX264.videoTranscoding, false);
  assert.equal(runtime.hls, true);
  const noAAC = await inspectFFmpegRuntime({ candidates: bundled, run: fakeRun({ aac: false }) });
  assert.equal(noAAC.remux, true);
  assert.equal(noAAC.audioTranscoding, false);
  const noHls = await inspectFFmpegRuntime({ candidates: bundled, run: fakeRun({ hls: false }) });
  assert.equal(noHls.audioTranscoding, true);
  assert.equal(noHls.hls, false);
  for (const missing of [{ mp4: false }, { https: false }]) {
    const unavailable = await inspectFFmpegRuntime({ candidates: bundled, run: fakeRun(missing) });
    assert.equal(unavailable.remux, false);
    assert.equal(unavailable.audioTranscoding, false);
  }
});

test("bundled failure falls back to PATH but a broken override fails closed", async () => {
  const fallback = await inspectFFmpegRuntime({
    candidates: ffmpegCandidates({ override: "", bundled: "/bad" }),
    run: fakeRun({ fail: ["/bad"] })
  });
  assert.equal(fallback.source, "system");
  assert.equal(fallback.available, true);
  const override = await inspectFFmpegRuntime({
    candidates: ffmpegCandidates({ override: "/bad", bundled: "/package" }),
    run: fakeRun({ fail: ["/bad"] })
  });
  assert.equal(override.available, false);
  assert.equal(override.remux, false);
});

test("execution failure or timeout never advertises features or private paths", async () => {
  const runtime = await inspectFFmpegRuntime({
    candidates: bundled,
    run: async () => {
      throw Error("timed out");
    }
  });
  assert.deepEqual(publicFFmpegCapabilities(runtime), {
    verified: true,
    available: false,
    remux: false,
    audioTranscoding: false,
    videoTranscoding: false,
    hls: false
  });
  assert.ok(!JSON.stringify(publicFFmpegCapabilities(runtime)).includes("/package"));
});

async function serve(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("production health endpoints report unavailable FFmpeg without starting a job", async () => {
  const unavailable = await inspectFFmpegRuntime({
    candidates: bundled,
    run: async () => {
      throw Error("missing");
    }
  });
  for (const [factory, route] of [
    [createRemuxBridgeHandler, "/api/remux/health"],
    [createTranscodeBridgeHandler, "/api/transcode/health"]
  ]) {
    await serve(
      factory({
        ffmpegRuntime: unavailable,
        spawnImpl: () => {
          throw Error("must not start media job");
        }
      }),
      async (base) => {
        const response = await fetch(base + route);
        assert.equal(response.status, 503);
        const result = await response.json();
        assert.equal(result.ok, false);
        assert.equal(result.ffmpeg.verified, true);
        assert.equal(result.ffmpeg.available, false);
        assert.ok(!JSON.stringify(result).includes("/package"));
      }
    );
  }
});

test("health distinguishes remux-only FFmpeg from audio transcoding", async () => {
  const runtime = await inspectFFmpegRuntime({ candidates: bundled, run: fakeRun({ aac: false }) });
  await serve(
    createTranscodeBridgeHandler({
      ffmpegRuntime: runtime,
      access: "open",
      spawnImpl: () => {
        throw Error("must not start job");
      }
    }),
    async (base) => {
      const response = await fetch(base + "/api/transcode/health");
      const result = await response.json();
      assert.equal(result.ffmpeg.remux, true);
      assert.equal(result.ffmpeg.audioTranscoding, false);
      assert.deepEqual(result.offered.audioModes, ["copy"]);
      const media = await fetch(base + "/api/transcode?u=https%3A%2F%2Fexample.com%2Fvideo.mkv");
      assert.equal(media.status, 503);
    }
  );
});
