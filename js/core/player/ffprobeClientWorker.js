import { probeMatroskaPatches } from "./probeMatroskaView.js";
import { normalizeProbe } from "./probeMetadata.js";
import { installProbeSparseFile } from "./probeSparseFile.js";

/* global importScripts, createFFmpegCore */
let corePromise, job;
const inputPath = "/probe-input",
  outputPath = "/probe-output.json";
function removeFile(core, path) {
  try {
    core.FS.unlink(path);
  } catch {
    /* Already absent. */
  }
}
async function runProbe() {
  try {
    if (!corePromise) {
      self.postMessage({ id: job.id, type: "stage", stage: "worker-script" });
      importScripts("./ffmpeg-core.js?v=0.12.10");
      self.postMessage({ id: job.id, type: "stage", stage: "wasm-loading" });
      corePromise = createFFmpegCore({
        locateFile: () => new URL("./ffmpeg-core.wasm?v=0.12.10", self.location.href).href
      });
    }
    const core = await corePromise;
    self.postMessage({ id: job.id, type: "stage", stage: "metadata" });
    core.setLogger(() => {});
    removeFile(core, inputPath);
    removeFile(core, outputPath);
    let missing = null;
    installProbeSparseFile(
      core.FS,
      {
        size: job.size,
        chunks: job.chunks,
        patches: probeMatroskaPatches(job.size, job.chunks),
        onMissing: (position) => {
          missing ??= position;
        }
      },
      inputPath
    );
    core.reset();
    core.ffprobe(
      "-v",
      "error",
      "-show_error",
      "-analyzeduration",
      "1000000",
      "-probesize",
      "1048576",
      "-show_data",
      "-show_entries",
      "stream=extradata,codec_type,codec_name,codec_tag_string,profile,level,pix_fmt,bits_per_raw_sample,width,height,avg_frame_rate,r_frame_rate,bit_rate,color_transfer,color_primaries,channels,sample_rate:stream_tags=language:stream_disposition=default,attached_pic",
      "-show_entries",
      "format=format_name,duration",
      "-of",
      "json",
      "-o",
      outputPath,
      inputPath
    );
    if (missing != null) {
      self.postMessage({ id: job.id, type: "range", position: missing });
      return;
    }
    const raw = JSON.parse(core.FS.readFile(outputPath, { encoding: "utf8" }));
    if (
      raw.error ||
      !Array.isArray(raw.streams) ||
      !raw.format?.format_name ||
      !raw.streams.some((stream) => ["video", "audio"].includes(stream.codec_type))
    )
      throw new Error("probe-metadata-unavailable");
    self.postMessage({ id: job.id, type: "result", result: normalizeProbe(raw) });
  } catch (error) {
    const failure = ["CompileError", "LinkError", "RuntimeError", "TypeError", "Error"].includes(
      error?.name
    )
      ? error.name
      : "Error";
    self.postMessage({ id: job.id, type: "error", failure });
  } finally {
    if (corePromise) {
      const core = await corePromise.catch(() => null);
      if (core) {
        removeFile(core, inputPath);
        removeFile(core, outputPath);
      }
    }
  }
}
self.onmessage = (event) => {
  const message = event.data;
  if (message.type === "release") {
    if (job?.id === message.id) job = null;
    return;
  }
  if (message.type === "start")
    job = { id: message.id, size: message.size, chunks: [message.chunk] };
  else if (message.type === "chunk" && job?.id === message.id) job.chunks.push(message.chunk);
  else return;
  void runProbe();
};
