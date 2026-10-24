import { classifyPlayback } from "../player/playbackMethod.js";
import { streamProbeIdentity } from "../player/streamProbe.js";
import { applyHdrPreference, resolveHdrPreference } from "./streamHdrPreference.js";

export function allowsPlayerStreamLabel(stream, settings = {}) {
  const addons = Array.isArray(settings.labelAddons) ? settings.labelAddons : [];
  return !addons.length || addons.includes(String(stream?.addonName || stream?.addon || "").trim());
}

export function playerStreamProbeKey(stream = {}) {
  return streamProbeIdentity(stream) || String(stream.url || stream.externalUrl || stream.id || "");
}

export function filterPlayerStreams(
  streams,
  { settings = {}, labels = {}, probeForStream = () => null, capabilities = {} } = {}
) {
  if (settings.showOnlyDirectStreams !== true) return streams;
  return streams.filter((stream) => {
    if (!allowsPlayerStreamLabel(stream, labels)) return false;
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
  { settings = {}, labels = {}, limit = 20 } = {}
) {
  if (labels.showPlaybackLabels === false && settings.showOnlyDirectStreams !== true) return [];
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
  const cap = Number.isFinite(Number(limit)) && Number(limit) >= 0 ? Math.trunc(Number(limit)) : 20;
  return cap === 0 ? ranked : ranked.slice(0, cap);
}
