import { createTranscodeBridgeServer } from "./bridge.mjs";
import { inspectFFmpegRuntime } from "../shared/ffmpegRuntime.mjs";

// The bridge as its own process, so nginx can route to it and the image can carry
// the one dependency that matters: ffmpeg. All policy comes from the environment,
// because only the deployment knows who is allowed to spend its CPU.
const port = Math.max(1, Number(process.env.PORT || 8080) || 8080);
const ffmpegRuntime = await inspectFFmpegRuntime();
console.log(
  `[ffmpeg] source=${ffmpegRuntime.source} available=${ffmpegRuntime.available} remux=${ffmpegRuntime.remux} audio=${ffmpegRuntime.audioTranscoding}`
);
const server = createTranscodeBridgeServer({
  ffmpegPath: ffmpegRuntime.path,
  ffmpegRuntime,
  maxConcurrent: Math.max(1, Number(process.env.TRANSCODE_MAX_CONCURRENT) || 1),
  perIpConcurrent: Math.max(1, Number(process.env.TRANSCODE_PER_IP_CONCURRENT) || 1)
});

server.listen(port, "0.0.0.0", () => {
  const access = String(process.env.TRANSCODE_ACCESS || "token")
    .trim()
    .toLowerCase();
  console.log(`Transcode bridge listening on ${port} (access: ${access})`);
});
