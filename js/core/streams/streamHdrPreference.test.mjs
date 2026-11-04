import assert from "node:assert/strict";
import test from "node:test";
import { detectHdrPlaybackSupport } from "../player/hdrSupport.js";
import { normalizePlayerSettings } from "../../data/local/playerSettingsStore.js";
import {
  hdrFromText,
  hdrFromProbe,
  resolveHdrPreference,
  applyHdrPreference
} from "./streamHdrPreference.js";
import { selectAutoPlayStream } from "./streamAutoPlaySelector.js";
import { resolveAutoPlayStream } from "./streamAutoResolve.js";

const row = (id, title = "", addonName = "Chosen") => ({
  id,
  title,
  addonName,
  url: "https://cdn.test/" + id
});
const settings = {
  streamAutoPlayMode: "FIRST_STREAM",
  streamAutoPlayHdrPreference: "PREFER",
  streamAutoPlayTimeoutSeconds: 3
};

test("HDR defaults depend on video output capability; missing APIs and CSS-only HDR stay unknown", () => {
  const scope = (queries) => ({ matchMedia: (query) => ({ matches: queries.includes(query) }) });
  for (const [queries, support] of [
    [["(video-dynamic-range: high)"], true],
    [["(video-dynamic-range: standard)"], false],
    [["(dynamic-range: standard)"], false],
    [["(dynamic-range: high)"], null],
    [[], null]
  ])
    assert.equal(detectHdrPlaybackSupport(scope(queries)), support);
  assert.equal(detectHdrPlaybackSupport({}), null);
  assert.equal(
    detectHdrPlaybackSupport({
      matchMedia() {
        throw Error("missing");
      }
    }),
    null
  );
  const auto = { streamAutoPlayMode: "FIRST_STREAM" };
  assert.equal(resolveHdrPreference(auto, true), "PREFER");
  assert.equal(resolveHdrPreference(auto, false), "AVOID");
  assert.equal(resolveHdrPreference(auto, null), "ANY");
  assert.equal(resolveHdrPreference({ ...auto, streamAutoPlayHdrPreference: "ANY" }, true), "ANY");
  assert.equal(
    resolveHdrPreference(
      { streamAutoPlayMode: "MANUAL", streamAutoPlayHdrPreference: "PREFER" },
      true
    ),
    "ANY"
  );
  for (const value of ["PREFER", "AVOID", "ANY", "AUTO"]) {
    assert.equal(
      normalizePlayerSettings({ streamAutoPlayHdrPreference: value }).streamAutoPlayHdrPreference,
      value
    );
  }
  assert.equal(
    normalizePlayerSettings({ streamAutoPlayHdrPreference: "broken" }).streamAutoPlayHdrPreference,
    "AUTO"
  );
});

test("HDR text recognition uses addon metadata without resolving or reading URL tokens", () => {
  for (const title of [
    "Movie.HDR.1080p",
    "HDR10+",
    "HLG",
    "Dolby Vision",
    "DOLBY.VISION",
    "DoVi",
    "DV"
  ])
    assert.equal(hdrFromText({ title }), true, title);
  for (const title of ["HDRip", "HEVC 10bit 4K", "2160p", "HDReady"])
    assert.equal(hdrFromText({ title }), null, title);
  assert.equal(hdrFromText({ behaviorHints: { filename: "Movie.HDR10.mkv" } }), true);
  assert.equal(hdrFromText({ url: "https://cdn.test/HDR?token=HDR" }), null);
  assert.equal(hdrFromText({ title: "SDR HEVC" }), false);
  assert.equal(hdrFromProbe({ colorTransfer: "smpte2084" }), true);
  assert.equal(hdrFromProbe({ colorTransfer: "arib-std-b67" }), true);
  assert.equal(hdrFromProbe({ colorTransfer: "bt709" }), false);
  assert.equal(hdrFromProbe({}), null);
});

test("First Source keeps addon permissions and original order within the HDR group", () => {
  const streams = [
    row("sdr"),
    row("forbidden-hdr", "HDR", "Other"),
    row("hdr-a", "HDR"),
    row("hdr-b", "HDR")
  ];
  const options = {
    mode: "FIRST_STREAM",
    hdrPreference: "PREFER",
    installedAddonNames: new Set(["Chosen", "Other"]),
    selectedAddons: ["Chosen"]
  };
  assert.equal(selectAutoPlayStream(streams, options).id, "hdr-a");
  assert.equal(selectAutoPlayStream(streams, { ...options, hdrPreference: "AVOID" }).id, "sdr");
  assert.equal(selectAutoPlayStream(streams, { ...options, hdrPreference: "ANY" }).id, "sdr");
  assert.equal(
    selectAutoPlayStream(streams.slice(2), { ...options, hdrPreference: "AVOID" }),
    null
  );
  assert.equal(
    selectAutoPlayStream(streams, { ...options, mode: "REGEX_MATCH", regexPattern: "sdr" }).id,
    "sdr"
  );
});

test("probe metadata corrects text, and Only Direct never treats text as HDR proof", () => {
  const streams = [row("hidden"), row("advertised", "HDR")];
  const evidence = {
    probeForStream: (s) => ({ colorTransfer: s.id === "hidden" ? "smpte2084" : "bt709" })
  };
  assert.equal(
    applyHdrPreference(streams, { hdrPreference: "PREFER", ...evidence })[0].id,
    "hidden"
  );
  assert.deepEqual(
    applyHdrPreference(streams, { hdrPreference: "AVOID", ...evidence }).map((s) => s.id),
    ["advertised"]
  );
  assert.equal(
    selectAutoPlayStream(streams, {
      mode: "FIRST_STREAM",
      hdrPreference: "PREFER",
      probeOnly: true
    }).id,
    "hidden"
  );
});

test("First Source inspects a complete addon response, including HDR beyond twenty, before URL preparation", async () => {
  const streams = Array.from({ length: 22 }, (_, i) => row(String(i)));
  streams[21].title = "HDR10";
  const result = await resolveAutoPlayStream({
    itemType: "movie",
    videoId: "tt1",
    settings,
    returnOnFirstMatch: true,
    repository: {
      async getStreamsFromAllAddons(type, id, options) {
        options.onChunk({ status: "success", data: [{ streams }] });
        return { status: "success", data: [{ streams }] };
      }
    }
  });
  assert.equal(result.selected.id, "21");
  assert.equal(result.streams.length, 22);
});

test("avoiding HDR opens manual selection when every eligible text candidate is HDR", async () => {
  const streams = [row("hdr", "HDR")];
  const result = await resolveAutoPlayStream({
    itemType: "movie",
    videoId: "tt1",
    settings: { ...settings, streamAutoPlayHdrPreference: "AVOID" },
    repository: {
      async getStreamsFromAllAddons() {
        return { status: "success", data: [{ streams }] };
      }
    }
  });
  assert.equal(result.selected, null);
  assert.equal(result.hdrExcluded, true);
  assert.equal(result.streams.length, 1);
});

test("a saved SDR binge group cannot override an active preference for available HDR", () => {
  const sdr = { ...row("sdr"), behaviorHints: { bingeGroup: "saved" } };
  const hdr = { ...row("hdr", "HDR"), behaviorHints: { bingeGroup: "new" } };
  const options = {
    mode: "FIRST_STREAM",
    hdrPreference: "PREFER",
    preferredBingeGroup: "saved",
    preferBingeGroupInSelection: true
  };
  assert.equal(selectAutoPlayStream([sdr, hdr], options).id, "hdr");
  assert.equal(selectAutoPlayStream([sdr, hdr], { ...options, hdrPreference: "ANY" }).id, "sdr");
});
