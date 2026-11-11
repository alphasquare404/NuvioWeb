import test from "node:test";
import assert from "node:assert/strict";
import {
  filterFilenameStreams,
  filenameStreamDisplayMode,
  filenameStreamFilter,
  toggleFilenameStreamFilter
} from "./filenameStreamPolicy.js";
import { filterPlayerStreams, nextEpisodeSelectionOptions } from "./playerStreamPolicy.js";
import { autoPlayCandidates, selectAutoPlayStream } from "./streamAutoPlaySelector.js";
import { setDeviceCapabilitiesForTests } from "../player/deviceCapabilities.js";
import { normalizePlayerSettings } from "../../data/local/playerSettingsStore.js";
import { renderFilenamePlaybackBadge } from "../../ui/components/filenamePlaybackBadge.js";
import { normalizeSourceForDisplay } from "../../ui/components/browserStreamSourceCard.js";
const caps = {
  h264: true,
  hevc: false,
  aac: true,
  dts: false,
  containers: { mp4: true, mkv: false }
};
const row = (id, name, addonName = "A") => ({
  id,
  name,
  addonName,
  url: "https://media.test/" + id
});
const direct = row("direct", "Film.H264.AAC.mp4");
const remux = row("remux", "Film.H264.AAC.mkv");
const audio = row("audio", "Film.H264.DTS.mkv");
const video = row("video", "Film.HEVC.AAC.mkv");
const unknown = row("unknown", "Film 1080p");
const rows = [remux, audio, unknown, video, direct];
const ids = (streams) => streams.map((stream) => stream.id);
test("new filename filter defaults All and never revives retired metadata preferences", () => {
  assert.equal(normalizePlayerSettings({}).filenamePlaybackRoutingEnabled, true);
  assert.equal(
    normalizePlayerSettings({ filenamePlaybackRoutingEnabled: false })
      .filenamePlaybackRoutingEnabled,
    false
  );
  for (const settings of [
    {},
    { streamDisplayMode: "DIRECT" },
    { showOnlyDirectStreams: true },
    { streamCompatibilityFilter: "LIKELY_DIRECT" },
    { filenameStreamDisplayMode: "broken" }
  ]) {
    assert.equal(filenameStreamDisplayMode(settings), "ALL");
    assert.equal(normalizePlayerSettings(settings).filenameStreamDisplayMode, "ALL");
    assert.equal(filterFilenameStreams(rows, settings, caps), rows);
  }
  assert.equal(
    normalizePlayerSettings({ filenameStreamDisplayMode: "DIRECT_REMUX" })
      .filenameStreamDisplayMode,
    "DIRECT_REMUX"
  );
});
test("All, Direct and Direct + Remux have identical policy for lists and automatic ranking with labels on or off", () => {
  for (const showPlaybackLabels of [true, false])
    for (const mode of ["ALL", "DIRECT", "DIRECT_REMUX"]) {
      const settings = {
        filenameStreamDisplayMode: mode,
        streamAutoPlayMode: "FIRST_STREAM",
        streamAutoPlayHdrPreference: "ANY"
      };
      const expected =
        mode === "ALL" ? ids(rows) : mode === "DIRECT" ? ["direct"] : ["remux", "direct"];
      assert.deepEqual(
        ids(
          filterPlayerStreams(rows, {
            settings,
            labels: { showPlaybackLabels },
            capabilities: caps
          })
        ),
        expected
      );
      assert.deepEqual(
        ids(
          autoPlayCandidates(rows, {
            mode: "FIRST_STREAM",
            filenameStreamDisplayMode: mode,
            capabilities: caps
          })
        ),
        expected
      );
    }
});
test("transcode filters add categories without changing saved Direct or Remux choices", () => {
  const settings = normalizePlayerSettings({
    filenameStreamDisplayMode: "DIRECT_REMUX",
    filenameTranscodeFilter: { audio: true, full: true }
  });
  assert.equal(settings.filenameStreamDisplayMode, "DIRECT_REMUX");
  assert.deepEqual(ids(filterFilenameStreams(rows, settings, caps)), [
    "remux",
    "audio",
    "video",
    "direct"
  ]);
  const options = nextEpisodeSelectionOptions({ ...settings, streamAutoPlayMode: "FIRST_STREAM" });
  assert.deepEqual(ids(autoPlayCandidates(rows, { ...options, capabilities: caps })), [
    "remux",
    "audio",
    "video",
    "direct"
  ]);
  assert.equal(normalizePlayerSettings({}).probeStream, "unknown-or-transcode");
  assert.equal(
    normalizePlayerSettings({ probeStream: "when-transcoding" }).probeStream,
    "unknown-or-transcode"
  );
  assert.equal(normalizePlayerSettings({ probeStream: "always" }).probeStream, "always");
});

test("legacy filters retain their exact selections while any new category can stand alone", () => {
  assert.deepEqual(
    filenameStreamFilter(normalizePlayerSettings({ filenameStreamDisplayMode: "DIRECT" })),
    ["direct"]
  );
  const legacy = normalizePlayerSettings({ filenameStreamDisplayMode: "DIRECT_REMUX" });
  assert.deepEqual(filenameStreamFilter(legacy), ["direct", "remux"]);
  assert.deepEqual(
    filenameStreamFilter({
      ...legacy,
      filenameTranscodeFilter: { audio: true, full: true }
    }),
    ["direct", "remux", "audio-transcode", "transcode"]
  );
  const settings = normalizePlayerSettings({
    ...legacy,
    filenameStreamFilter: ["transcode", "invalid", "audio-transcode", "transcode"],
    streamAutoPlayMode: "FIRST_STREAM"
  });
  assert.equal(settings.filenameStreamDisplayMode, "DIRECT_REMUX");
  assert.deepEqual(filenameStreamFilter(settings), ["audio-transcode", "transcode"]);
  assert.deepEqual(ids(filterPlayerStreams(rows, { settings, capabilities: caps })), [
    "audio",
    "video"
  ]);
  assert.deepEqual(
    ids(autoPlayCandidates(rows, { ...nextEpisodeSelectionOptions(settings), capabilities: caps })),
    ["audio", "video"]
  );
  assert.deepEqual(toggleFilenameStreamFilter(["all"], "remux"), ["remux"]);
  assert.deepEqual(toggleFilenameStreamFilter(["remux"], "remux"), ["all"]);
  assert.deepEqual(toggleFilenameStreamFilter(["direct", "transcode"], "all"), ["all"]);
  assert.equal(filterFilenameStreams(rows, { filenameStreamFilter: ["all"] }, caps), rows);
});

test("filter compares the same filename against this device rather than applying an MKV rule", () => {
  assert.deepEqual(
    filterFilenameStreams([remux], { filenameStreamDisplayMode: "DIRECT" }, caps),
    []
  );
  assert.deepEqual(
    filterFilenameStreams(
      [remux],
      { filenameStreamDisplayMode: "DIRECT" },
      { ...caps, containers: { mp4: true, mkv: true } }
    ),
    [remux]
  );
  assert.deepEqual(
    filterFilenameStreams(
      [video],
      { filenameStreamDisplayMode: "DIRECT_REMUX" },
      { ...caps, hevc: true }
    ),
    [video]
  );
});
test("metadata, probe scope, label visibility and remux availability do not replace filename estimates", () => {
  const misleading = {
    ...direct,
    probe: { container: "mkv", videoCodec: "hevc", audioCodec: "dts" },
    playbackCapabilities: { video: false }
  };
  assert.deepEqual(
    filterPlayerStreams([misleading], {
      settings: { filenameStreamDisplayMode: "DIRECT" },
      labels: { showPlaybackLabels: false, playbackLabelSource: "FILE_METADATA", labelAddons: [] },
      probeForStream: () => misleading.probe,
      capabilities: caps
    }),
    [misleading]
  );
});
test("source/regex constraints stay mandatory and no-match never escapes the filename filter", () => {
  const allowed = {
    ...remux,
    name: "Film 720p H264 AAC.mkv",
    behaviorHints: { bingeGroup: "same" }
  };
  const forbidden = { ...direct, addonName: "B", name: "Film 720p H264 AAC.mp4" };
  const options = {
    mode: "REGEX_MATCH",
    regexPattern: "720p",
    source: "INSTALLED_ADDONS_ONLY",
    installedAddonNames: new Set(["A", "B"]),
    selectedAddons: ["A"],
    filenameStreamDisplayMode: "DIRECT",
    capabilities: caps,
    preferredBingeGroup: "same",
    preferBingeGroupInSelection: true
  };
  assert.equal(selectAutoPlayStream([forbidden, allowed], options), null);
  assert.equal(
    selectAutoPlayStream([forbidden, allowed], {
      ...options,
      filenameStreamDisplayMode: "DIRECT_REMUX"
    }),
    allowed
  );
  assert.equal(
    selectAutoPlayStream([allowed], {
      ...options,
      filenameStreamDisplayMode: "DIRECT_REMUX",
      regexPattern: "2160p"
    }),
    null
  );
});
test("manual Auto Next carries the filename filter without weakening addon constraints", () => {
  setDeviceCapabilitiesForTests(caps);
  try {
    const settings = {
      streamAutoPlayMode: "MANUAL",
      autoplayNextEpisode: true,
      streamAutoPlaySource: "INSTALLED_ADDONS_ONLY",
      streamAutoPlaySelectedAddons: ["A"],
      filenameStreamDisplayMode: "DIRECT"
    };
    const options = nextEpisodeSelectionOptions(settings, {
      installedAddonNames: new Set(["A", "B"])
    });
    assert.equal(options.filenameStreamDisplayMode, "DIRECT");
    assert.equal(selectAutoPlayStream([remux, { ...direct, addonName: "B" }], options), null);
    assert.equal(selectAutoPlayStream([remux, direct], options), direct);
  } finally {
    setDeviceCapabilitiesForTests(null);
  }
});
test("filename labels are always estimated and disappear independently of filtering", () => {
  for (const [stream, label, tone] of [
    [direct, "Direct", "green"],
    [remux, "Repackage", "blue"],
    [audio, "Transcode", "orange"],
    [video, "Unsupported", "red"],
    [unknown, "Unknown", "neutral"]
  ]) {
    const html = renderFilenamePlaybackBadge(stream, {}, caps);
    assert.match(html, new RegExp(`(?:alt="${label}"|>${label}</span)`));
    assert.match(html, new RegExp("tone-" + tone));
    assert.match(html, /Estimates only/);
    assert.match(html, /File contents have not been checked/);
    assert.equal(renderFilenamePlaybackBadge(stream, { showPlaybackLabels: false }, caps), "");
  }
});
test("badge row puts the estimate before size and imported badges at either position", () => {
  setDeviceCapabilitiesForTests(caps);
  try {
    for (const badgePlacement of ["TOP", "BOTTOM"]) {
      const model = normalizeSourceForDisplay(
        { ...direct, behaviorHints: { videoSize: 1024 } },
        {
          badgeSettings: {
            showPlaybackLabels: true,
            showFileSizeBadges: true,
            badgePlacement,
            rules: { imports: [] }
          },
          streamBadgesEnabled: true
        }
      );
      const html = badgePlacement === "TOP" ? model.topBadges : model.bottomBadges;
      assert.ok(html.indexOf("filename-playback-badge") >= 0);
      assert.ok(
        html.indexOf("filename-playback-badge") < html.indexOf("stream-route-stream-badge size")
      );
    }
    const model = normalizeSourceForDisplay(direct, {
      badgeSettings: { showPlaybackLabels: true, rules: { imports: [] } },
      streamBadgesEnabled: false
    });
    assert.match(model.badges, /filename-playback-badge/);
  } finally {
    setDeviceCapabilitiesForTests(null);
  }
});
