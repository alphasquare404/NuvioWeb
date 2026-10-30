import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { relayTrackContext, relayAudioUrl } from "../../../core/player/relayTracks.js";
const source = readFileSync(new URL("./playerScreen.js", import.meta.url), "utf8");
function method(start, end, globals = {}) {
  const body = source
    .slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
    .trim()
    .replace(/,$/, "");
  return vm.runInNewContext("({" + body + "})", globals);
}
const playback =
  "/api/transcode/hls/index.m3u8?u=https%3A%2F%2Fsource.test%2Fmovie.mkv&v=copy&a=copy&ai=1&token=secret";

test("relay track discovery lists source audio and retains subtitle selection on repeated manifest warmup", async () => {
  let creates = 0,
    refreshes = 0;
  const video = {},
    subtitles = { setDelay() {}, setSource() {}, destroy() {} };
  const controller = {
    video,
    setSourceDurationHint(url, seconds) {
      this.hint = { url, seconds };
    }
  };
  const clear = method(
    "  clearRelayTrackData() {",
    "  async loadRelayTrackData("
  ).clearRelayTrackData;
  const load = method(
    "  async loadRelayTrackData(playbackUrl) {",
    "  async loadManifestTrackDataForCurrentStream(",
    {
      PlayerController: controller,
      relayTrackContext: (url, endpoint) => relayTrackContext(url, endpoint, "https://app.test/"),
      TRANSCODE_ENDPOINT: "/api/transcode",
      createStreamProber: () => ({
        probe: async () => ({
          container: "mkv",
          durationSeconds: 3119.104,
          audioStreams: [
            { index: 0, language: "jpn", codec: "aac" },
            { index: 1, language: "eng", codec: "aac" }
          ]
        })
      }),
      PROBE_ENDPOINT: "/api/probe",
      PROBE_MODE: "server",
      PROBE_CLIENT_CONCURRENCY: 1,
      assessPlaybackCapabilities: () => {},
      createEmbeddedSubtitles: () => {
        creates++;
        return subtitles;
      },
      document: { baseURI: "https://app.test/" }
    }
  ).loadRelayTrackData;
  const ctx = {
    clearRelayTrackData: clear,
    refreshTrackDialogs() {
      refreshes++;
    }
  };
  await load.call(ctx, playback);
  assert.equal(controller.hint.url, playback);
  assert.equal(controller.hint.seconds, 3119.104);
  assert.equal(ctx.relayAudioTracks.length, 2);
  assert.equal(ctx.relayAudioTracks[1].selected, true);
  assert.equal(creates, 1);
  await load.call(ctx, playback);
  assert.equal(creates, 1);
  assert.equal(refreshes, 1);
});

test("late source metadata cannot populate another playback session", async () => {
  let resolve;
  const clear = method(
    "  clearRelayTrackData() {",
    "  async loadRelayTrackData("
  ).clearRelayTrackData;
  const load = method(
    "  async loadRelayTrackData(playbackUrl) {",
    "  async loadManifestTrackDataForCurrentStream(",
    {
      PlayerController: { video: {} },
      relayTrackContext: (url, endpoint) => relayTrackContext(url, endpoint, "https://app.test/"),
      TRANSCODE_ENDPOINT: "/api/transcode",
      createStreamProber: () => ({
        probe: () =>
          new Promise((r) => {
            resolve = r;
          })
      }),
      PROBE_ENDPOINT: "/api/probe",
      PROBE_MODE: "server",
      PROBE_CLIENT_CONCURRENCY: 1,
      assessPlaybackCapabilities: () => {}
    }
  ).loadRelayTrackData;
  const ctx = {
    clearRelayTrackData: clear,
    refreshTrackDialogs() {
      throw Error("stale refresh");
    }
  };
  const pending = load.call(ctx, playback);
  clear.call(ctx);
  resolve({ audioStreams: [{ index: 0 }] });
  await pending;
  assert.equal(ctx.relayAudioTracks.length, 0);
  assert.equal(ctx.relayTextSubtitles, null);
});

test("selecting relay audio uses existing HLS URL and requests playback-state preservation", async () => {
  let calls = 0,
    options,
    target;
  const apply = method(
    "  applyAudioTrack(index, { automaticFallback = false, rememberSelection = false } = {}) {",
    "  renderAudioDialog() {",
    { relayAudioUrl, console }
  ).applyAudioTrack;
  const ctx = {
    relayTrackContext: relayTrackContext(playback, "/api/transcode", "https://app.test/"),
    getAudioEntries: () => [
      {
        selected: false,
        supported: true,
        browserAudioTrackIndex: 0,
        track: { engine: "relay", index: 0 }
      }
    ],
    playStreamByUrl: async (url, opts) => {
      calls++;
      target = url;
      options = opts;
    }
  };
  apply.call(ctx, 0);
  apply.call(ctx, 0);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls, 1);
  assert.equal(new URL(target).searchParams.get("ai"), "0");
  assert.equal(new URL(target).searchParams.get("a"), "copy");
  assert.equal(options.preservePlaybackState, true);
  assert.equal(ctx.relayAudioSwitching, false);
});

test("rendition audio selection uses the active HLS selector without reloading the video", () => {
  let selected = -1,
    reloads = 0;
  const apply = method(
    "  applyAudioTrack(index, { automaticFallback = false, rememberSelection = false } = {}) {",
    "  renderAudioDialog() {",
    {
      PlayerController: {
        setBrowserAudioTrack: (index) => {
          selected = index;
          return true;
        }
      }
    }
  ).applyAudioTrack;
  const ctx = {
    getAudioEntries: () => [
      { browserAudioTrackIndex: 1, track: { engine: "hls.js" }, supported: true }
    ],
    playStreamByUrl() {
      reloads++;
    },
    invalidateTrackDialogCaches() {},
    renderControlButtons() {},
    renderAudioDialog() {}
  };
  apply.call(ctx, 0);
  assert.equal(selected, 1);
  assert.equal(reloads, 0);
});
