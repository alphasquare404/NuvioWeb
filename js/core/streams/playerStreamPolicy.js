import { classifyPlayback } from "../player/playbackMethod.js";
import { streamProbeIdentity } from "../player/streamProbe.js";
import { getDeviceCapabilities } from "../player/deviceCapabilities.js";
import { applyHdrPreference, resolveHdrPreference } from "./streamHdrPreference.js";
import {
  streamLabelProbeLimit,
  isOnlyDirectEnabled,
  isStreamLabelingEnabled,
  usesMetadataLabels
} from "./streamLabelPolicy.js";
import {
  filterStreamsByCompatibility,
  classifyStreamFilename
} from "./streamCompatibilityFilter.js";

export function allowsPlayerStreamLabel(stream, settings = {}) {
  const addons = Array.isArray(settings.labelAddons) ? settings.labelAddons : [];
  return addons.includes(String(stream?.addonName || stream?.addon || "").trim());
}

export function playerStreamProbeKey(stream = {}) {
  const identity = streamProbeIdentity(stream);
  return /^torrent-file:[a-f0-9]{40}:\d+$/.test(identity)
    ? identity
    : String(stream.url || stream.externalUrl || stream.id || "");
}

export function nextEpisodeSelectionOptions(
  settings = {},
  {
    installedAddonNames = new Set(),
    preferredBingeGroup = "",
    bingeGroupOnly = false,
    labels = {},
    probeForStream = () => null
  } = {}
) {
  const mode = String(settings.streamAutoPlayMode || "MANUAL").toUpperCase();
  const prefer = Boolean(settings.streamAutoPlayPreferBingeGroupForNextEpisode);
  const manualAutoNext = mode === "MANUAL" && (Boolean(settings.autoplayNextEpisode) || prefer);
  return {
    streamCompatibilityFilter: settings.streamCompatibilityFilter,
    hdrPreference: resolveHdrPreference(settings),
    probeOnly: isOnlyDirectEnabled(settings, labels) && usesMetadataLabels(labels),
    probeForStream,
    mode: manualAutoNext ? "FIRST_STREAM" : mode,
    source: manualAutoNext ? "ALL_SOURCES" : String(settings.streamAutoPlaySource || "ALL_SOURCES"),
    regexPattern: manualAutoNext ? "" : String(settings.streamAutoPlayRegex || ""),
    installedAddonNames,
    selectedAddons: manualAutoNext ? [] : settings.streamAutoPlaySelectedAddons,
    selectedPlugins: manualAutoNext ? [] : settings.streamAutoPlaySelectedPlugins,
    preferredBingeGroup: prefer ? preferredBingeGroup : "",
    preferBingeGroupInSelection: prefer,
    bingeGroupOnly: Boolean(bingeGroupOnly)
  };
}

export function filterPlayerStreams(
  streams,
  {
    settings = {},
    labels = {},
    probeForStream = () => null,
    capabilities = null,
    mode = "server",
    limit = 20
  } = {}
) {
  streams = filterStreamsByCompatibility(streams, settings, capabilities);
  if (!isOnlyDirectEnabled(settings, labels)) return streams;
  if (!usesMetadataLabels(labels))
    return streams.filter(
      (stream) =>
        allowsPlayerStreamLabel(stream, labels) &&
        classifyStreamFilename(stream, capabilities).method === "direct"
    );
  capabilities ||= getDeviceCapabilities();
  const candidates =
    mode === "client"
      ? new Set(
          playerStreamProbeCandidates(streams, { settings, labels, mode, limit, capabilities }).map(
            playerStreamProbeKey
          )
        )
      : null;
  return streams.filter((stream) => {
    if (!allowsPlayerStreamLabel(stream, labels)) return false;
    if (candidates && !candidates.has(playerStreamProbeKey(stream))) return false;
    const probe = probeForStream(stream);
    return (
      Boolean(probe) &&
      classifyPlayback({ url: stream.url || stream.externalUrl || "", probe, capabilities })
        .method === "direct"
    );
  });
}

export function playerStreamProbeCandidates(
  streams,
  { settings = {}, labels = {}, limit = 20, mode = "server", capabilities = null } = {}
) {
  if (!isStreamLabelingEnabled(labels) || !usesMetadataLabels(labels)) return [];
  streams = filterStreamsByCompatibility(streams, settings, capabilities);
  const seen = new Set();
  const scoped = streams.filter((stream) => {
    const key = playerStreamProbeKey(stream);
    if (!key || seen.has(key) || !allowsPlayerStreamLabel(stream, labels)) return false;
    seen.add(key);
    return true;
  });
  const ranked =
    resolveHdrPreference(settings) === "PREFER"
      ? applyHdrPreference(scoped, { hdrPreference: "PREFER" })
      : scoped;
  const cap = streamLabelProbeLimit(labels, mode, limit);
  return cap === 0 ? ranked : ranked.slice(0, cap);
}
