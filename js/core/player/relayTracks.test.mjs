import { canSwitchHlsAudioCodecs } from "./relayTracks.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseHlsAudioIndices,
  mergeRelayRenditionTracks,
  relayTrackContext,
  relayAudioUrl,
  createRelaySubtitleTransport
} from "./relayTracks.js";
const base = "https://app.test/";
const source =
  "/api/transcode/hls/index.m3u8?u=https%3A%2F%2Fsource.test%2Ffilm.mkv&v=copy&a=copy&ai=3&token=secret";

test("only this host HLS relay exposes source tracks; switching preserves copy policy and access", () => {
  const context = relayTrackContext(source, "/api/transcode", base);
  assert.equal(context.source, "https://source.test/film.mkv");
  assert.equal(context.audioIndex, 3);
  const switched = new URL(relayAudioUrl(context, 1));
  assert.equal(switched.pathname, "/api/transcode/hls/index.m3u8");
  for (const [key, value] of [
    ["v", "copy"],
    ["a", "copy"],
    ["token", "secret"],
    ["ai", "1"]
  ])
    assert.equal(switched.searchParams.get(key), value);
  assert.equal(relayAudioUrl(context, 8), null);
  for (const url of ["https://other.test" + source, "/movie.m3u8", source.replace("ai=3", "ai=-1")])
    assert.equal(relayTrackContext(url, "/api/transcode", base), null);
});

test("server subtitles use the existing authenticated relay rather than browser fetching the MKV", async () => {
  const context = relayTrackContext(source, "/api/transcode", base),
    calls = [];
  const port = createRelaySubtitleTransport(context, {
    fetchImpl: async (url) => {
      calls.push(new URL(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          tracks: [{ id: 7 }],
          result: { from: 10, to: 30, cues: [] }
        })
      };
    }
  });
  const receive = (message) =>
    new Promise((resolve) => {
      port.onmessage = (event) => resolve(event.data);
      port.postMessage(message);
    });
  const tracks = await receive({ type: "open", sourceId: "s" });
  assert.equal(tracks.tracks[0].id, 7);
  const window = await receive({
    type: "window",
    sourceId: "s",
    requestId: 2,
    trackId: 7,
    time: 15
  });
  assert.equal(window.requestId, 2);
  assert.equal(window.result.from, 10);
  for (const url of calls) {
    assert.equal(url.origin, "https://app.test");
    assert.equal(url.pathname, "/api/transcode");
    assert.equal(url.searchParams.get("token"), "secret");
  }
  assert.equal(calls[1].searchParams.get("time"), "15");
  port.terminate();
});

test("replacing a subtitle window or leaving playback ignores late responses", async () => {
  const context = relayTrackContext(source, "/api/transcode", base),
    pending = [],
    events = [];
  const port = createRelaySubtitleTransport(context, {
    fetchImpl: () => new Promise((resolve) => pending.push(resolve))
  });
  port.onmessage = (event) => events.push(event.data);
  port.postMessage({ type: "open", sourceId: "s" });
  port.postMessage({ type: "window", sourceId: "s", requestId: 2, trackId: 7, time: 90 });
  pending[0]({ ok: true, status: 200, json: async () => ({ ok: true, tracks: [{ id: 99 }] }) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(events.length, 0);
  port.terminate();
  pending[1]({ ok: true, status: 200, json: async () => ({ ok: true, result: { cues: [] } }) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(events.length, 0);
});

test("subtitle discovery waits for the existing HLS job after an audio change", async () => {
  const context = relayTrackContext(source, "/api/transcode", base);
  let requests = 0;
  const port = createRelaySubtitleTransport(context, {
    fetchImpl: async () =>
      ++requests < 3
        ? {
            ok: false,
            status: 409,
            json: async () => ({ ok: false, error: "subtitle-hls-not-ready" })
          }
        : { ok: true, status: 200, json: async () => ({ ok: true, tracks: [{ id: 9 }] }) }
  });
  const result = await new Promise((resolve) => {
    port.onmessage = (event) => resolve(event.data);
    port.postMessage({ type: "open", sourceId: "new-audio" });
  });
  assert.equal(requests, 3);
  assert.equal(result.type, "tracks");
  assert.equal(result.tracks[0].id, 9);
  port.terminate();
});

test("AAC rendition selection uses verified tracks and existing delivery remains available for mixed codecs", () => {
  const probe = {
    audioStreams: [
      { index: 0, codec: "aac" },
      { index: 1, codec: "aac" }
    ]
  };
  assert.deepEqual(chooseHlsAudioIndices(probe, 1), [0, 1]);
  assert.equal(chooseHlsAudioIndices(null, 0), null);
  assert.equal(
    chooseHlsAudioIndices(
      {
        audioStreams: [
          { index: 0, codec: "aac" },
          { index: 1, codec: "ac3" }
        ]
      },
      0
    ),
    null
  );
  probe.playbackCapabilities = { audio: [{ index: 1, supported: false }] };
  assert.equal(chooseHlsAudioIndices(probe, 0), null);
});

test("alternate audio menu retains the native selector and source language without relay restart entries", () => {
  const context = relayTrackContext(source + "&audios=0%2C3", "/api/transcode", base);
  const result = mergeRelayRenditionTracks(
    context,
    [
      { index: 0, language: "jpn", codec: "aac", engine: "relay" },
      { index: 3, language: "eng", codec: "aac", engine: "relay" }
    ],
    [
      { id: 0, index: 0, engine: "hls.js", selected: false },
      { id: 1, index: 1, engine: "hls.js", selected: true }
    ]
  );
  assert.equal(result[1].language, "eng");
  assert.equal(result[1].index, 1);
  assert.equal(result[1].engine, "hls.js");
  assert.equal(result[1].selected, true);
  const reordered = mergeRelayRenditionTracks(
    context,
    [
      { index: 0, language: "jpn" },
      { index: 3, language: "eng" }
    ],
    [
      { index: 0, label: "audio_2", engine: "native", selected: true },
      { index: 1, label: "audio_1", engine: "native", selected: false }
    ]
  );
  assert.equal(reordered[0].language, "eng");
  assert.deepEqual(
    relayTrackContext(source + "&audios=3,0", "/api/transcode", base).audioIndices,
    [0, 3]
  );
});

test("AC3 and EAC3 alternate audio follow the same-codec device assessment without AAC encoding", () => {
  for (const codec of ["ac3", "eac3"]) {
    const probe = {
      audioStreams: [
        { index: 0, codec, profile: "" },
        { index: 1, codec, profile: "Dolby" }
      ],
      playbackCapabilities: {
        audio: [
          { index: 0, supported: true },
          { index: 1, supported: true }
        ]
      }
    };
    assert.deepEqual(chooseHlsAudioIndices(probe, 1), [0, 1]);
    probe.playbackCapabilities.audio[1].supported = false;
    assert.equal(chooseHlsAudioIndices(probe, 0), null);
  }
  assert.equal(
    chooseHlsAudioIndices(
      {
        audioStreams: [
          { index: 0, codec: "aac", profile: "LC" },
          { index: 1, codec: "aac", profile: "HE-AAC" }
        ]
      },
      0
    ),
    null
  );
  assert.deepEqual(
    chooseHlsAudioIndices(
      {
        audioStreams: [
          { index: 0, codec: "dts" },
          { index: 1, codec: "dts" }
        ],
        playbackCapabilities: {
          audio: [
            { index: 0, supported: true },
            { index: 1, supported: true }
          ]
        }
      },
      0
    ),
    [0, 1]
  );
});

test("mixed EAC3/AAC keeps source tracks when codec switching is available and respects device refusals", () => {
  const probe = {
    audioStreams: [
      { index: 0, codec: "eac3", channels: 2, sampleRate: 48000 },
      { index: 1, codec: "aac", profile: "LC", channels: 2, sampleRate: 44100 }
    ],
    playbackCapabilities: {
      audio: [
        { index: 0, supported: true },
        { index: 1, supported: true }
      ]
    }
  };
  assert.deepEqual(chooseHlsAudioIndices(probe, 0, { canChangeCodec: true }), [0, 1]);
  assert.equal(chooseHlsAudioIndices(probe, 0, { canChangeCodec: false }), null);
  probe.playbackCapabilities.audio[1].supported = false;
  assert.equal(chooseHlsAudioIndices(probe, 0, { canChangeCodec: true }), null);
});

test("codec switching detection checks actual source-buffer capability", () => {
  assert.equal(canSwitchHlsAudioCodecs({ SourceBuffer: { prototype: { changeType() {} } } }), true);
  assert.equal(
    canSwitchHlsAudioCodecs({ ManagedSourceBuffer: { prototype: { changeType() {} } } }),
    true
  );
  assert.equal(
    canSwitchHlsAudioCodecs({ MediaSource: {}, SourceBuffer: { prototype: {} } }),
    false
  );
  assert.equal(canSwitchHlsAudioCodecs({}), false);
});
