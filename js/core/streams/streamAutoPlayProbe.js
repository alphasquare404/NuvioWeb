import { autoPlayCandidates, selectAutoPlayStream } from "./streamAutoPlaySelector.js";
import {
  playerStreamProbeCandidates,
  playerStreamProbeKey,
  filterPlayerStreams
} from "./playerStreamPolicy.js";
import { usesMetadataLabels, streamDisplayMode } from "./streamLabelPolicy.js";
import { hdrFromProbe } from "./streamHdrPreference.js";
import { probeStreamCandidate } from "../player/probeStreamCandidate.js";
import { withinStreamSelectionDeadline } from "./streamAutoResolve.js";

// One bounded compatibility pass shared by initial selection and next episode.
export async function inspectAutoPlayStreams(
  streams,
  {
    settings,
    labels,
    capabilities,
    selection,
    prober,
    mode,
    limit = 20,
    deadlineAt = Infinity,
    cancelled = () => false,
    context = {},
    onCandidates = () => {},
    probeCandidate = probeStreamCandidate
  }
) {
  const probes = new Map(),
    updates = new Map();
  const filterSettings = {
    ...settings,
    streamDisplayMode:
      streamDisplayMode(settings) === "ALL" ? "DIRECT" : streamDisplayMode(settings)
  };
  const active = () => !cancelled() && Date.now() < deadlineAt;
  const keyFor = (stream) => playerStreamProbeKey(stream);
  const facts = (stream) =>
    probes.get(keyFor(stream)) || probes.get(stream.url || stream.externalUrl || "");
  const evidence = { ...selection, probeOnly: usesMetadataLabels(labels), probeForStream: facts };
  const completeStreams = () => streams.map((stream) => updates.get(keyFor(stream)) || stream);
  const confirmed = () =>
    autoPlayCandidates(
      filterPlayerStreams(completeStreams(), {
        settings: filterSettings,
        labels,
        capabilities,
        mode,
        probeForStream: facts
      }),
      evidence
    );
  if (!usesMetadataLabels(labels)) return { streams, candidates: confirmed(), probes };
  // Text may prioritize a possible HDR candidate; only actual metadata may exclude it.
  const ordered = autoPlayCandidates(streams, {
    ...selection,
    hdrPreference: selection.hdrPreference === "AVOID" ? "ANY" : selection.hdrPreference
  });
  const targets = playerStreamProbeCandidates(ordered, {
    settings,
    labels,
    capabilities,
    mode,
    limit,
    purpose: "selection"
  });
  if (!prober?.enabled) return { streams, candidates: [], probes };
  for (const original of targets) {
    if (!active()) break;
    const key = keyFor(original);
    const stream = { ...original };
    const probe = await withinStreamSelectionDeadline(
      () =>
        probeCandidate(prober, stream, {
          mode,
          context,
          active,
          resolveTimeoutMs: Math.min(15000, deadlineAt - Date.now()),
          timeoutMs: Math.min(15000, deadlineAt - Date.now()),
          onResolved: (url) => {
            stream.url = url;
            stream.externalUrl = null;
          }
        }).catch(() => null),
      deadlineAt,
      () => null
    );
    if (!active()) {
      prober.cancelAll?.();
      break;
    }
    if (!probe) continue;
    updates.set(key, stream);
    probes.set(key, probe);
    probes.set(keyFor(stream), probe);
    if (stream.url || stream.externalUrl) probes.set(stream.url || stream.externalUrl, probe);
    const candidates = confirmed();
    onCandidates(candidates, probes);
    const chosen = selectAutoPlayStream(candidates, evidence);
    // Source order is preserved. A cold worker never queues later files behind
    // the selected candidate; HDR Prefer may continue until an HDR fact arrives.
    if (chosen && (selection.hdrPreference !== "PREFER" || hdrFromProbe(facts(chosen)) === true))
      break;
  }
  const candidates = confirmed();
  return {
    streams: completeStreams(),
    candidates,
    probes,
    hdrExcluded:
      selection.hdrPreference === "AVOID" &&
      !candidates.length &&
      filterPlayerStreams(completeStreams(), {
        settings: filterSettings,
        labels,
        capabilities,
        probeForStream: facts
      }).some((stream) => hdrFromProbe(facts(stream)) === true)
  };
}
