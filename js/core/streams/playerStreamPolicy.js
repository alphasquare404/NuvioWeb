import { filterFilenameStreams, filenameStreamDisplayMode } from "./filenameStreamPolicy.js";
import { streamProbeIdentity } from "../player/streamProbe.js";

import { resolveHdrPreference } from "./streamHdrPreference.js";
import { usesMetadataLabels } from "./streamLabelPolicy.js";

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
    probeForStream = () => null
  } = {}
) {
  const mode = String(settings.streamAutoPlayMode || "MANUAL").toUpperCase();
  const prefer = Boolean(settings.streamAutoPlayPreferBingeGroupForNextEpisode);
  const manualAutoNext = mode === "MANUAL" && Boolean(settings.autoplayNextEpisode);
  return {
    filenameStreamDisplayMode: filenameStreamDisplayMode(settings),
    filenameStreamFilter: settings.filenameStreamFilter,
    filenameTranscodeFilter: settings.filenameTranscodeFilter,
    hdrPreference: resolveHdrPreference(settings),
    probeOnly: false,
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

export function filterPlayerStreams(streams, { settings = {}, capabilities = null } = {}) {
  return filterFilenameStreams(Array.isArray(streams) ? streams : [], settings, capabilities);
}

export function playerStreamCheckCandidates() {
  return [];
}

export function playerStreamProbeCandidates(streams, options = {}) {
  if (!usesMetadataLabels(options.labels || {})) return [];
  return playerStreamCheckCandidates(streams, options);
}
