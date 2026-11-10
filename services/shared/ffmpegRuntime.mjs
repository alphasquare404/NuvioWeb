import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const require = createRequire(import.meta.url);

function bundledBinary() {
  try {
    const file = require("ffmpeg-static");
    return file && existsSync(file) ? file : "";
  } catch {
    return "";
  }
}

export function ffmpegCandidates({
  override = process.env.FFMPEG_PATH || "",
  bundled = bundledBinary()
} = {}) {
  if (String(override).trim()) return [{ path: String(override).trim(), source: "override" }];
  return [
    ...(bundled ? [{ path: bundled, source: "bundled" }] : []),
    { path: "ffmpeg", source: "system" }
  ];
}

export function resolveFFmpegPath() {
  return ffmpegCandidates()[0].path;
}

// A bounded, local startup check. No stream is downloaded or decoded. An explicit
// FFMPEG_PATH is authoritative; never silently replace a hoster's broken override.
export async function inspectFFmpegRuntime({
  candidates = ffmpegCandidates(),
  run = runFile,
  timeoutMs = 4000
} = {}) {
  for (const candidate of candidates) {
    const options = {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
      encoding: "utf8"
    };
    try {
      const version = await run(candidate.path, ["-hide_banner", "-version"], options);
      if (!/^ffmpeg version\s/im.test(version.stdout || "")) continue;
      const [muxers, encoders, protocols] = await Promise.all([
        run(candidate.path, ["-hide_banner", "-muxers"], options),
        run(candidate.path, ["-hide_banner", "-encoders"], options),
        run(candidate.path, ["-hide_banner", "-protocols"], options)
      ]);
      const network =
        /^\s*https\s*$/m.test(protocols.stdout) && /^\s*http\s*$/m.test(protocols.stdout);
      const mp4 = /^\s*E\s+mp4\s/m.test(muxers.stdout);
      const hls = /^\s*E\s+hls\s/m.test(muxers.stdout);
      const h264 = /^\s*V[A-Z.]{5}\s+libx264\s/m.test(encoders.stdout);
      const aac = /^\s*A[A-Z.]{5}\s+aac\s/m.test(encoders.stdout);
      return {
        path: candidate.path,
        source: candidate.source,
        verified: true,
        available: true,
        remux: network && mp4,
        audioTranscoding: network && mp4 && aac,
        videoTranscoding: network && mp4 && aac && h264,
        hls: network && mp4 && hls,
        reason: network && mp4 ? null : "required-formats-unavailable"
      };
    } catch {
      // Missing, unsupported, blocked, or timed-out bundled binaries can use a
      // system installation. An override has no further candidates by design.
    }
  }
  return {
    path: candidates[0]?.path || "ffmpeg",
    source: candidates[0]?.source || "system",
    verified: true,
    available: false,
    remux: false,
    audioTranscoding: false,
    videoTranscoding: false,
    hls: false,
    reason: "ffmpeg-unavailable"
  };
}

// Public health responses must never expose executable paths or process output.
export function publicFFmpegCapabilities(runtime) {
  return {
    verified: runtime?.verified === true,
    available: runtime?.available === true,
    remux: runtime?.remux === true,
    audioTranscoding: runtime?.audioTranscoding === true,
    videoTranscoding: runtime?.videoTranscoding === true,
    hls: runtime?.hls === true
  };
}
