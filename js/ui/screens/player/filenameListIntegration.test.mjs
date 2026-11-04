import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { filterFilenameStreams } from "../../../core/streams/filenameStreamPolicy.js";
import {
  filterPlayerStreams,
  nextEpisodeSelectionOptions,
  playerStreamProbeKey
} from "../../../core/streams/playerStreamPolicy.js";
import { selectAutoPlayStream } from "../../../core/streams/streamAutoPlaySelector.js";
import { resolveAutoPlayStream } from "../../../core/streams/streamAutoResolve.js";
import { setDeviceCapabilitiesForTests } from "../../../core/player/deviceCapabilities.js";
import { renderFilenamePlaybackBadge } from "../../components/filenamePlaybackBadge.js";
const player = readFileSync(new URL("./playerScreen.js", import.meta.url), "utf8");
const streamSource = readFileSync(new URL("../stream/streamScreen.js", import.meta.url), "utf8");
const detail = readFileSync(new URL("../detail/metaDetailsScreen.js", import.meta.url), "utf8");
const caps = {
  h264: true,
  hevc: false,
  aac: true,
  dts: false,
  containers: { mp4: true, mkv: false }
};
const rows = [
  { id: "remux", name: "Movie 720p H264 AAC.mkv", url: "https://media.test/remux", addonName: "A" },
  {
    id: "direct",
    name: "Movie 720p H264 AAC.mp4",
    url: "https://media.test/direct",
    addonName: "A"
  },
  { id: "unknown", name: "Movie 1080p", url: "https://media.test/unknown", addonName: "A" }
];
function method(source, name, deps = {}) {
  const start = source.search(new RegExp("^  (?:async )?" + name + "\\(", "m"));
  assert.ok(start >= 0, name);
  const end = source.indexOf("\n  },", start) + 6;
  return new Function(...Object.keys(deps), "return ({" + source.slice(start, end) + "});")(
    ...Object.values(deps)
  )[name];
}
const ids = (list) => list.map((row) => row.id);
test("stream page, old detail chooser, Sources and episode panel all use the same filename filter", () => {
  setDeviceCapabilitiesForTests(caps);
  try {
    for (const mode of ["ALL", "DIRECT", "DIRECT_REMUX"]) {
      const settings = { filenameStreamDisplayMode: mode };
      const deps = {
        filterFilenameStreams,
        filterPlayerStreams,
        PlayerSettingsStore: { get: () => settings },
        StreamBadgeSettingsStore: {
          snapshot: () => ({ showPlaybackLabels: false, compatibilityCheckEnabled: false })
        },
        getDeviceCapabilities: () => caps,
        PROBE_MODE: "client"
      };
      const expected = ids(filterFilenameStreams(rows, settings, caps));
      const list = method(streamSource, "getFilteredStreams", {
        ...deps,
        sortStreamsByAddonOrder: (list) => list
      });
      assert.deepEqual(
        ids(list.call({ streams: rows, sourceChips: [], addonFilter: "all" })),
        expected
      );
      const oldChooser = method(detail, "getFilteredEpisodeStreams", deps);
      assert.deepEqual(
        ids(
          oldChooser.call({
            getActivePendingSelection: () => ({ streams: rows, addonFilter: "all" })
          })
        ),
        expected
      );
      const filterList = method(player, "filterPlayerStreamList", deps);
      const sourcePanel = method(player, "getFilteredSources", deps);
      const episodePanel = method(player, "getFilteredEpisodePanelStreams", deps);
      const ctx = {
        streamCandidates: rows,
        episodePanelStreams: rows,
        sourceFilter: "all",
        episodePanelStreamFilter: "all",
        filterPlayerStreamList: filterList,
        getOrderedStreamCandidates: () => rows
      };
      assert.deepEqual(ids(sourcePanel.call(ctx)), expected);
      assert.deepEqual(ids(episodePanel.call(ctx)), expected);
      assert.deepEqual(
        ids(rows),
        ["remux", "direct", "unknown"],
        "canonical discovery list is preserved"
      );
    }
  } finally {
    setDeviceCapabilitiesForTests(null);
  }
});
test("initial discovery and next episode honor each mode without probing or broadening source scope", async () => {
  setDeviceCapabilitiesForTests(caps);
  try {
    for (const mode of ["ALL", "DIRECT", "DIRECT_REMUX"]) {
      const settings = {
        filenameStreamDisplayMode: mode,
        streamAutoPlayMode: "FIRST_STREAM",
        streamAutoPlayTimeoutSeconds: 0,
        streamAutoPlayHdrPreference: "ANY",
        streamAutoPlaySource: "INSTALLED_ADDONS_ONLY",
        streamAutoPlaySelectedAddons: ["A"]
      };
      const group = [{ addonName: "A", streams: rows }];
      const result = await resolveAutoPlayStream({
        itemType: "movie",
        videoId: "tt1",
        settings,
        installedAddonNames: new Set(["A"]),
        repository: {
          getStreamsFromAllAddons: async (_type, _id, options) => {
            options.onChunk({ status: "success", data: group });
            return { status: "success", data: group };
          }
        }
      });
      const expected = mode === "DIRECT" ? rows[1] : rows[0];
      assert.equal(result.selected.name, expected.name);
      const next = method(player, "selectNextEpisodeStreamByAutoPlayPolicy", {
        PlayerSettingsStore: { get: () => settings },
        StreamBadgeSettingsStore: { snapshot: () => ({ showPlaybackLabels: false }) },
        selectAutoPlayStream,
        nextEpisodeSelectionOptions
      });
      const chosen = await next.call({ getCurrentStreamBingeGroup: () => "" }, rows, settings, {
        installedAddonNames: new Set(["A"])
      });
      assert.equal(chosen.id, expected.id);
    }
  } finally {
    setDeviceCapabilitiesForTests(null);
  }
});
test("stream switching cannot cycle into a hidden row or fall back to the first hidden row", async () => {
  const settings = { filenameStreamDisplayMode: "DIRECT" };
  const switchStream = method(player, "switchStream", { playerStreamProbeKey });
  const plays = [];
  const ctx = {
    params: {},
    streamCandidates: rows,
    getCurrentStreamCandidate: () => rows[0],
    filterPlayerStreamList: (list) => filterFilenameStreams(list, settings, caps),
    playStreamCandidate: async (row) => plays.push(row.id)
  };
  await switchStream.call(ctx, 1);
  await switchStream.call(ctx, -1);
  assert.deepEqual(plays, ["direct", "direct"]);
  ctx.streamCandidates = [rows[0], rows[2]];
  await switchStream.call(ctx, 1);
  assert.equal(plays.length, 2);
});
test("player badge row keeps filename estimate first even when size is configured last", () => {
  const start = player.indexOf("function renderPlayerSourceBadges("),
    end = player.indexOf("\nfunction resolvePlayerSourceBadgePlacement", start);
  const render = new Function(
    "d",
    "const {renderFilenamePlaybackBadge,matchStreamBadges,renderPlayerImageBadgeChip,formatBytes,escapeHtml,t}=d;" +
      player.slice(start, end) +
      ";return renderPlayerSourceBadges;"
  )({
    renderFilenamePlaybackBadge: (row, settings) =>
      renderFilenamePlaybackBadge(row, settings, caps),
    matchStreamBadges: () => [{}],
    renderPlayerImageBadgeChip: () => '<span class="imported">imported</span>',
    formatBytes: () => "1 KB",
    escapeHtml: String,
    t: (_key, _args, fallback) => fallback
  });
  for (const sizeLast of [true, false]) {
    const html = render(
      { ...rows[0], behaviorHints: { videoSize: 1024 } },
      { showPlaybackLabels: true, rules: { imports: [] } },
      { sizeLast }
    );
    assert.ok(html.indexOf("filename-playback-badge") < html.indexOf('class="imported"'));
    assert.ok(
      html.indexOf("filename-playback-badge") < html.indexOf("stream-route-stream-badge size")
    );
  }
});
test("labels/settings remain filename-only and no list reader was reintroduced", () => {
  const settings = readFileSync(new URL("../settings/settingsScreen.js", import.meta.url), "utf8");
  assert.match(settings, /streams:toggle:filenameLabels/);
  assert.match(settings, /FILENAME_ESTIMATE_NOTICE/);
  assert.match(settings, /playback:filenameStreamFilter/);
  assert.match(settings, /FILENAME_FILTER_NOTICE/);
  assert.doesNotMatch(
    streamSource,
    /createStreamProber|scheduleUnknownProbes|probeStreamCandidate/
  );
  assert.doesNotMatch(detail, /keepOnlyDirectResolution|inspectAutoPlayStreams/);
  assert.doesNotMatch(player, /schedulePlayerStreamProbes/);
});

test("episode stream drawer renders browser cards without the removed metadata label renderer", () => {
  const render = method(player, "renderEpisodeStreamsView", {
    StreamBadgeSettingsStore: { snapshot: () => ({ showAddonLogo: false }) },
    resolvePlayerSourceBadgePlacement: () => "TOP",
    episodeDisplayCode: () => "S01E02",
    t: (_key, _params, fallback) => fallback,
    escapeHtml: String,
    escapeAttribute: String,
    Environment: { isBrowser: () => true },
    normalizeSourceForDisplay: (stream) => ({ accessibleLabel: stream.name }),
    renderBrowserSourceCardContent: () => '<div class="stream-route-title">Episode source</div>'
  });
  const ctx = {
    episodes: [{ title: "Episode 2" }],
    episodePanelIndex: 0,
    episodePanelStreamFilter: "all",
    getEpisodePanelStreamFilters: () => ["all", "A"],
    getFilteredEpisodePanelStreams: () => rows,
    renderPanelDownloadButton: (index) =>
      `<button data-player-download-index="${index}">Download</button>`
  };
  const html = render.call(ctx);
  assert.equal((html.match(/data-episode-stream-index=/g) || []).length, rows.length);
  assert.match(html, /Episode source/);
  assert.match(html, /data-episode-stream-action="back"/);
  assert.match(html, /data-player-episode-source/);
  ctx.episodePanelStreamsLoading = true;
  ctx.getFilteredEpisodePanelStreams = () => [];
  assert.match(render.call(ctx), /Finding stream source/);
  ctx.episodePanelStreamsLoading = false;
  assert.match(render.call(ctx), /No streams found/);
});
