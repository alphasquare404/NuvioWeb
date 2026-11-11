import { filterFilenameStreams } from "./filenameStreamPolicy.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  autoPlayCandidates,
  selectAutoPlayStream,
  collectInstalledAddonNames
} from "./streamAutoPlaySelector.js";
import {
  filterPlayerStreams,
  playerStreamProbeCandidates,
  nextEpisodeSelectionOptions
} from "./playerStreamPolicy.js";
const caps = { h264: true, aac: true, containers: { mp4: true, mkv: false } };
const facts = { container: "mp4", videoCodec: "h264", audioCodec: "aac" };
const labels = {
  compatibilityCheckEnabled: true,
  showPlaybackLabels: false,
  playbackLabelSource: "FILE_METADATA",
  labelAddons: ["A"],
  clientLabelLimit: 3
};
const row = (id, addonName = "A") => ({
  id,
  addonName,
  url: "https://fixture.test/" + id,
  name: id
});

test("cached facts outside background addons and quota remain eligible without broadening autoplay permissions", () => {
  const rows = [row("A1"), row("A2"), row("A3"), row("B1", "B")];
  const options = {
    settings: { streamDisplayMode: "DIRECT" },
    labels,
    capabilities: caps,
    mode: "client",
    probeForStream: () => facts
  };
  assert.equal(playerStreamProbeCandidates(rows, options).length, 0);
  const visible = filterPlayerStreams(rows, options);
  assert.equal(visible.length, 4);
  assert.deepEqual(
    selectAutoPlayStream(visible, {
      mode: "FIRST_STREAM",
      installedAddonNames: new Set(["A", "B"]),
      selectedAddons: ["B"]
    }),
    rows[3]
  );
});

test("regex and source permissions are mandatory before a binge preference, and preference alone cannot activate Manual", () => {
  const rows = [
    row("720p", "A"),
    { ...row("CAM 480p", "A"), behaviorHints: { bingeGroup: "same" } },
    { ...row("720p B", "B"), behaviorHints: { bingeGroup: "same" } }
  ];
  const options = {
    mode: "REGEX_MATCH",
    regexPattern: "720p",
    preferredBingeGroup: "same",
    preferBingeGroupInSelection: true,
    installedAddonNames: new Set(["A", "B"]),
    selectedAddons: ["A"]
  };
  assert.equal(selectAutoPlayStream(rows, options).id, "720p");
  assert.equal(selectAutoPlayStream(rows, { ...options, mode: "MANUAL" }), null);
  assert.equal(autoPlayCandidates(rows, { ...options, regexPattern: "[" }).length, 0);
});

test("Manual initial selection and Auto Next remain separate while next selection retains selected addons", () => {
  const settings = {
    streamAutoPlayMode: "MANUAL",
    streamAutoPlaySource: "INSTALLED_ADDONS_ONLY",
    streamAutoPlaySelectedAddons: ["A"],
    streamAutoPlayPreferBingeGroupForNextEpisode: true
  };
  assert.equal(nextEpisodeSelectionOptions(settings).mode, "MANUAL");
  const next = nextEpisodeSelectionOptions({ ...settings, autoplayNextEpisode: true });
  assert.equal(next.mode, "FIRST_STREAM");
  assert.equal(next.source, "INSTALLED_ADDONS_ONLY");
  assert.deepEqual(next.selectedAddons, ["A"]);
});

test("remembered links cannot bypass current source, regex or compatibility constraints", () => {
  const source = readFileSync(
    new URL("../../ui/screens/stream/streamScreen.js", import.meta.url),
    "utf8"
  );
  const method = source.match(/^ {2}maybeAutoResumeStream\([\s\S]*?\n {2}\},/m)[0];
  const saved = row("saved", "B");
  for (const extra of [
    { streamAutoPlaySelectedAddons: ["A"] },
    { streamAutoPlayMode: "REGEX_MATCH", streamAutoPlayRegex: "720p" }
  ]) {
    const settings = {
      streamAutoPlayMode: "FIRST_STREAM",
      streamReuseLastLinkEnabled: true,
      ...extra
    };
    const deps = {
      PlayerSettingsStore: { get: () => settings },
      StreamBadgeSettingsStore: { snapshot: () => labels },
      resolveHdrPreference: () => "ANY",
      StreamPreferencesStore: { getValid: () => ({ streamId: saved.id }) },
      buildStreamResumeIdentity: () => "",
      streamMergeKey: (s) => s.id,
      filterPlayerStreams,
      filterFilenameStreams,
      selectAutoPlayStream,
      collectInstalledAddonNames,
      getDeviceCapabilities: () => caps,
      PROBE_MODE: "client",
      addonRepository: { getCachedInstalledAddons: () => [{ name: "A" }, { name: "B" }] }
    };
    const screen = new Function(...Object.keys(deps), "return ({" + method + "});")(
      ...Object.values(deps)
    );
    let plays = 0;
    Object.assign(screen, {
      params: { resumePositionMs: 12000, continueWatchingBackHome: true },
      streams: [saved],
      getStreamProbe: () => ({ ...facts, container: extra.remux ? "mkv" : "mp4" }),
      playStream: () => plays++,
      requestRender() {}
    });
    screen.maybeAutoResumeStream({ allLoaded: true });
    assert.equal(plays, 0);
  }
});

test("next episode matches the saved plugin variant when episode names change", () => {
  const withGroup = (id, group) => ({ ...row(id), behaviorHints: { bingeGroup: group } });
  const rows = [
    withGroup("720p", "local-plugin-provider|720 ep2 english"),
    withGroup("1080p", "local-plugin-provider|1080 ep2 english"),
    withGroup("other", "local-plugin-other|1080 ep2 english")
  ];
  const selected = selectAutoPlayStream(rows, {
    mode: "FIRST_STREAM",
    preferredBingeGroup: "local-plugin-provider|1080 ep1 english",
    preferBingeGroupInSelection: true,
    bingeGroupOnly: true
  });
  assert.equal(selected?.id, "1080p");
});
