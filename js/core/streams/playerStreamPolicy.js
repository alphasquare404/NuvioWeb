import { classifyPlayback } from "../player/playbackMethod.js";
import { streamProbeIdentity } from "../player/streamProbe.js";
import { getDeviceCapabilities } from "../player/deviceCapabilities.js";
import { applyHdrPreference, resolveHdrPreference } from "./streamHdrPreference.js";
import {
  streamLabelProbeLimit,
  isOnlyDirectEnabled,
  isStreamLabelingEnabled,
  isStreamCheckEnabled,
  usesMetadataLabels,
  allowsPlaybackMethod
} from "./streamLabelPolicy.js";
import {
  filterStreamsByCompatibility,
  classifyStreamFilename
} from "./streamCompatibilityFilter.js";

export function allowsPlayerStreamLabel(stream, settings = {}) {
  if (!usesMetadataLabels(settings) && settings.filenameAllAddons === true) return true;
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
  const manualAutoNext = mode === "MANUAL" && Boolean(settings.autoplayNextEpisode);
  return {
    streamCompatibilityFilter: settings.streamCompatibilityFilter,
    hdrPreference: resolveHdrPreference(settings),
    probeOnly: isOnlyDirectEnabled(settings, labels) && usesMetadataLabels(labels),
    probeForStream,
    mode: manualAutoNext ? "FIRST_STREAM" : mode,
    source: String(settings.streamAutoPlaySource || "ALL_SOURCES"),
    regexPattern: manualAutoNext ? "" : String(settings.streamAutoPlayRegex || ""),
    installedAddonNames,
    selectedAddons: settings.streamAutoPlaySelectedAddons,
    selectedPlugins: settings.streamAutoPlaySelectedPlugins,
    preferredBingeGroup: prefer ? preferredBingeGroup : "",
    preferBingeGroupInSelection: prefer,
    bingeGroupOnly: Boolean(bingeGroupOnly)
  };
}

export function filterPlayerStreams(
  streams,
  { settings = {}, labels = {}, probeForStream = () => null, capabilities = null } = {}
) {
  streams = filterStreamsByCompatibility(streams, settings, capabilities);
  if (!isOnlyDirectEnabled(settings, labels)) return streams;
  if (!usesMetadataLabels(labels))
    return streams.filter((stream) =>
      allowsPlaybackMethod(classifyStreamFilename(stream, capabilities).method, settings)
    );
  capabilities ||= getDeviceCapabilities();
  // A background quota limits new work, never invalidates facts already obtained
  // by selection, another screen or a previous metadata check.
  return streams.filter((stream) => {
    const probe = probeForStream(stream);
    return (
      Boolean(probe) &&
      allowsPlaybackMethod(
        classifyPlayback({ url: stream.url || stream.externalUrl || "", probe, capabilities })
          .method,
        settings
      )
    );
  });
}

export function playerStreamCheckCandidates(
  streams,
  {
    settings = {},
    labels = {},
    limit = 20,
    mode = "server",
    capabilities = null,
    purpose = "background"
  } = {}
) {
  if (purpose === "selection" ? !isStreamCheckEnabled(labels) : !isStreamLabelingEnabled(labels))
    return [];
  streams = filterStreamsByCompatibility(streams, settings, capabilities);
  const seen = new Set();
  const scoped = streams.filter((stream) => {
    const key = playerStreamProbeKey(stream);
    if (
      !key ||
      seen.has(key) ||
      (purpose !== "selection" && !allowsPlayerStreamLabel(stream, labels))
    )
      return false;
    seen.add(key);
    return true;
  });
  const ranked =
    resolveHdrPreference(settings) === "PREFER"
      ? applyHdrPreference(scoped, { hdrPreference: "PREFER" })
      : scoped;
  const configured = Number(limit);
  const hostCap = Number.isFinite(configured) && configured >= 0 ? Math.trunc(configured) : 20;
  const cap =
    purpose === "selection"
      ? mode === "client"
        ? Math.min(hostCap || 20, 20)
        : hostCap
      : streamLabelProbeLimit(labels, mode, limit);
  return cap === 0 ? ranked : ranked.slice(0, cap);
}

export function playerStreamProbeCandidates(streams, options = {}) {
  if (!usesMetadataLabels(options.labels || {})) return [];
  return playerStreamCheckCandidates(streams, options);
}
