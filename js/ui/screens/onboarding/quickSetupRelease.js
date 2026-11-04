// Deployment capabilities, not promises that any particular stream will play.
export function quickSetupReleaseFeatures({
  mode = "off",
  remuxEndpoint = "",
  transcodeEndpoint = ""
} = {}) {
  const client = mode === "client";
  const server = mode === "server" && Boolean(String(remuxEndpoint).trim());
  return {
    remuxProvider: client ? "Mediabunny" : server ? "Jellyfin FFmpeg" : null,
    client,
    audioTranscoding: mode === "server" && Boolean(String(transcodeEndpoint).trim())
  };
}
