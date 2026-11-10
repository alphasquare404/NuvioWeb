import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, rm, rename, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createEgressBudget } from "../shared/egressBudget.mjs";
import { resolveFFmpegPath, publicFFmpegCapabilities } from "../shared/ffmpegRuntime.mjs";
import path from "node:path";
import {
  parseAudioIndices,
  multiAudioHlsArgs,
  selectDefaultRendition,
  publishEarlyMaster
} from "./multiAudio.mjs";
import { createRelayTextReader } from "./textTracks.mjs";
import { parseByteRange } from "../remux-bridge/bridge.mjs";

// Audio-only transcode bridge.
//
// The cheapest fix for the most common "cannot play" case: the picture is fine and
// the audio track is not (E-AC3, DTS, TrueHD). Copying the video stream and
// re-encoding only the audio costs seconds of CPU instead of minutes, and keeps the
// picture untouched. Full video transcoding is a separate, much more expensive
// decision and is deliberately not part of this.
//
// Access is a deployment decision with three shapes, because the cost lands on the
// server that runs ffmpeg:
//   open   anyone who can reach it
//   token  a shared secret, so only app profiles configured with it can ask
//   lan    only addresses on the private network

const ACCESS = Object.freeze({ OPEN: "open", TOKEN: "token", LAN: "lan" });
// Two clocks: a finished output is kept for hours because a paused viewer needs it,
// while an unfinished one can never be played and is swept quickly.
const DEFAULT_FINISHED_TTL_MS = 3 * 60 * 60 * 1000;
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024 * 1024;
const DEFAULT_SWEEP_MS = 5 * 60 * 1000;
const STREAM_PATH = "/api/transcode";
const HEALTH_PATH = "/api/transcode/health";

function json(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  response.end(JSON.stringify(payload));
}

export function normalizeAccess(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === ACCESS.OPEN || normalized === ACCESS.LAN) return normalized;
  // Anything unrecognised fails closed onto the safest shape that still works out of
  // the box for a personal deployment.
  return ACCESS.TOKEN;
}

/** Private ranges only; anything else is the internet. */
export function isPrivateAddress(value) {
  const address = String(value || "")
    .trim()
    .toLowerCase();
  if (!address) return false;
  if (address === "::1" || address === "localhost") return true;
  if (address.startsWith("127.")) return true;
  if (address.startsWith("10.")) return true;
  if (address.startsWith("192.168.")) return true;
  if (address.startsWith("169.254.")) return true;
  if (address.startsWith("fc") || address.startsWith("fd")) return true; // unique local v6
  const match = /^172\.(\d+)\./.exec(address);
  if (match) {
    const second = Number(match[1]);
    return second >= 16 && second <= 31;
  }
  return false;
}

/** The address to judge: a proxy's client header wins over the socket, or a tunnel on
 * the same host would look local to every caller on the internet. */
export function clientAddress(headers = {}, socketAddress = "") {
  const forwarded = String(headers["cf-connecting-ip"] || "").trim();
  if (forwarded) return forwarded;
  const chain = String(headers["x-forwarded-for"] || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (chain.length) return chain[0];
  return String(socketAddress || "").trim();
}

export function resolveAccess({
  access = ACCESS.TOKEN,
  token = "",
  presented = "",
  address = ""
} = {}) {
  const mode = normalizeAccess(access);
  if (mode === ACCESS.OPEN) return { ok: true, mode };
  if (mode === ACCESS.LAN)
    return isPrivateAddress(address)
      ? { ok: true, mode }
      : { ok: false, mode, reason: "not-private-address" };
  // Token mode fails closed: an unset token protects nothing, so nothing is served.
  if (!token) return { ok: false, mode, reason: "token-not-configured" };
  if (String(presented || "") !== String(token))
    return { ok: false, mode, reason: "token-mismatch" };
  return { ok: true, mode };
}

export function parseTranscodeSource(raw, { planSignature = "" } = {}) {
  const value = String(raw || "").trim();
  if (!value) return { ok: false, reason: "missing-source" };
  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }
  if (!/^https?:$/.test(url.protocol)) return { ok: false, reason: "unsupported-scheme" };
  if (url.username || url.password) return { ok: false, reason: "credentials-not-allowed" };
  // The plan is part of the identity of the output. Two devices that need different
  // codecs for the same source are two different files, and serving one's answer to
  // the other would be a silent "cannot play" that no retry could fix.
  const material = planSignature ? `${url.toString()}#${planSignature}` : url.toString();
  return {
    ok: true,
    url: url.toString(),
    key: createHash("sha256").update(material).digest("hex").slice(0, 32)
  };
}

// What a caller may ask for. Closed sets on purpose: everything handed to ffmpeg is
// chosen from these tables, never taken from the request as free text.
export const TRANSCODE_PLAN_LIMITS = Object.freeze({
  minHeight: 240,
  maxHeight: 1080,
  maxChannels: 2
});

const PLAN_VIDEO = new Set(["copy", "h264"]);
const PLAN_AUDIO = new Set(["aac", "copy"]);

/**
 * Read the requested output plan from a query string.
 *
 * Defaults describe what the app has always asked for, so an old URL keeps working.
 * Out-of-range or unknown values are refused here rather than being passed to
 * ffmpeg, and the height/codec ceilings are enforced on the server because a
 * profile setting is not the same thing as permission to spend a machine's CPU.
 */
export function parseTranscodePlan(searchParams) {
  const read = (name) => {
    const raw =
      typeof searchParams?.get === "function" ? searchParams.get(name) : searchParams?.[name];
    return String(raw ?? "")
      .trim()
      .toLowerCase();
  };

  const video = read("v") || "copy";
  if (!PLAN_VIDEO.has(video)) return { ok: false, reason: "invalid-video" };
  const audio = read("a") || "aac";
  if (!PLAN_AUDIO.has(audio)) return { ok: false, reason: "invalid-audio" };

  let height = 0;
  const rawHeight = read("h");
  if (rawHeight) {
    height = Number(rawHeight);
    if (
      !Number.isInteger(height) ||
      height < TRANSCODE_PLAN_LIMITS.minHeight ||
      height > TRANSCODE_PLAN_LIMITS.maxHeight
    ) {
      return { ok: false, reason: "invalid-height" };
    }
  }

  let channels = 2;
  const rawChannels = read("ac");
  if (rawChannels) {
    channels = Number(rawChannels);
    if (
      !Number.isInteger(channels) ||
      channels < 1 ||
      channels > TRANSCODE_PLAN_LIMITS.maxChannels
    ) {
      return { ok: false, reason: "invalid-channels" };
    }
  }

  // Which audio track to use. A release often carries E-AC-3 5.1 first and AAC
  // stereo second: selecting the second is a copy, downmixing the first is an encode.
  let audioIndex = 0;
  const rawAudioIndex = read("ai");
  if (rawAudioIndex) {
    audioIndex = Number(rawAudioIndex);
    if (!Number.isInteger(audioIndex) || audioIndex < 0 || audioIndex > 7) {
      return { ok: false, reason: "invalid-audio-index" };
    }
  }

  let audioIndices;
  try {
    audioIndices = parseAudioIndices(read("audios"), audioIndex);
  } catch {
    return { ok: false, reason: "invalid-audio-renditions" };
  }
  if (audioIndices && (video !== "copy" || audio !== "copy"))
    return { ok: false, reason: "audio-renditions-copy-only" };
  const plan = {
    video,
    audio,
    height,
    channels,
    audioIndex,
    ...(audioIndices ? { audioIndices } : {})
  };
  return {
    ok: true,
    plan,
    signature: audioIndices
      ? `v${video}-a${audio}-h${height}-c${channels}-multi${audioIndices.join("_")}`
      : `v${video}-a${audio}-h${height}-c${channels}-i${audioIndex}`
  };
}

/**
 * Combinations this bridge actually performs.
 *
 * Everything else is refused with a reason instead of being quietly approximated:
 * a caller that asked for a re-encode and received a copy would ship the very file
 * the device already refused.
 */
export function isPlanOffered(plan, fullVideoEnabled = false) {
  if (plan?.video === "h264") return fullVideoEnabled && plan.audio === "aac";
  if (plan?.video !== "copy") return false;
  // `audio: copy` is the remux shape: the container needs fixing, the audio does not.
  // Delivering it as HLS is what lets a film start playing in seconds instead of after
  // the whole file has been copied -- the same trick the audio path already uses.
  return plan?.audio === "aac" || plan?.audio === "copy";
}

/** The codec half of the command, shared by every delivery shape. */
function codecArgs(chosen, { bitrate, videoTag = "" }) {
  const audioTrack =
    Number.isInteger(chosen?.audioIndex) && chosen.audioIndex > 0
      ? `0:a:${chosen.audioIndex}`
      : "0:a:0?";
  const args = ["-map", "0:v:0", "-map", audioTrack];
  if (chosen.video === "copy") {
    args.push("-c:v", "copy");
  } else {
    args.push(
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-vf",
      `scale=w='min(1920,iw)':h='min(${chosen.height || TRANSCODE_PLAN_LIMITS.maxHeight},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`
    );
  }
  if (chosen.audio === "aac") {
    args.push("-c:a", "aac", "-b:a", String(bitrate), "-ac", String(chosen.channels));
  } else {
    args.push("-c:a", "copy");
  }
  // Safari plays HEVC inside an MP4 only when the track is tagged hvc1. An HEVC
  // stream arrives tagged hev1 and is then refused with no explanation -- the same
  // lesson the remux bridge learned. An H.264 source rejects the tag in a tenth of
  // a second, before anything is downloaded, so this is an attempt, not a decision.
  // Only when the picture is copied: a file this bridge encoded itself is H.264, and
  // asking to tag that as HEVC is nonsense that costs a wasted ffmpeg start.
  if (videoTag && chosen.video === "copy") args.push("-tag:v", videoTag);
  return args;
}

export function transcodeArgs(
  source,
  file,
  { bitrate = "192k", videoTag = "", streaming = false, plan = null } = {}
) {
  const chosen = plan || { video: "copy", audio: "aac", height: 0, channels: 2 };
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", source];
  args.push(...codecArgs(chosen, { bitrate, videoTag }));
  if (streaming) {
    // Written to a pipe, so there is no going back to move the movie atom to the
    // front the way faststart does. Fragments instead: each one stands alone and
    // the player can start on the first, minutes before the job is finished. The
    // result is still a real MP4, so a cached one answers Range requests and
    // seeking keeps working on the second play. iOS refuses this shape -- see the
    // measurement in HANDOFF §5 -- which is why HLS exists below.
    args.push("-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "pipe:1");
  } else {
    args.push("-movflags", "+faststart", file);
  }
  return args;
}

/** How long a segment is, in seconds of programme. */
export const HLS_SEGMENT_SECONDS = 4;
export const HLS_PLAYLIST_PATH = "/api/transcode/hls/index.m3u8";
// A key is the first 32 hex characters of a sha256, so the path itself says which
// job a segment belongs to and no state has to be looked up to find it.
export const HLS_MEDIA_ROUTE = /^\/api\/transcode\/hls\/([a-f0-9]{32})\/([A-Za-z0-9._-]+)$/;

/**
 * The command that writes an HLS stream: fragmented segments plus an event
 * playlist, so the player can start on segment one and keep going while ffmpeg is
 * still working on the rest of the film.
 */
export function hlsArgs(source, dir, { bitrate = "192k", videoTag = "", plan = null } = {}) {
  if (plan?.audioIndices) return multiAudioHlsArgs(source, plan.audioIndices, { videoTag });
  const chosen = plan || { video: "copy", audio: "aac", height: 0, channels: 2 };
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", source];
  args.push(...codecArgs(chosen, { bitrate, videoTag }));
  if (chosen.video === "h264") {
    args.push(
      "-flags",
      "+cgop",
      "-force_key_frames",
      `expr:gte(t,n_forced*${HLS_SEGMENT_SECONDS})`
    );
  }
  args.push(
    "-f",
    "hls",
    "-hls_time",
    String(HLS_SEGMENT_SECONDS),
    // `event` keeps everything already written in the playlist, which is what makes
    // it seekable backwards; ffmpeg closes it with ENDLIST when the film ends.
    "-hls_playlist_type",
    "event",
    "-hls_segment_type",
    "fmp4",
    // Bare names on purpose: the bridge runs ffmpeg with the job directory as its
    // working directory, so everything it writes lands there and the playlist holds
    // no local paths. Measured the other way round: an absolute init filename is
    // written into EXT-X-MAP verbatim, leaking a Windows path into the playlist.
    "-hls_fmp4_init_filename",
    "init.mp4",
    "-hls_flags",
    "independent_segments",
    "-hls_segment_filename",
    "seg%05d.m4s",
    "index.m3u8"
  );
  return args;
}

/**
 * The file name at the end of an HLS URI.
 *
 * Both separators are handled because ffmpeg writes whatever path it was given, and
 * on Windows that is a backslash path -- `path.posix.basename` leaves it whole and
 * the rewritten URI then points at nothing.
 */
function hlsBaseName(uri) {
  const parts = String(uri || "")
    .trim()
    .split(/[\\/]/);
  return parts[parts.length - 1] || "";
}

/**
 * Point the playlist at URLs this bridge can answer.
 *
 * ffmpeg names its segments as siblings of the playlist, which would collide
 * between two films. Every URI is rewritten to carry the cache key, and the token
 * the playlist request presented, so the player's follow-up requests for segments
 * pass the same access check as the playlist did.
 *
 * The URIs are relative on purpose: a playlist is resolved against its own URL, so
 * `<key>/seg00000.m4s` lands on `/api/transcode/hls/<key>/seg00000.m4s` without
 * knowing which host the player reached us by. An absolute path was measured to be
 * mis-resolved by ffmpeg's HLS demuxer -- it appended it to the playlist path and
 * asked the bridge for a file that does not exist.
 */
export function rewriteHlsPlaylist(text, { key = "", token = "", base = "" } = {}) {
  const query = token ? `?token=${encodeURIComponent(token)}` : "";
  const prefix = `${base}${key}`;
  const hoist = (uri) => `${prefix}/${hlsBaseName(uri)}${query}`;

  return String(text || "")
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#EXT-X-MAP:") || trimmed.startsWith("#EXT-X-MEDIA:")) {
        return trimmed.replace(/URI="([^"]+)"/, (_match, uri) => `URI="${hoist(uri)}"`);
      }
      if (trimmed.startsWith("#")) return line;
      return hoist(trimmed);
    })
    .join("\n");
}

/**
 * Has this HLS job gone quiet for too long?
 *
 * A phone plays, pauses, or closes and simply stops asking. The job outlives the
 * request that started it -- that is what makes playback start early -- so silence is
 * the only signal available, and a finished job is never idle: its segments are what a
 * paused viewer returns to.
 */
export function hlsJobIsIdle(job, { at = Date.now(), idleMs = 0 } = {}) {
  if (!job || job.done || job.failed) return false;
  if (!(idleMs > 0)) return false;
  const lastSeen = Number(job.lastRequestAt || job.lastUsed || 0);
  return at - lastSeen >= idleMs;
}

export function createTranscodeBridgeHandler({
  ffmpegPath = resolveFFmpegPath(),
  ffmpegRuntime = null,
  fullVideoEnabled = String(process.env.TRANSCODE_MODE || "")
    .trim()
    .toLowerCase() === "server" ||
    /^(1|true)$/i.test(String(process.env.TRANSCODE_FULL_VIDEO_ENABLED || "").trim()),
  workDir = process.env.TRANSCODE_WORK_DIR || path.join(tmpdir(), "nuvio-transcode"),
  access = process.env.TRANSCODE_ACCESS || ACCESS.TOKEN,
  token = process.env.TRANSCODE_TOKEN || "",
  bitrate = process.env.TRANSCODE_AUDIO_BITRATE || "192k",
  ttlMs = DEFAULT_TTL_MS,
  finishedTtlMs = DEFAULT_FINISHED_TTL_MS,
  timeoutMs = Number(process.env.TRANSCODE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  maxTotalBytes = DEFAULT_MAX_BYTES,
  sweepIntervalMs = DEFAULT_SWEEP_MS,
  // Deployment policy, permissive by default; the server reads these from the
  // environment. Zero always means "no limit". A transcode is CPU-bound where a remux
  // is network-bound, so the same knobs answer both costs.
  maxConcurrent = 0,
  perIpConcurrent = 0,
  maxSourceBytes = 0,
  dailyBudgetBytes = 0,
  // How long a run may go with nobody asking for anything. A paused player is silent
  // too, so this is minutes by default: short enough to free a home uplink, long
  // enough that pausing to answer a message does not end the film.
  hlsIdleMs = Number(process.env.RELAY_HLS_IDLE_MS ?? 100_000) || 0,
  abandonGraceMs = Number(process.env.RELAY_ABANDON_GRACE_MS ?? 5000) || 0,
  monthlyEgressBytes = Number(process.env.RELAY_MONTHLY_EGRESS_BYTES ?? 0) || 0,
  sourceSize = null,
  spawnImpl = spawn,
  readTextTracks = createRelayTextReader(),
  log = console,
  now = () => Date.now()
} = {}) {
  const jobs = new Map();
  // One entry per key for HLS: the segments are the output, and the directory is
  // what a later playlist request reads.
  const hlsJobs = new Map();
  // Work actually being produced right now, by whom. Serving an already-prepared file
  // or an existing playlist is free and must never be refused by a limit.
  const running = new Map();
  const runningByIp = new Map();
  const starting = new Set();
  // Egress is what a host bills, so it is budgeted per calendar month.
  const egress = createEgressBudget({ now, monthlyBytes: monthlyEgressBytes });
  // Buffered work is tied to a client, so it can be cancelled when the last one leaves.
  const waiting = new Map();
  const abandonTimers = new Map();
  const dayStamp = () => new Date(now()).toISOString().slice(0, 10);
  let budget = { day: dayStamp(), bytes: 0 };
  let abandoned = 0;
  const budgetUsedToday = () => {
    if (budget.day !== dayStamp()) budget = { day: dayStamp(), bytes: 0 };
    return budget.bytes;
  };

  async function sweep() {
    // Two clocks. A finished output only costs disk and is what a paused viewer needs
    // on return, so it is kept for hours; an abandoned or half-written one can never
    // be played and is swept quickly.
    const cutoff = now() - ttlMs;
    const finishedCutoff = now() - finishedTtlMs;
    const finishedFiles = new Set();
    for (const job of jobs.values()) {
      if (job.file) finishedFiles.add(path.basename(job.file));
    }
    let names = [];
    try {
      names = await readdir(workDir);
    } catch {
      names = [];
    }
    for (const name of names) {
      const full = path.join(workDir, name);
      if (name.endsWith(".mp4")) {
        const limit = finishedFiles.has(name) ? finishedCutoff : cutoff;
        try {
          const info = await stat(full);
          if (info.mtimeMs < limit) await rm(full, { force: true });
        } catch {
          // already gone
        }
        continue;
      }
      // An HLS job owns a directory of segments. Its timestamp moves as segments
      // are written, so a directory left alone is work nobody came back for -- on the
      // long clock when the run finished, because a paused player stops asking for
      // segments and its playlist must still be there when it resumes.
      if (/^[a-f0-9]{32}$/.test(name)) {
        const hlsJob = hlsJobs.get(name);
        const limit = hlsJob?.done ? finishedCutoff : cutoff;
        try {
          const info = await stat(full);
          if (info.mtimeMs < limit) {
            await rm(full, { recursive: true, force: true });
            hlsJobs.delete(name);
          }
        } catch {
          // already gone
        }
      }
    }
    let total = 0;
    const sized = [];
    for (const [key, job] of jobs) {
      if (!job.file) continue;
      try {
        const size = statSync(job.file).size;
        total += size;
        sized.push({ key, size, lastUsed: job.lastUsed });
      } catch {
        // The output is gone even though the entry is not: the directory was swept
        // by age, or cleared by someone else. Forget the entry so the next request
        // transcodes again instead of pointing at a file that no longer exists.
        jobs.delete(key);
      }
    }
    for (const [key, job] of hlsJobs) {
      if (job.done) continue;
      sized.push({ key, size: 0, lastUsed: job.lastUsed });
    }
    if (total <= maxTotalBytes) return;
    sized.sort((left, right) => left.lastUsed - right.lastUsed);
    for (const entry of sized) {
      if (total <= maxTotalBytes) break;
      const job = jobs.get(entry.key);
      jobs.delete(entry.key);
      void rm(job?.file || path.join(workDir, `${entry.key}.mp4`), { force: true }).catch(() => {});
      total -= entry.size;
    }
  }

  const sweeper = setInterval(() => void sweep(), sweepIntervalMs);
  sweeper.unref?.();

  /**
   * Nobody is asking for segments any more: stop producing them.
   *
   * An HLS job outlives the request that started it, on purpose -- that is what lets a
   * phone play while the rest is still being made. So "the client is gone" cannot be
   * told from a closed connection; it is told from silence. A paused player is silent
   * too, which is why the window is measured in minutes and not seconds.
   */
  function cancelIfIdle(key) {
    const job = hlsJobs.get(key);
    if (!hlsJobIsIdle(job, { at: now(), idleMs: hlsIdleMs })) return;
    hlsJobs.delete(key);
    jobs.delete(key);
    try {
      job.child?.kill("SIGKILL");
    } catch {
      // already gone
    }
    void rm(job.dir, { recursive: true, force: true }).catch(() => {});
    abandoned += 1;
    log.warn(`[transcode] abandoned ${key.slice(0, 8)} idle`);
  }

  const idleCheck = setInterval(
    () => {
      for (const key of [...hlsJobs.keys()]) cancelIfIdle(key);
    },
    Math.max(20, Math.min(hlsIdleMs || 15000, 15000))
  );
  idleCheck.unref?.();

  function runFfmpeg(args, { cwd = undefined, key = "" } = {}) {
    return new Promise((resolve) => {
      let settled = false;
      // `cwd` is how an HLS job keeps every file it writes inside its own directory:
      // ffmpeg resolves bare output names against the working directory, not against
      // the playlist, so without this the init segment landed in the app's folder.
      const child = spawnImpl(ffmpegPath, args, { stdio: "ignore", cwd });
      // Held on the job so an abandoned run can be killed from outside this promise.
      const owner = hlsJobs.get(key) || jobs.get(key);
      if (owner) owner.child = child;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          child.kill("SIGKILL");
        } catch {
          // gone
        }
        resolve(false);
      }, timeoutMs);
      child.on("error", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(false);
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const current = hlsJobs.get(key) || jobs.get(key);
        if (current && current.child === child) current.child = null;
        resolve(code === 0);
      });
    });
  }

  /**
   * A buffered transcode tied to one client: when the last one leaves, so does the
   * work. Same reasoning as the remux bridge -- a run nobody will watch must not hold
   * the queue slot for the rest of the film -- with the same grace period, so a reload
   * does not throw the work away.
   */
  function watchWaiter(key) {
    waiting.set(key, (waiting.get(key) || 0) + 1);
    const pending = abandonTimers.get(key);
    if (pending) {
      clearTimeout(pending);
      abandonTimers.delete(key);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = Math.max(0, (waiting.get(key) || 1) - 1);
      if (left > 0) {
        waiting.set(key, left);
        return;
      }
      waiting.delete(key);
      scheduleAbandon(key);
    };
  }

  function scheduleAbandon(key) {
    if (abandonGraceMs <= 0) {
      cancelIfAbandoned(key);
      return;
    }
    const timer = setTimeout(() => {
      abandonTimers.delete(key);
      cancelIfAbandoned(key);
    }, abandonGraceMs);
    timer.unref?.();
    abandonTimers.set(key, timer);
  }

  function cancelIfAbandoned(key) {
    if (waiting.has(key)) return;
    const job = jobs.get(key);
    if (!job) return;
    // Finished work is not abandoned work: it costs only disk, and it is exactly what
    // the viewer needs if they come back.
    if (job.file && existsSync(job.file)) return;
    jobs.delete(key);
    try {
      job.child?.kill("SIGKILL");
    } catch {
      // already gone
    }
    void rm(path.join(workDir, `${key}.mp4`), { force: true }).catch(() => {});
    abandoned += 1;
    log.log(`[transcode] abandoned ${key.slice(0, 8)}`);
  }

  async function fileFor(source, key, plan) {
    const existing = jobs.get(key);
    if (existing) {
      existing.lastUsed = now();
      // A job can outlive its own output: the sweeper deletes files by age and
      // nothing deletes the entry that points at one. Handing that entry back made
      // every later play of the same stream fail with ENOENT -- a 500 that no
      // amount of retrying or waiting could clear, only a restart. One stat is
      // cheaper than that, and re-transcoding is what the request actually wanted.
      try {
        const file = await existing.promise;
        if (existsSync(file) && statSync(file).size > 0) {
          // Being watched leaves a mark on the file: a paused viewer sends nothing,
          // and an untouched file is what a size-driven sweep discards first.
          void utimes(file, new Date(now()), new Date(now())).catch(() => {});
          return file;
        }
      } catch {
        // The earlier attempt failed. Asking ffmpeg again is the answer.
      }
      jobs.delete(key);
    }
    const job = { lastUsed: now(), file: null, promise: null };
    job.promise = (async () => {
      await mkdir(workDir, { recursive: true });
      const file = path.join(workDir, `${key}.mp4`);
      if (existsSync(file) && statSync(file).size > 0) return file;
      // First the tag Safari needs, then the same command without it. Costs
      // nothing when the picture is not HEVC: ffmpeg refuses the tag at header
      // time, before the first byte of the source has been read.
      for (const videoTag of ["hvc1", ""]) {
        const ok = await runFfmpeg(transcodeArgs(source, file, { bitrate, videoTag, plan }), {
          key
        });
        if (ok && existsSync(file) && statSync(file).size > 0) return file;
        await rm(file, { force: true }).catch(() => {});
      }
      throw new Error("transcode-failed");
    })().then((file) => {
      job.file = file;
      return file;
    });
    jobs.set(key, job);
    try {
      return await job.promise;
    } catch (error) {
      jobs.delete(key);
      throw error;
    }
  }

  /**
   * Start (or reuse) the HLS job for one source and plan.
   *
   * The job is not awaited here: the playlist is the answer, and it is served as
   * soon as it holds one finished segment. That is the whole point of this
   * delivery -- the player starts while ffmpeg is still working on the film.
   */
  function ensureHlsJob(source, key, plan) {
    const existing = hlsJobs.get(key);
    // A completed job may outlive files removed from the cache. Recreate its
    // producer instead of serving a permanently missing playlist from memory.
    const outputMissing = existing?.done && !existsSync(path.join(existing.dir, "index.m3u8"));
    if (existing && !outputMissing) {
      existing.lastUsed = now();
      existing.lastRequestAt = now();
      return existing;
    }
    const dir = path.join(workDir, key);
    const job = {
      dir,
      lastUsed: now(),
      // When the player last asked for the playlist or a segment. A paused player asks
      // for nothing, which is indistinguishable from one that closed the app -- hence
      // a generous idle window rather than an instant kill.
      lastRequestAt: now(),
      done: false,
      failed: false,
      child: null,
      audioIndices: plan.audioIndices || null
    };
    job.promise = mkdir(dir, { recursive: true })
      .then(async () => {
        const playlistPath = path.join(dir, "index.m3u8");
        for (const videoTag of plan.video === "h264" ? [""] : ["hvc1", ""]) {
          const ok = await runFfmpeg(hlsArgs(source, dir, { bitrate, plan, videoTag }), {
            cwd: dir,
            key
          });
          if (ok) {
            job.done = true;
            return true;
          }
          // A rejected tag fails at header time, before the playlist exists, so the
          // second attempt starts from an untouched directory. Anything further
          // along is not worth repeating into the same place.
          if (existsSync(playlistPath)) break;
        }
        job.failed = true;
        hlsJobs.delete(key);
        return false;
      })
      .catch(() => {
        job.failed = true;
        hlsJobs.delete(key);
        return false;
      });
    hlsJobs.set(key, job);
    return job;
  }

  /**
   * The playlist, as soon as it is worth having.
   *
   * ffmpeg appends a segment only once that segment is finished, so the first
   * `#EXTINF` line is the moment playback can start. Waiting for it here is
   * cheaper than handing the player an empty playlist it will abandon.
   */
  async function readHlsPlaylist(job) {
    const playlistPath = path.join(job.dir, "index.m3u8");
    for (let attempt = 0; attempt < 100; attempt += 1) {
      // Capture completion before the read: the producer may finish while an
      // earlier ENOENT is in flight. In that case, read its final playlist next.
      const finished = job.failed || job.done;
      try {
        const text = await readFile(playlistPath, "utf8");
        if (job.audioIndices) {
          const ready = await Promise.all(
            Array.from({ length: job.audioIndices.length + 1 }, (_, i) =>
              readFile(path.join(job.dir, "v" + i + ".m3u8"), "utf8")
                .then((body) => /#EXTINF/.test(body))
                .catch(() => false)
            )
          );
          if (/#EXT-X-STREAM-INF/.test(text) && ready.every(Boolean))
            return await publishEarlyMaster(text, job);
        } else if (/#EXTINF/.test(text)) return text;
      } catch {
        // not written yet
      }
      if (finished) return "";
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return "";
  }

  /** Serve a finished file, by byte range when the player asks for one. */
  function serveFile(file, request, response) {
    const size = statSync(file).size;
    const range = parseByteRange(request.headers?.range, size);
    const headers = {
      "Content-Type": "video/mp4",
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges"
    };

    if (range) {
      response.writeHead(206, {
        ...headers,
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        "Content-Length": range.end - range.start + 1
      });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      egress.add(range.end - range.start + 1);
      createReadStream(file, range).pipe(response);
      return;
    }

    egress.add(size);
    response.writeHead(200, { ...headers, "Content-Length": size });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(file).pipe(response);
  }

  /**
   * Hand the client the first fragments while ffmpeg is still working.
   *
   * Waiting for the whole file is what made a two-hour film impossible to play: the
   * player gives up after eighteen seconds, and the job needs minutes. So the
   * output goes to a pipe and the same bytes are written to disk as they arrive,
   * which means the first play starts almost immediately and every later play â€”
   * and every seek â€” is served from the finished file.
   *
   * Returns "done", "rejected" (ffmpeg refused the arguments before any output, so
   * the other tag attempt is worth trying) or "aborted" (bytes already left; there
   * is no second chance, and the client is gone).
   */
  function streamOnce(source, { videoTag, response, partFile, plan }) {
    return new Promise((resolve) => {
      const args = transcodeArgs(source, "pipe:1", { bitrate, videoTag, streaming: true, plan });
      const child = spawnImpl(ffmpegPath, args, { stdio: ["ignore", "pipe", "ignore"] });
      const sink = createWriteStream(partFile);
      let committed = false;
      let settled = false;

      const settle = (outcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          child.kill("SIGKILL");
        } catch {
          // already gone
        }
        // The rename that follows has to see a closed file, or Windows hands the
        // caller a half-written one.
        if (sink.destroyed || sink.writableEnded) {
          resolve(outcome);
          return;
        }
        sink.end(() => resolve(outcome));
      };

      const timer = setTimeout(() => settle(committed ? "aborted" : "rejected"), timeoutMs);

      child.stdout?.on("data", (chunk) => {
        if (settled) return;
        if (!committed) {
          committed = true;
          response.writeHead(200, {
            "Content-Type": "video/mp4",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*"
          });
        }
        sink.write(chunk);
        if (!response.write(chunk)) {
          child.stdout.pause();
          response.once("drain", () => child.stdout.resume());
        }
      });

      child.on("error", () => settle(committed ? "aborted" : "rejected"));
      child.on("close", (code) => {
        if (code === 0 && committed) {
          response.end();
          settle("done");
          return;
        }
        settle(committed ? "aborted" : "rejected");
      });
      // A closed phone is a stopped job: nothing will read the rest, so the CPU is
      // better spent on whoever asks next.
      response.on("close", () => {
        if (!response.writableEnded) settle("aborted");
      });
    });
  }

  async function streamToResponse(source, key, response, plan) {
    const finalFile = path.join(workDir, `${key}.mp4`);
    const partFile = path.join(workDir, `${key}.streaming.mp4`);
    await mkdir(workDir, { recursive: true });

    let outcome = "rejected";
    for (const videoTag of ["hvc1", ""]) {
      outcome = await streamOnce(source, { videoTag, response, partFile, plan });
      if (outcome === "done") {
        await rm(finalFile, { force: true }).catch(() => {});
        await rename(partFile, finalFile).catch(() => {});
        return existsSync(finalFile) && statSync(finalFile).size > 0 ? "done" : "rejected";
      }
      await rm(partFile, { force: true }).catch(() => {});
      if (outcome !== "rejected") return outcome;
    }
    return outcome;
  }

  /** The access answer every route asks, including the playlist's segment requests. */
  function authorize(requestUrl, request, response) {
    const authorization = String(request.headers?.authorization || "");
    const bearer = /^Bearer\s+(.+)$/i.exec(authorization)?.[1] || "";
    const presented = bearer || String(requestUrl.searchParams.get("token") || "");
    const verdict = resolveAccess({
      access,
      token,
      presented,
      address: clientAddress(request.headers, request.socket?.remoteAddress)
    });
    if (verdict.ok) return { ok: true, presented };
    // Logged because a refusal reaches the phone as "cannot play", which is
    // indistinguishable from a broken file without this line.
    log.warn(`[transcode] refused ${verdict.reason} (mode ${verdict.mode})`);
    json(
      response,
      verdict.reason === "token-mismatch" || verdict.reason === "token-not-configured" ? 401 : 403,
      { ok: false, error: verdict.reason }
    );
    return { ok: false, presented };
  }

  /** The plan and the source, or a response already written explaining why not. */
  function resolvePlanAndSource(requestUrl, response) {
    const planResult = parseTranscodePlan(requestUrl.searchParams);
    if (!planResult.ok) {
      json(response, 400, { ok: false, error: planResult.reason });
      return null;
    }
    if (!isPlanOffered(planResult.plan, fullVideoEnabled)) {
      // Refused by name rather than approximated: a caller that asked for a
      // re-encode and received a copy would ship the file the device already
      // rejected, and the failure would look like ours.
      json(response, 501, {
        ok: false,
        error: "plan-not-offered",
        plan: planResult.plan,
        offered: { video: "copy", audio: "aac", audioModes: ["aac", "copy"] }
      });
      return null;
    }
    if (
      ffmpegRuntime &&
      (!ffmpegRuntime.remux ||
        (planResult.plan.audio === "aac" && !ffmpegRuntime.audioTranscoding) ||
        (planResult.plan.video === "h264" && !ffmpegRuntime.videoTranscoding))
    ) {
      json(response, 503, { ok: false, error: "ffmpeg-capability-unavailable" });
      return null;
    }
    const parsed = parseTranscodeSource(requestUrl.searchParams.get("u"), {
      planSignature: planResult.signature
    });
    if (!parsed.ok) {
      json(response, 400, { ok: false, error: parsed.reason });
      return null;
    }
    return { plan: planResult.plan, parsed };
  }

  async function serveHlsMedia(key, name, request, response, presented = "") {
    const dir = path.join(workDir, key);
    const full = path.join(dir, name);
    // A segment request is a viewer still watching. Without this the idle timer would
    // count only playlist polls and could cancel a film that is playing fine.
    const job = hlsJobs.get(key);
    if (job) {
      job.lastUsed = now();
      job.lastRequestAt = now();
    }
    if (!full.startsWith(`${dir}${path.sep}`) || !existsSync(full)) {
      // The playlist only lists finished segments, so this is a request that came
      // too early or a key nobody started. Either way there is nothing to send.
      json(response, 404, { ok: false, error: "segment-not-ready" });
      return;
    }
    if (name.endsWith(".m3u8")) {
      const body = rewriteHlsPlaylist(await readFile(full, "utf8"), {
        key,
        token: presented,
        base: "/api/transcode/hls/"
      });
      response.writeHead(200, {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*"
      });
      response.end(request.method === "HEAD" ? undefined : body);
      return;
    }
    serveFile(full, request, response);
  }

  /**
   * May this request start new work?
   *
   * A HLS job and a buffered file are both real production, so both ask. Serving a
   * playlist, a segment or a finished file never asks: nothing is produced. A busy
   * server answers 429 (retry in seconds) and a spent budget 503 (retry tomorrow),
   * because those are different instructions to a client.
   */
  function capacityRefusal(address) {
    const used = budgetUsedToday();
    if (dailyBudgetBytes > 0 && used >= dailyBudgetBytes) {
      return {
        status: 503,
        payload: { ok: false, error: "quota-exhausted", usedBytesToday: used, dailyBudgetBytes },
        headers: { "Retry-After": "3600" }
      };
    }
    if (maxConcurrent > 0 && running.size >= maxConcurrent) {
      return {
        status: 429,
        payload: {
          ok: false,
          error: "busy",
          active: running.size,
          maxConcurrent,
          retryAfterSeconds: 5
        },
        headers: { "Retry-After": "5" }
      };
    }
    if (perIpConcurrent > 0 && (runningByIp.get(address) || 0) >= perIpConcurrent) {
      return {
        status: 429,
        payload: { ok: false, error: "caller-busy", retryAfterSeconds: 5 },
        headers: { "Retry-After": "5" }
      };
    }
    return null;
  }

  async function admit(url, address) {
    const refusal = capacityRefusal(address);
    if (refusal) return refusal;
    if (maxSourceBytes > 0) {
      const size = typeof sourceSize === "function" ? await sourceSize(url) : 0;
      if (size > maxSourceBytes) {
        return {
          status: 413,
          payload: { ok: false, error: "source-too-large", size, maxSourceBytes },
          headers: null
        };
      }
    }
    return null;
  }

  /** Account for one running production; joining a running job is not a new one. */
  function beginWork(key, address) {
    if (starting.has(key) || jobs.has(key)) return false;
    starting.add(key);
    running.set(key, address);
    runningByIp.set(address, (runningByIp.get(address) || 0) + 1);
    return true;
  }

  function endWork(key, address) {
    if (!starting.has(key)) return;
    starting.delete(key);
    running.delete(key);
    const remaining = (runningByIp.get(address) || 1) - 1;
    if (remaining > 0) runningByIp.set(address, remaining);
    else runningByIp.delete(address);
  }

  return async function handleTranscodeBridge(request, response) {
    const requestUrl = new URL(
      request.url || "/",
      `http://${request.headers?.host || "localhost"}`
    );
    if (requestUrl.pathname === HEALTH_PATH) {
      // `hls` is advertised so the app can ask for the delivery this bridge actually
      // offers instead of assuming: an older deployment without it keeps the
      // whole-file answer, which still plays -- only later.
      json(response, ffmpegRuntime && !ffmpegRuntime.remux ? 503 : 200, {
        ok: !ffmpegRuntime || ffmpegRuntime.remux,
        ffmpeg: publicFFmpegCapabilities(ffmpegRuntime),
        access: normalizeAccess(access),
        hls: !ffmpegRuntime || ffmpegRuntime.hls,
        fullVideo:
          fullVideoEnabled &&
          ffmpegRuntime?.videoTranscoding === true &&
          ffmpegRuntime?.hls === true,
        embeddedText: true,
        alternateAudio: true,
        offered: {
          video: "copy",
          audio: ffmpegRuntime && !ffmpegRuntime.audioTranscoding ? "copy" : "aac",
          audioModes: ffmpegRuntime && !ffmpegRuntime.audioTranscoding ? ["copy"] : ["aac", "copy"]
        },
        maxConcurrent,
        active: running.size,
        busy: maxConcurrent > 0 && running.size >= maxConcurrent,
        maxSourceBytes,
        dailyBudgetBytes,
        usedBytesToday: budgetUsedToday(),
        remainingBytesToday:
          dailyBudgetBytes > 0 ? Math.max(0, dailyBudgetBytes - budgetUsedToday()) : 0,
        ...egress.snapshot(),
        maxDiskBytes: maxTotalBytes,
        hlsIdleMs,
        abandoned
      });
      return;
    }

    const hlsMedia = HLS_MEDIA_ROUTE.exec(requestUrl.pathname);
    const isPlaylist = requestUrl.pathname === HLS_PLAYLIST_PATH;
    if (ffmpegRuntime && !ffmpegRuntime.hls && (isPlaylist || hlsMedia)) {
      json(response, 503, { ok: false, error: "hls-unavailable" });
      return;
    }
    if (requestUrl.pathname !== STREAM_PATH && !isPlaylist && !hlsMedia) {
      json(response, 404, { ok: false, error: "unknown_path" });
      return;
    }

    const auth = authorize(requestUrl, request, response);
    if (!auth.ok) return;

    if (request.method !== "GET" && request.method !== "HEAD") {
      json(response, 405, { ok: false, error: "method_not_allowed" });
      return;
    }

    if (hlsMedia) {
      await serveHlsMedia(hlsMedia[1], hlsMedia[2], request, response, auth.presented);
      return;
    }

    const resolved = resolvePlanAndSource(requestUrl, response);
    if (!resolved) return;
    const { plan, parsed } = resolved;
    if (plan.audioIndices && !isPlaylist && !requestUrl.searchParams.has("text"))
      return json(response, 400, { ok: false, error: "audio-renditions-hls-only" });

    if (requestUrl.pathname === STREAM_PATH && requestUrl.searchParams.has("text")) {
      // Read text only for a source/plan already admitted to the existing HLS path.
      if (!hlsJobs.has(parsed.key))
        return json(response, 409, { ok: false, error: "subtitle-hls-not-ready" });
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 15000);
      const cancel = () => abort.abort();
      response.once("close", cancel);
      try {
        const result = await readTextTracks(parsed.url, requestUrl.searchParams, abort.signal);
        if (!response.destroyed) json(response, 200, { ok: true, ...result });
      } catch (error) {
        const reason = /^[a-z0-9-]+$/.test(error.message) ? error.message : "subtitle-read-failed";
        const status =
          reason === "subtitle-reader-busy"
            ? 503
            : reason === "subtitle-request-invalid"
              ? 400
              : 422;
        if (!response.destroyed) json(response, status, { ok: false, error: reason });
      } finally {
        clearTimeout(timer);
        response.off("close", cancel);
      }
      return;
    }

    void sweep();

    // Everything below is logged, because "the phone said it cannot play" is not a
    // diagnosis: refused, started, cached and failed are four different stories and
    // without a line each, the only evidence left is the phone's own error page.
    // The source URL never appears -- it carries a debrid token -- only its host.
    const host = (() => {
      try {
        return new URL(parsed.url).host;
      } catch {
        return "?";
      }
    })();

    // HLS: the delivery iOS actually accepts for something that starts playing while
    // it is still being made. The playlist is the answer; the segments are its own
    // requests, rewritten to carry the key and the token this caller presented.
    if (isPlaylist) {
      // HLS jobs live in hlsJobs; jobs belongs to whole-file delivery.
      const existingJob = () => {
        const cached = hlsJobs.get(parsed.key);
        return cached && (!cached.done || existsSync(path.join(cached.dir, "index.m3u8")))
          ? cached
          : null;
      };
      const address = clientAddress(request.headers, request.socket?.remoteAddress);
      let job = existingJob();
      if (!job) {
        const admission = await admit(parsed.url, address);
        job = existingJob();
        if (!job) {
          const refusal = admission || capacityRefusal(address);
          if (refusal) {
            json(response, refusal.status, refusal.payload, refusal.headers);
            return;
          }
          const didWork = beginWork(parsed.key, address);
          job = ensureHlsJob(parsed.url, parsed.key, plan);
          // The encoder keeps running after the first playlist response.
          if (didWork) void job.promise.finally(() => endWork(parsed.key, address));
        }
      }
      job.lastUsed = now();
      job.lastRequestAt = now();
      const text = await readHlsPlaylist(job);
      if (!text) {
        if (!job.failed && !job.done) {
          log.log(`[transcode] pending ${parsed.key.slice(0, 8)} hls-no-playlist ${host}`);
          json(response, 503, { ok: false, error: "playlist-not-ready" }, { "Retry-After": "1" });
          return;
        }
        log.warn(`[transcode] failed ${parsed.key.slice(0, 8)} hls-no-playlist ${host}`);
        json(response, 502, { ok: false, error: "transcode-failed" });
        return;
      }
      log.log(
        `[transcode] hls ${parsed.key.slice(0, 8)} video=${plan.video} audio=${plan.audio} ai=${plan.audioIndex} segments=${(text.match(/#EXTINF/g) || []).length} ${host}`
      );
      response.writeHead(200, {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*"
      });
      response.end(
        rewriteHlsPlaylist(
          plan.audioIndices
            ? selectDefaultRendition(text, plan.audioIndices, plan.audioIndex)
            : text,
          { key: parsed.key, token: auth.presented }
        )
      );
      return;
    }

    // Progressive mode. A finished file is always served from disk -- it is the
    // fastest and the only one that can seek -- so this only changes the first
    // play, which is the one the player was giving up on.
    if (requestUrl.searchParams.get("stream") === "1" && request.method === "GET") {
      const cached = path.join(workDir, `${parsed.key}.mp4`);
      if (existsSync(cached) && statSync(cached).size > 0) {
        log.log(`[transcode] cache ${parsed.key.slice(0, 8)} ${host}`);
        serveFile(cached, request, response);
        return;
      }
      const startedAt = now();
      log.log(`[transcode] stream ${parsed.key.slice(0, 8)} ${host}`);
      // Registered before the work starts, so a second tap waits for the same job
      // instead of starting a second ffmpeg on the same film.
      const address = clientAddress(request.headers, request.socket?.remoteAddress);
      const refusal = await admit(parsed.url, address);
      if (refusal) {
        json(response, refusal.status, refusal.payload, refusal.headers);
        return;
      }
      const didWork = beginWork(parsed.key, address);
      const job = { lastUsed: now(), file: null, promise: null };
      job.promise = streamToResponse(parsed.url, parsed.key, response, plan).then((outcome) => {
        if (outcome !== "done") throw new Error(`transcode-${outcome}`);
        job.file = path.join(workDir, `${parsed.key}.mp4`);
        const size = statSync(job.file).size;
        log.log(
          `[transcode] done ${parsed.key.slice(0, 8)} ${(size / 1024 / 1024).toFixed(1)} MB in ${Math.round((now() - startedAt) / 1000)}s`
        );
        return job.file;
      });
      jobs.set(parsed.key, job);
      try {
        await job.promise;
      } catch (error) {
        jobs.delete(parsed.key);
        log.warn(`[transcode] failed ${parsed.key.slice(0, 8)} ${String(error?.message || error)}`);
        if (!response.headersSent) json(response, 502, { ok: false, error: "transcode-failed" });
      } finally {
        if (didWork) endWork(parsed.key, address);
      }
      return;
    }

    let file;
    const cachedFile = path.join(workDir, `${parsed.key}.mp4`);
    const needsWork =
      !(existsSync(cachedFile) && statSync(cachedFile).size > 0) && !jobs.has(parsed.key);
    const address = clientAddress(request.headers, request.socket?.remoteAddress);
    if (needsWork) {
      const refusal = await admit(parsed.url, address);
      if (refusal) {
        json(response, refusal.status, refusal.payload, refusal.headers);
        return;
      }
    }
    const didWork = needsWork ? beginWork(parsed.key, address) : false;
    // Counted before the work starts, because that is when the viewer can leave; the
    // response closing early is the only reliable signal.
    const release = watchWaiter(parsed.key);
    response.once("close", release);
    try {
      log.log(`[transcode] buffered ${parsed.key.slice(0, 8)} ${host}`);
      file = await fileFor(parsed.url, parsed.key, plan);
    } catch {
      log.warn(`[transcode] failed ${parsed.key.slice(0, 8)} buffered`);
      json(response, 502, { ok: false, error: "transcode-failed" });
      return;
    } finally {
      if (didWork) endWork(parsed.key, address);
      release();
    }
    if (didWork) {
      budgetUsedToday();
      budget.bytes += statSync(file).size;
    }

    serveFile(file, request, response);
  };
}

export function createTranscodeBridgeServer(options = {}) {
  return createServer(createTranscodeBridgeHandler(options));
}
