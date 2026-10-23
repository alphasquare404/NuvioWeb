import test from "node:test";
import assert from "node:assert/strict";
import { assessPlaybackCapabilities, videoCodecString } from "./playbackCapabilities.js";
import { detectDeviceCapabilities } from "./deviceCapabilities.js";

const probe = {
  container: "mp4",
  videoCodec: "h264",
  videoProfile: "High",
  videoLevel: 40,
  codecString: "avc1.640028",
  width: 1920,
  height: 1080,
  frameRate: 24,
  videoBitrate: 4000000,
  audioCodec: "aac",
  audioStreams: [{ index: 0, codec: "aac", channels: 6, sampleRate: 48000, profile: "LC" }]
};
test("native files work without MediaSource; unavailable APIs stay unknown", () => {
  const caps = detectDeviceCapabilities(null, { mediaElement: { canPlayType: () => "probably" } });
  assert.equal(caps.h264, true);
  assert.equal(detectDeviceCapabilities(null, { mediaElement: null }).h264, null);
});
test("per-file MediaCapabilities query uses actual video and audio configuration", async () => {
  const calls = [];
  const scope = {
    navigator: {
      mediaCapabilities: {
        decodingInfo: async (config) => {
          calls.push(config);
          return { supported: false, smooth: false, powerEfficient: false };
        }
      }
    }
  };
  const result = await assessPlaybackCapabilities(probe, {
    scope,
    mediaElement: { canPlayType: () => "probably" }
  });
  assert.equal(result.video, false);
  assert.equal(result.audio[0].supported, false);
  assert.equal(calls[0].video.width, 1920);
  assert.equal(calls[0].video.framerate, 24);
  assert.equal(calls[1].audio.channels, "6");
});
test("missing configuration is not filled with a generic codec profile", async () => {
  assert.equal(videoCodecString({ videoCodec: "hevc", videoProfile: "RExt" }), "");
  const result = await assessPlaybackCapabilities(
    { ...probe, codecString: "", videoProfile: "unrecognised" },
    { scope: {}, mediaElement: { canPlayType: () => "probably" } }
  );
  assert.equal(result.video, null);
});
test("Movi asks WebCodecs rather than inheriting native file support", async () => {
  let config;
  const result = await assessPlaybackCapabilities(probe, {
    engine: "movi",
    scope: {
      VideoDecoder: {
        isConfigSupported: async (c) => {
          config = c;
          return { supported: true };
        }
      }
    }
  });
  assert.equal(config.codec, "avc1.640028");
  assert.equal(result.video, true);
  assert.equal(result.container, null);
  assert.equal(result.audio[0].supported, null);
});
test("unsupported/high-bit-depth profiles and API errors do not become a generic Direct", async () => {
  const result = await assessPlaybackCapabilities(
    { ...probe, codecString: "avc1.6e0028", videoProfile: "High 10", bitDepth: 10 },
    {
      scope: {
        navigator: {
          mediaCapabilities: {
            decodingInfo: async () => {
              throw Error("unsupported API");
            }
          }
        }
      },
      mediaElement: { canPlayType: (type) => (type.includes("6e0028") ? "" : "probably") }
    }
  );
  assert.equal(result.video, false);
});
test("adaptive paths require manifest verification", async () => {
  for (const extra of [{ container: "hls" }, { container: "dash" }]) {
    const result = await assessPlaybackCapabilities(
      { ...probe, ...extra },
      { scope: {}, mediaElement: { canPlayType: () => "probably" } }
    );
    assert.equal(result.video, null);
  }
});

test("HEVC tag repair is checked through native support, independently of device name", async () => {
  const result = await assessPlaybackCapabilities(
    { ...probe, videoCodec: "hevc", videoTag: "hev1", codecString: "hvc1.2.4.L120.B0" },
    {
      scope: {},
      mediaElement: { canPlayType: (type) => (type.includes("hev1.") ? "" : "probably") }
    }
  );
  assert.equal(result.video, true);
  assert.equal(result.needsRetag, true);
});
test("unknown AAC profile remains unknown and a DTS profile is queried explicitly", async () => {
  const types = [];
  const result = await assessPlaybackCapabilities(
    {
      ...probe,
      audioStreams: [
        { index: 0, codec: "aac", profile: "unknown" },
        { index: 1, codec: "dts", profile: "DTS-HD MA" }
      ]
    },
    {
      scope: {},
      mediaElement: {
        canPlayType: (type) => {
          types.push(type);
          return "probably";
        }
      }
    }
  );
  assert.equal(result.audio[0].supported, null);
  assert.equal(result.audio[1].supported, true);
  assert.ok(types.some((type) => type.includes("dtsl")));
});

test("the same MKV is Direct or Remux according to this browser's MIME answers", async () => {
  const { classifyPlayback } = await import("./playbackMethod.js");
  const source = { ...probe, container: "mkv" };
  for (const mkvSupported of [true, false]) {
    const mediaElement = {
      canPlayType: (type) =>
        type.includes("matroska") ? (mkvSupported ? "probably" : "") : "probably"
    };
    const playbackCapabilities = await assessPlaybackCapabilities(source, {
      scope: {},
      mediaElement
    });
    const verdict = classifyPlayback({ probe: { ...source, playbackCapabilities } });
    assert.equal(verdict.method, mkvSupported ? "direct" : "remux");
    if (!mkvSupported) assert.equal(verdict.reason, "container-mkv-unsupported-by-browser");
  }
});
test("HDR is a source annotation and does not hide an unsupported audio track", async () => {
  const { classifyPlayback } = await import("./playbackMethod.js");
  const { renderStreamPlaybackBadge } = await import("../../ui/components/streamPlaybackBadge.js");
  for (const colorTransfer of ["smpte2084", "arib-std-b67"]) {
    for (const codec of ["aac", "ac3"]) {
      const source = {
        ...probe,
        colorTransfer,
        audioCodec: codec,
        audioStreams: [
          { index: 0, codec, profile: codec === "aac" ? "LC" : "", channels: 6, sampleRate: 48000 }
        ]
      };
      const playbackCapabilities = await assessPlaybackCapabilities(source, {
        scope: {},
        mediaElement: { canPlayType: (type) => (type.includes("ac-3") ? "" : "probably") }
      });
      const assessed = { ...source, playbackCapabilities };
      assert.equal(
        classifyPlayback({ probe: assessed }).method,
        codec === "aac" ? "direct" : "audio-transcode"
      );
      const badge = renderStreamPlaybackBadge({ probe: assessed });
      if (codec === "aac") assert.match(badge, />Direct : HDR</);
      else {
        assert.match(badge, /AC3→AAC/);
        assert.doesNotMatch(badge, />Unknown</);
      }
    }
  }
});
test("missing container API evidence stays Unknown instead of forcing a relay", async () => {
  const { classifyPlayback } = await import("./playbackMethod.js");
  const playbackCapabilities = await assessPlaybackCapabilities(
    { ...probe, container: "mkv" },
    { scope: {}, mediaElement: null }
  );
  assert.equal(playbackCapabilities.container, null);
  assert.equal(
    classifyPlayback({ probe: { ...probe, container: "mkv", playbackCapabilities } }).method,
    "unknown"
  );
});
test("actual native tag support overrides a historical iOS heuristic", async () => {
  const { classifyPlayback } = await import("./playbackMethod.js");
  const source = {
    ...probe,
    videoCodec: "hevc",
    videoTag: "hev1",
    codecString: "hvc1.2.4.L120.90"
  };
  const playbackCapabilities = await assessPlaybackCapabilities(source, {
    scope: {},
    mediaElement: { canPlayType: () => "probably" }
  });
  assert.equal(
    classifyPlayback({
      probe: { ...source, playbackCapabilities },
      capabilities: { hevcHvc1Required: true }
    }).method,
    "direct"
  );
});

test("selecting a secondary audio track also checks the relay's MP4 video output", async () => {
  const { classifyPlayback } = await import("./playbackMethod.js");
  const source = {
    ...probe,
    container: "webm",
    videoCodec: "vp8",
    codecString: "",
    audioCodec: "ac3",
    audioStreams: [
      { index: 0, codec: "ac3", channels: 2 },
      { index: 1, codec: "opus", channels: 2 }
    ]
  };
  const playbackCapabilities = await assessPlaybackCapabilities(source, {
    scope: {},
    mediaElement: {
      canPlayType: (type) =>
        type.includes("ac-3") || type.startsWith("video/mp4") ? "" : "probably"
    }
  });
  assert.equal(playbackCapabilities.video, true);
  const result = classifyPlayback({ probe: { ...source, playbackCapabilities } });
  assert.equal(result.method, "transcode");
  assert.equal(result.reason, "relay-output-video-unsupported");
});

test("identical file configurations share one assessment, including concurrent calls", async () => {
  let queries = 0;
  let supported = true;
  const scope = {
    navigator: {
      mediaCapabilities: {
        async decodingInfo() {
          queries++;
          return { supported, smooth: supported, powerEfficient: supported };
        }
      }
    }
  };
  const options = { scope, mediaElement: { canPlayType: () => "probably" } };
  const [first, second] = await Promise.all([
    assessPlaybackCapabilities(probe, options),
    assessPlaybackCapabilities({ ...probe }, options)
  ]);
  assert.strictEqual(first, second);
  assert.equal(queries, 2, "one video and one audio query for the shared configuration");
  await assessPlaybackCapabilities({ ...probe, playbackCapabilities: first }, options);
  assert.equal(queries, 2, "prior local predictions do not alter the file-fact key");
  await assessPlaybackCapabilities({ ...probe, width: 3840 }, options);
  assert.equal(queries, 4, "a different decoding configuration needs its own answer");
  const { refreshDeviceCapabilities } = await import("./deviceCapabilitySession.js");
  supported = false;
  refreshDeviceCapabilities();
  const refreshed = await assessPlaybackCapabilities(probe, options);
  assert.equal(refreshed.video, false);
  assert.equal(queries, 6, "device changes invalidate old per-file predictions");
});

test("native and Movi predictions never share a cached verdict", async () => {
  let webCodecsQueries = 0;
  const scope = {
    VideoDecoder: {
      async isConfigSupported() {
        webCodecsQueries++;
        return { supported: false };
      }
    }
  };
  const mediaElement = { canPlayType: () => "probably" };
  const native = await assessPlaybackCapabilities(probe, { scope, mediaElement });
  const movi = await assessPlaybackCapabilities(probe, { scope, mediaElement, engine: "movi" });
  assert.equal(native.video, true);
  assert.equal(movi.video, false);
  assert.equal(webCodecsQueries, 1);
});

test("an unavailable browser API can recover instead of caching Unknown for the session", async () => {
  let unavailable = true;
  let calls = 0;
  const options = {
    scope: {},
    mediaElement: {
      canPlayType() {
        calls++;
        if (unavailable) throw Error("not ready");
        return "probably";
      }
    }
  };
  assert.equal((await assessPlaybackCapabilities(probe, options)).video, null);
  unavailable = false;
  assert.equal((await assessPlaybackCapabilities(probe, options)).video, true);
  const afterRecovery = calls;
  await assessPlaybackCapabilities(probe, options);
  assert.equal(calls, afterRecovery);
});

test("a device change during an in-flight assessment cannot return an old prediction", async () => {
  let release;
  let videoQueries = 0;
  const scope = {
    navigator: {
      mediaCapabilities: {
        decodingInfo(config) {
          if (config.video && ++videoQueries === 1)
            return new Promise((resolve) => {
              release = resolve;
            });
          return Promise.resolve({ supported: false });
        }
      }
    }
  };
  const pending = assessPlaybackCapabilities(probe, {
    scope,
    mediaElement: { canPlayType: () => "probably" }
  });
  await Promise.resolve();
  const { refreshDeviceCapabilities } = await import("./deviceCapabilitySession.js");
  refreshDeviceCapabilities();
  release({ supported: true });
  assert.equal((await pending).video, false);
  assert.equal(videoQueries, 2);
});
