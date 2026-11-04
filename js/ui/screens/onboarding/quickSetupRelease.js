import { resolveRelayAvailability } from "../../../core/player/relayAvailability.js";

// Deployment capabilities, not promises that any particular stream will play.
export function quickSetupReleaseFeatures({
  mode = "off",
  remuxEndpoint = "",
  transcodeEndpoint = "",
  availability = {}
} = {}) {
  const client = mode === "client";
  const server =
    mode === "server" && Boolean(String(remuxEndpoint).trim()) && availability.remux === true;
  return {
    remuxProvider: client ? "Mediabunny" : server ? "FFmpeg" : null,
    client,
    audioTranscoding:
      mode === "server" &&
      Boolean(String(transcodeEndpoint).trim()) &&
      availability.audioTranscoding === true
  };
}

export async function loadQuickSetupReleaseFeatures(options = {}, requestOptions = {}) {
  if (options.mode !== "server") return quickSetupReleaseFeatures(options);
  const [remux, audioTranscoding] = await Promise.all([
    resolveRelayAvailability({
      ...requestOptions,
      endpoint: options.remuxEndpoint,
      capability: "remux"
    }),
    resolveRelayAvailability({
      ...requestOptions,
      endpoint: options.transcodeEndpoint,
      capability: "audioTranscoding"
    })
  ]);
  return quickSetupReleaseFeatures({
    ...options,
    availability: { remux: remux === true, audioTranscoding: audioTranscoding === true }
  });
}
