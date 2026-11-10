import { renderFilterPicker } from "../../components/filterPicker.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  browserPlayerChrome,
  browserPlayerControls,
  browserPlayerLayout,
  playerPanelHead,
  playerChoice,
  playerText,
  playerDesignIcon
} from "./browserPlayerPresentation.js";
const source = readFileSync(new URL("./playerScreen.js", import.meta.url), "utf8");
const deps = {
  Environment: { isBrowser: () => true },
  t: (_key, _args, fallback) => fallback,
  escapeAttribute: String,
  escapeHtml: String
};
function method(signature, extra = {}, sourceText = source) {
  const source = sourceText;
  const start = source.indexOf("  " + signature),
    end = source.indexOf("\n  },", start);
  assert.ok(start >= 0, signature);
  const values = { ...deps, ...extra };
  return new Function(...Object.keys(values), "return ({" + source.slice(start, end + 5) + "});")(
    ...Object.values(values)
  );
}
test("initial volume markup hides unsupported and unknown volume without a visible frame", () => {
  const render = method("renderDesktopPlaybackTools()", {}).renderDesktopPlaybackTools;
  const ctx = {
    getDesktopVolumeState: () => ({ volume: 1, muted: false }),
    isDesktopPictureInPictureSupported: () => false,
    getDesktopFullscreenCapability: () => false
  };
  assert.match(render.call(ctx), /data-player-desktop-volume[^>]*hidden disabled/);
  ctx.desktopVolumeReadOnly = true;
  assert.match(render.call(ctx), /data-player-desktop-volume[^>]*hidden disabled/);
  ctx.desktopVolumeReadOnly = false;
  assert.doesNotMatch(render.call(ctx), /data-player-desktop-volume[^>]*hidden disabled/);
});
test("browser toolbar always exposes core actions with no action pagination", () => {
  const run = method("getBrowserToolbarControls(base)").getBrowserToolbarControls;
  const base = [
    "playPause",
    "playNextEpisode",
    "subtitleDialog",
    "audioTrack",
    "source",
    "episodes"
  ].map((action) => ({ action }));
  const controls = run.call({}, base);
  assert.deepEqual(
    controls.map((c) => c.action),
    [
      "playPause",
      "seekBack10",
      "seekForward10",
      "playNextEpisode",
      "subtitleDialog",
      "audioTrack",
      "episodes",
      "source",
      "more"
    ]
  );
  assert.equal(
    run.call({ offlineDownloadId: "local" }, base).find((c) => c.action === "source").title,
    "File"
  );
});
test("Rotate is absent on desktop and retained for touch tablets", () => {
  const mixin = readFileSync(
    new URL("./browserPlayerPresentationScreen.js", import.meta.url),
    "utf8"
  );
  const render = method(
    "renderProposalMore()",
    {
      t: (_key, fallback) => fallback,
      playerPanelHead,
      playerText,
      playerDesignIcon
    },
    mixin
  ).renderProposalMore;
  const panel = { classList: { toggle() {}, add() {} }, innerHTML: "" };
  const ctx = {
    uiRefs: { mobileMorePanel: panel },
    moreActionsVisible: true,
    browserOrientation: { mobile: false },
    getProposalLayout() {
      return browserPlayerLayout({
        touch: this.browserOrientation.mobile,
        width: 1180,
        height: 820
      });
    },
    getPlaybackSpeed: () => 1,
    getPlaybackSpeedOptions: () => [1],
    isDesktopPictureInPictureSupported: () => false,
    canOpenInExternalPlayer: () => false
  };
  render.call(ctx);
  assert.doesNotMatch(panel.innerHTML, /data-action="rotate"/);
  ctx.browserOrientation.mobile = true;
  render.call(ctx);
  assert.match(panel.innerHTML, /data-action="rotate"/);
  assert.doesNotMatch(panel.innerHTML, /data-action="airplay"/);
  ctx.isPlayerAirPlaySupported = () => true;
  ctx.getDesktopPlaybackVideo = () => ({ webkitCurrentPlaybackTargetIsWireless: true });
  for (const mobile of [false, true]) {
    ctx.browserOrientation.mobile = mobile;
    render.call(ctx);
    assert.match(panel.innerHTML, /data-action="airplay"/);
    assert.match(panel.innerHTML, /Connected/);
  }
  ctx.isPlayerAirPlaySupported = () => false;
  render.call(ctx);
  assert.doesNotMatch(panel.innerHTML, /data-action="airplay"/);
});
test("Next invokes the existing next episode policy with user intent", () => {
  let options;
  const run = method("performControlAction(action)").performControlAction;
  run.call(
    {
      playNextEpisode: (o) => {
        options = o;
      }
    },
    "playNextEpisode"
  );
  assert.deepEqual(options, { userInitiated: true });
});
test("offline next selects the next downloaded episode without querying addon streams", async () => {
  const run = method("async playNextEpisode({ userInitiated = false } = {})").playNextEpisode;
  const next = { season: 1, episode: 3, offlineDownloadId: "local3" };
  let played;
  const ctx = {
    offlineDownloadId: "local2",
    params: { season: 1, episode: 2 },
    episodes: [{ season: 1, episode: 2 }, next],
    loadOfflinePlayerLibrary: async () => {},
    playOfflinePlayerEpisode: async (e) => {
      played = e;
      return true;
    }
  };
  assert.equal(await run.call(ctx, { userInitiated: true }), true);
  assert.equal(played, next);
});

test("approved desktop transport groups primary controls, volume, then panel actions", () => {
  const controls = [
    "playPause",
    "playNextEpisode",
    "subtitleDialog",
    "audioTrack",
    "episodes",
    "source",
    "more"
  ].map((action) => ({ action }));
  const render = (volumeSupported) =>
    browserPlayerControls({
      controls,
      paused: false,
      volume: 0.7,
      muted: false,
      volumeSupported,
      fullscreen: true,
      labels: {}
    }).toolbar;
  const html = render(true);
  assert.ok(html.indexOf("nv-primary-row") < html.indexOf("nv-volume"));
  assert.ok(html.indexOf("nv-volume") < html.indexOf("nv-utilities"));
  assert.ok(
    html.indexOf('data-action="subtitleDialog"') < html.indexOf('data-action="audioTrack"')
  );
  assert.ok(html.indexOf('data-action="episodes"') < html.indexOf('data-action="source"'));
  for (const supported of [false, undefined]) {
    assert.match(render(supported), /class="nv-volume[^>]* hidden/);
    assert.match(render(supported), /data-player-desktop-volume[^>]*hidden disabled/);
  }
});
test("approved time row precedes seekbar and toolbar rather than occupying the toolbar", () => {
  const html = browserPlayerChrome({ title: "A < B", subtitle: "S1 E1" });
  assert.ok(html.indexOf("nv-time-row") < html.indexOf('id="playerProgressShell"'));
  assert.ok(html.indexOf('id="playerProgressShell"') < html.indexOf('id="playerControlButtons"'));
  assert.match(html, /A &lt; B/);
  assert.match(html, /data-player-remaining/);
});
test("large tablets use desktop transport with Rotate while desktop has no Rotate", () => {
  assert.deepEqual(browserPlayerLayout({ touch: false, width: 1440, height: 900 }), {
    desktop: true,
    portrait: false,
    rotate: false
  });
  assert.deepEqual(browserPlayerLayout({ touch: true, width: 1180, height: 820 }), {
    desktop: true,
    portrait: false,
    rotate: true
  });
  assert.deepEqual(
    browserPlayerLayout({ touch: true, width: 390, height: 844, preference: "portrait" }),
    { desktop: false, portrait: true, rotate: true }
  );
});

test("flat subtitle panel keeps a single selected Off choice and separates built-in from addon tracks", () => {
  const mixin = readFileSync(
    new URL("./browserPlayerPresentationScreen.js", import.meta.url),
    "utf8"
  );
  const render = method(
    "renderProposalSubtitle()",
    {
      t: (_key, fallback) => fallback,
      playerPanelHead,
      playerText,
      playerDesignIcon,
      playerChoice
    },
    mixin
  ).renderProposalSubtitle;
  const dialog = {
    classList: { add() {}, toggle() {} },
    innerHTML: "",
    querySelector: () => ({ scrollTop: 0 })
  };
  const choices = {
    __off__: [{ sourceType: "off", title: "Off", selected: true }],
    en: [{ sourceType: "internal", title: "SRT" }],
    id: [{ sourceType: "addon", title: "OpenSubtitles" }]
  };
  render.call({
    uiRefs: { subtitleDialog: dialog },
    subtitleDialogVisible: true,
    getSubtitleLanguageRailItems: () => Object.keys(choices).map((key) => ({ key, label: key })),
    getSubtitleOptionsForLanguage: (key) => choices[key],
    getSelectedSubtitleLanguageKey: () => "__off__"
  });
  assert.equal((dialog.innerHTML.match(/data-action="proposalSubtitleOff"/g) || []).length, 1);
  assert.doesNotMatch(dialog.innerHTML, /data-proposal-subtitle-language="__off__"/);
  assert.match(dialog.innerHTML, /data-action="proposalSubtitleOff"[^>]*aria-pressed="true"/);
  assert.ok(dialog.innerHTML.indexOf("Built-in") < dialog.innerHTML.indexOf("Add-ons"));
});

test("content guidance keeps every category in a separate compact row and escapes metadata", () => {
  const mixin = readFileSync(
    new URL("./browserPlayerPresentationScreen.js", import.meta.url),
    "utf8"
  );
  const render = method(
    "renderProposalWarning()",
    {
      playerText,
      t: (_key, fallback) => fallback
    },
    mixin
  ).renderProposalWarning;
  const overlay = { classList: { add() {}, toggle() {} }, innerHTML: "" };
  const ctx = {
    uiRefs: { root: { classList: { contains: () => true } }, parentalGuide: overlay },
    parentalGuideVisible: true,
    parentalWarnings: [
      { label: "Violence <test>", severity: "Severe" },
      { label: "Alcohol/Drugs", severity: "Moderate" },
      { label: "Frightening", severity: "Mild" }
    ]
  };
  assert.equal(render.call(ctx), true);
  assert.equal((overlay.innerHTML.match(/class="nv-warning-item"/g) || []).length, 3);
  assert.match(overlay.innerHTML, /Violence &lt;test&gt;/);
  assert.match(overlay.innerHTML, /Alcohol\/Drugs/);
  assert.match(overlay.innerHTML, /Moderate/);
  assert.match(overlay.innerHTML, /Alcohol\/Drugs: <span/);
  assert.match(overlay.innerHTML, /class="nv-warning-line"/);
  assert.match(overlay.innerHTML, /--nv-warning-index:2/);
  let writes = 0;
  let html = overlay.innerHTML;
  Object.defineProperty(overlay, "innerHTML", {
    get: () => html,
    set: (value) => {
      writes++;
      html = value;
    }
  });
  render.call(ctx);
  assert.equal(writes, 0, "visibility sync must not restart row and line animations");
  ctx.parentalGuideVisible = false;
  render.call(ctx);
  assert.equal(overlay.innerHTML, "");
});

test("subtitle language filtering preserves source indices and keeps appearance accessible", () => {
  const mixin = readFileSync(
    new URL("./browserPlayerPresentationScreen.js", import.meta.url),
    "utf8"
  );
  const render = method(
    "renderProposalSubtitle()",
    {
      t: (_key, fallback) => fallback,
      playerPanelHead,
      playerText,
      playerDesignIcon,
      playerChoice
    },
    mixin
  ).renderProposalSubtitle;
  const body = { scrollTop: 0 };
  const dialog = { classList: { add() {}, toggle() {} }, innerHTML: "", querySelector: () => body };
  const ctx = {
    uiRefs: { subtitleDialog: dialog },
    subtitleDialogVisible: true,
    proposalSubtitleLanguageFilter: "id",
    getSubtitleLanguageRailItems: () => [
      { key: "en", label: "English" },
      { key: "id", label: "Indonesian" }
    ],
    getSubtitleOptionsForLanguage: (key) => [
      { sourceType: "addon", title: key === "id" ? "Indonesian release" : "English release" }
    ],
    getSelectedSubtitleLanguageKey: () => "__off__"
  };
  render.call(ctx);
  assert.match(dialog.innerHTML, /Indonesian release/);
  assert.doesNotMatch(dialog.innerHTML, /English release/);
  assert.doesNotMatch(dialog.innerHTML, /<select\b/);
  assert.match(
    dialog.innerHTML,
    /data-action="proposalSubtitleLanguageToggle" aria-expanded="false"/
  );
  ctx.proposalSubtitleLanguagePickerOpen = true;
  render.call(ctx);
  assert.match(dialog.innerHTML, /data-proposal-subtitle-filter="id"[^>]*aria-pressed="true"/);
  assert.match(dialog.innerHTML, /class="nv-language-options"/);
  assert.match(dialog.innerHTML, /data-action="proposalSubtitleStyle"/);
  assert.match(dialog.innerHTML, /data-proposal-subtitle-index="0"/);
  ctx.proposalSubtitleStyleVisible = true;
  ctx.getSubtitleStyleControls = () =>
    [
      "fontSize",
      "bold",
      "textColor",
      "outlineEnabled",
      "outlineColor",
      "verticalOffset",
      "delay",
      "reset"
    ].map((id) => ({ id, label: id, value: "1" }));
  render.call(ctx);
  for (const id of ["textColor", "bold", "outlineColor", "verticalOffset", "reset"])
    assert.match(dialog.innerHTML, new RegExp('data-style-id="' + id + '"'));
});
test("episode card marks the playing episode without marking adjacent episodes", () => {
  const mixin = readFileSync(
    new URL("./browserPlayerPresentationScreen.js", import.meta.url),
    "utf8"
  );
  const render = method(
    "renderProposalEpisodeCard(episode, index, { thumbnail, date, current, duration })",
    { t: (_key, fallback) => fallback, playerText, playerDesignIcon },
    mixin
  ).renderProposalEpisodeCard;
  const episode = { episode: 2, title: "Episode two", overview: "Description" };
  assert.match(render.call({}, episode, 1, { current: true }), /aria-current="true"/);
  assert.match(render.call({}, episode, 1, { current: true }), /nv-episode-current-label/);
  assert.doesNotMatch(render.call({}, episode, 1, { current: false }), /nv-episode-current-label/);
});

test("subtitle language picker toggles and filters within the player", async () => {
  const activate = method("async onPointerActivate(target, event)").onPointerActivate;
  let renders = 0;
  const ctx = {
    subtitleDialogVisible: true,
    proposalSubtitleLanguageFilter: "all",
    renderSubtitleDialog: () => renders++,
    getSubtitleLanguageRailItems: () => [{ key: "id", label: "Indonesian" }]
  };
  const target = (action, key) => ({
    closest: () => ({ dataset: { action, proposalSubtitleFilter: key } })
  });
  assert.equal(await activate.call(ctx, target("proposalSubtitleLanguageToggle")), true);
  assert.equal(ctx.proposalSubtitleLanguagePickerOpen, true);
  await activate.call(ctx, target("proposalSubtitleLanguageFilter", "id"));
  assert.equal(ctx.proposalSubtitleLanguageFilter, "id");
  assert.equal(ctx.proposalSubtitleLanguagePickerOpen, false);
  await activate.call(ctx, target("proposalSubtitleLanguageFilter", "invalid"));
  assert.equal(ctx.proposalSubtitleLanguageFilter, "id");
  await activate.call(ctx, target("proposalSubtitleLanguageFilter", "all"));
  assert.equal(ctx.proposalSubtitleLanguageFilter, "all");
  assert.equal(renders, 4);
});

test("stream drawers combine Back and title with source filter and refresh in the header", () => {
  const mixin = readFileSync(
    new URL("./browserPlayerPresentationScreen.js", import.meta.url),
    "utf8"
  );
  const render = method(
    "renderProposalDrawerHeader(panel, { sources = false, streams = false } = {})",
    {
      t: (_key, fallback) => fallback,
      playerText,
      playerDesignIcon,
      renderFilterPicker
    },
    mixin
  ).renderProposalDrawerHeader;
  for (const sources of [false, true]) {
    const list = {};
    const appended = [];
    const panel = {
      classList: { add() {}, remove() {} },
      dataset: {},
      innerHTML: "",
      querySelector(selector) {
        if (selector === ".nv-panel-body") return { append: (node) => appended.push(node) };
        if (selector === "[data-player-episode-season]") return null;
        return list;
      }
    };
    render.call(
      {
        uiRefs: { root: { classList: { contains: () => true } } },
        getSourceFilters: () => ["all", "Addon A"],
        getEpisodePanelStreamFilters: () => ["all", "Addon A"],
        sourceFilter: "all",
        episodePanelStreamFilter: "all"
      },
      panel,
      { sources, streams: true }
    );
    const [header, body] = panel.innerHTML.split("</header>");
    assert.match(header, /class="nv-stream-title"/);
    assert.match(header, sources ? /data-top-action="close"/ : /data-episode-stream-action="back"/);
    assert.match(header, /<strong>Stream<\/strong>/);
    assert.match(header, /togglePanelAddonPicker/);
    assert.match(header, /nv-addon-picker-anchor/);
    assert.doesNotMatch(header, /library-picker/);
    assert.match(
      header,
      sources ? /data-top-action="reload"/ : /data-episode-stream-action="reload"/
    );
    assert.doesNotMatch(body, /nv-source-toolbar/);
    assert.doesNotMatch(panel.innerHTML, /Back to episodes/);
    assert.deepEqual(appended, [list]);
  }
});

test("episode seasons use an in-player menu and retain the real season values", async () => {
  const mixin = readFileSync(
    new URL("./browserPlayerPresentationScreen.js", import.meta.url),
    "utf8"
  );
  const render = method(
    "renderProposalDrawerHeader(panel, { sources = false, streams = false } = {})",
    {
      t: (_key, fallback) => fallback,
      playerText,
      playerDesignIcon,
      renderFilterPicker
    },
    mixin
  ).renderProposalDrawerHeader;
  const panel = {
    classList: { add() {}, remove() {} },
    dataset: {},
    innerHTML: "",
    querySelector: () => null
  };
  render.call(
    {
      uiRefs: { root: { classList: { contains: () => true } } },
      episodePanelSeason: 3,
      episodeSeasonPickerOpen: true,
      getEpisodePanelSeasons: () => [0, 1, 3, 12],
      getEpisodePanelSeasonLabel: (season) => (season ? "Season " + season : "Specials")
    },
    panel
  );
  assert.doesNotMatch(panel.innerHTML, /<select\b/);
  assert.match(panel.innerHTML, /toggleEpisodeSeasonPicker/);
  assert.match(panel.innerHTML, /data-option-index="2"[^>]*role="option"[^>]*aria-selected="true"/);
  const activate = method("async onPointerActivate(target, event)").onPointerActivate;
  let selected;
  const ctx = {
    episodePanelVisible: true,
    getEpisodePanelSeasons: () => [0, 1, 3, 12],
    selectEpisodePanelSeason: (s) => (selected = s),
    renderEpisodePanel() {}
  };
  const target = (action, optionIndex) => ({
    closest: () => ({ dataset: { action, optionIndex } })
  });
  await activate.call(ctx, target("toggleEpisodeSeasonPicker"));
  assert.equal(ctx.episodeSeasonPickerOpen, true);
  await activate.call(ctx, target("selectEpisodeSeasonOption", "2"));
  assert.equal(selected, 3);
  assert.equal(ctx.episodeSeasonPickerOpen, false);
});

test("playback information uses runtime and probed metadata and omits unavailable facts", () => {
  const mixin = readFileSync(
    new URL("./browserPlayerPresentationScreen.js", import.meta.url),
    "utf8"
  );
  const controller = {
    playbackEngine: "client-remux",
    clientRemux: {
      snapshot: () => ({
        processing: "remux",
        outputContainer: "fmp4",
        video: "hevc",
        sourceContainer: "Matroska",
        sourceSizeBytes: 1610612736
      })
    }
  };
  const rows = method(
    "getProposalPlaybackInfoRows()",
    {
      t: (_key, fallback) => fallback,
      PlayerController: controller
    },
    mixin
  ).getProposalPlaybackInfoRows;
  const ctx = {
    getDesktopPlaybackVideo: () => ({ videoWidth: 1920, videoHeight: 960 }),
    getCurrentStreamCandidate: () => ({ addonName: "Addon", name: "Title WEB-DL H264" }),
    getPlayerStreamProbe: () => null,
    getAudioEntries: () => [{ selected: true, label: "English (EAC3 5.1)", secondary: "48 kHz" }]
  };
  assert.deepEqual(Object.fromEntries(rows.call(ctx)), {
    Source: "Addon",
    "Source file": "Matroska · 1.50 GiB",
    "Playback container": "Fragmented MP4 (fMP4)",
    Video: "1920 × 960 · HEVC",
    Audio: "English (EAC3 5.1) · 48 kHz",
    Playback: "Remux · Client"
  });
  controller.clientRemux = null;
  controller.playbackEngine = "native-file";
  assert.equal(Object.fromEntries(rows.call(ctx)).Video, "1920 × 960");
  assert.equal(Object.fromEntries(rows.call(ctx))["Source file"], undefined);
  ctx.directTrackProbe = {
    container: "mp4",
    videoCodec: "h264",
    frameRate: 23.976,
    videoBitrate: 4700000
  };
  assert.equal(
    Object.fromEntries(rows.call(ctx)).Video,
    "1920 × 960 · H264 · 23.98 fps · 4.70 Mbps"
  );
  ctx.offlineDownloadId = "saved";
  assert.equal(Object.fromEntries(rows.call(ctx)).Video, "1920 × 960");
});
test("playback information shows converted output independently of source metadata", () => {
  const mixin = readFileSync(
    new URL("./browserPlayerPresentationScreen.js", import.meta.url),
    "utf8"
  );
  let output;
  const controller = { playbackEngine: "client-remux", clientRemux: { snapshot: () => output } };
  const rows = method(
    "getProposalPlaybackInfoRows()",
    {
      t: (_key, fallback) => fallback,
      PlayerController: controller
    },
    mixin
  ).getProposalPlaybackInfoRows;
  const ctx = {
    getDesktopPlaybackVideo: () => ({ videoWidth: 1280, videoHeight: 720 }),
    getCurrentStreamCandidate: () => ({ addonName: "Addon" }),
    getAudioEntries: () => [{ selected: true, label: "English (EAC3 5.1)" }],
    getPlayerStreamProbe: () => ({
      container: "mkv",
      videoCodec: "hevc",
      audioCodec: "eac3",
      frameRate: 24,
      videoBitrate: 6000000
    })
  };
  output = { processing: "transcode" };
  const pending = Object.fromEntries(rows.call(ctx));
  assert.equal(pending.Video, "1280 × 720");
  assert.equal(pending.Audio, "");
  assert.equal(pending["Playback container"], undefined);
  output = {
    ...output,
    outputContainer: "fmp4",
    video: "vp9",
    audio: "opus",
    channels: 2,
    sampleRate: 48000
  };
  assert.deepEqual(Object.fromEntries(rows.call(ctx)), {
    Source: "Addon",
    "Source file": "mkv",
    "Playback container": "Fragmented MP4 (fMP4)",
    Video: "1280 × 720 · VP9",
    Audio: "OPUS · 2 ch · 48 kHz",
    Playback: "Full Transcode · Client"
  });
  output = { ...output, processing: "audio-transcode", video: "hevc", audio: "aac" };
  const audioOnly = Object.fromEntries(rows.call(ctx));
  assert.equal(audioOnly.Video, "1280 × 720 · HEVC · 24 fps · 6.00 Mbps");
  assert.equal(audioOnly.Audio, "AAC · 2 ch · 48 kHz");
  assert.equal(audioOnly.Playback, "Audio Transcode · Client");

  controller.clientRemux = null;
  controller.playbackEngine = "hls.js";
  ctx.activePlaybackUrl = "/api/transcode/hls/index.m3u8";
  ctx.params = {
    unverifiedPlayback: {
      mediaUrl: ctx.activePlaybackUrl,
      output: {
        processing: "transcode",
        outputContainer: "hls-fmp4",
        video: "h264",
        audio: "aac",
        channels: 2
      }
    }
  };
  const server = Object.fromEntries(rows.call(ctx));
  assert.equal(server.Video, "1280 × 720 · H264");
  assert.equal(server.Audio, "AAC · 2 ch");
  assert.equal(server["Playback container"], "HLS · fMP4");
  assert.equal(server.Playback, "Full Transcode · Server");
  ctx.activePlaybackUrl = "https://media.test/replaced";
  assert.equal(Object.fromEntries(rows.call(ctx)).Playback, "hls.js");
});

test("AirPlay accepts Safari original network sources alongside remux, excluding local-only sources", () => {
  const mixin = readFileSync(
    new URL("./browserPlayerPresentationScreen.js", import.meta.url),
    "utf8"
  );
  const controller = { playbackEngine: "native-file" };
  const supported = method(
    "isPlayerAirPlaySupported()",
    { PlayerController: controller },
    mixin
  ).isPlayerAirPlaySupported;
  const video = {
    currentSrc: "https://example.com/video.mp4",
    webkitShowPlaybackTargetPicker() {}
  };
  const ctx = { getDesktopPlaybackVideo: () => video };
  assert.equal(supported.call(ctx), true);
  controller.playbackEngine = "client-remux";
  video.currentSrc = "blob:local-output";
  assert.equal(supported.call(ctx), false);
  video.querySelector = () => ({ src: "https://example.com/original.mkv?token=example" });
  assert.equal(supported.call(ctx), true);
  delete video.querySelector;
  controller.playbackEngine = "native-file";
  video.currentSrc = "https://example.com/video.mp4";
  ctx.offlineDownloadId = "download";
  assert.equal(supported.call(ctx), false);
  ctx.offlineDownloadId = null;
  delete video.webkitShowPlaybackTargetPicker;
  assert.equal(supported.call(ctx), false);
});

test("AirPlay opens the native picker synchronously and handles picker failures without interrupting playback", () => {
  const mixin = readFileSync(
    new URL("./browserPlayerPresentationScreen.js", import.meta.url),
    "utf8"
  );
  const open = method(
    "openPlayerAirPlayPicker()",
    { t: (_key, fallback) => fallback },
    mixin
  ).openPlayerAirPlayPicker;
  const calls = [];
  const video = {
    disableRemotePlayback: true,
    setAttribute: (...args) => calls.push(args),
    webkitShowPlaybackTargetPicker() {
      assert.equal(this, video);
      calls.push("picker");
    }
  };
  const ctx = {
    isPlayerAirPlaySupported: () => true,
    getDesktopPlaybackVideo: () => video,
    moreActionsVisible: true,
    renderCompactBrowserMorePanel: () => calls.push("render"),
    updateModalBackdrop() {},
    showAspectToast: () => calls.push("error")
  };
  assert.equal(open.call(ctx), true);
  assert.equal(video.disableRemotePlayback, false);
  assert.deepEqual(calls, [["x-webkit-airplay", "allow"], "picker", "render"]);
  assert.equal(ctx.moreActionsVisible, false);
  ctx.moreActionsVisible = true;
  video.webkitShowPlaybackTargetPicker = () => {
    throw new Error("unavailable");
  };
  assert.equal(open.call(ctx), false);
  assert.equal(ctx.moreActionsVisible, true);
  assert.equal(calls.at(-1), "error");
});
