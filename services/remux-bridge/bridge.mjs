import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

// Remux bridge.
//
// Safari cannot open an MKV: not because of the codec, but the container. The same
// frames play perfectly once they are in an MP4 — measured, not assumed — so the
// cheapest way to extend what the built-in player can open is to change the box,
// not to add an engine that decodes by itself.
//
// Server-side on purpose:
//  - the server fetches the source, so a CDN that sends no CORS headers stops
//    being an obstacle;
//  - `-c copy` moves bytes without re-encoding, so the cost is I/O, not CPU;
//  - the device receives something `<video>` plays on the hardware path.
//
// Deliberately narrow, like the other bridges: one source parameter, http(s) only,
// a size of work nobody can ask for twice at once, and temporary files that expire.

// An hour, so a film paused for a while and a download that dropped can both pick
// up where they left off without paying for the remux twice.
const DEFAULT_TTL_MS = 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
// Room for a couple of films in flight without letting the directory grow without
// limit. Overridable per deployment.
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024 * 1024;
const DEFAULT_SWEEP_MS = 5 * 60 * 1000;
const HEALTH_PATH = "/api/remux/health";
const STREAM_PATH = "/api/remux";

function json(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(payload));
}

/** Only what can actually be fetched, and nothing that pretends to be local. */
export function parseRemuxSource(raw, { allowHosts = null } = {}) {
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
  if (Array.isArray(allowHosts) && allowHosts.length) {
    const host = url.hostname.toLowerCase();
    const allowed = allowHosts.some((entry) => host === entry || host.endsWith(`.${entry}`));
    if (!allowed) return { ok: false, reason: "host-not-allowed" };
  }
  return {
    ok: true,
    url: url.toString(),
    key: createHash("sha256").update(url.toString()).digest("hex").slice(0, 32)
  };
}

/** A range the browser asked for, clamped to the file rather than trusted. */
export function parseByteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || "").trim());
  if (!match || !(size > 0)) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;
  let start = rawStart ? Number(rawStart) : NaN;
  let end = rawEnd ? Number(rawEnd) : NaN;
  if (!Number.isFinite(start)) {
    // "bytes=-N" means the last N bytes.
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else if (!Number.isFinite(end)) {
    end = size - 1;
  }
  if (start < 0 || start >= size || end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}

export function createRemuxBridgeHandler({
  ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg",
  workDir = path.join(tmpdir(), "nuvio-remux"),
  ttlMs = DEFAULT_TTL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxTotalBytes = DEFAULT_MAX_BYTES,
  sweepIntervalMs = DEFAULT_SWEEP_MS,
  allowHosts = null,
  spawnImpl = spawn,
  now = () => Date.now()
} = {}) {
  /** key -> { promise, file, lastUsed } — one ffmpeg run per source, shared by all askers. */
  const jobs = new Map();

  /**
   * Delete what is expired, then trim until the directory fits its budget.
   *
   * Two rules, because one was not enough: an age limit alone lets a handful of
   * long films fill the disk for hours, and a size limit alone would evict a file
   * someone is still watching. Age first, then the least recently used.
   */
  async function sweep() {
    const cutoff = now() - ttlMs;

    // Files left by a previous process are not in the map at all — after a restart
    // the map is empty while the directory is not — so the directory is swept too,
    // by the file's own timestamp.
    let names = [];
    try {
      names = await readdir(workDir);
    } catch {
      names = [];
    }
    for (const name of names) {
      if (!name.endsWith(".mp4")) continue;
      const full = path.join(workDir, name);
      try {
        const info = await stat(full);
        if (info.mtimeMs < cutoff) await rm(full, { force: true });
      } catch {
        // gone already
      }
    }

    for (const [key, job] of jobs) {
      if (job.file && job.lastUsed < cutoff) {
        jobs.delete(key);
        void rm(job.file, { force: true }).catch(() => {});
      }
    }

    let total = 0;
    const sized = [];
    for (const [key, job] of jobs) {
      if (!job.file) continue;
      let size = 0;
      try {
        size = statSync(job.file).size;
      } catch {
        continue;
      }
      total += size;
      sized.push({ key, size, lastUsed: job.lastUsed });
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

  // Lazy sweeping alone left files behind for as long as nobody asked again, which
  // on a quiet deployment is forever. The timer is unref'd so it never keeps a test
  // process or a server alive on its own.
  const sweeper = setInterval(sweep, sweepIntervalMs);
  sweeper.unref?.();

  async function remux(source, key) {
    await mkdir(workDir, { recursive: true });
    const file = path.join(workDir, `${key}.mp4`);
    if (existsSync(file)) return file;

    const baseArgs = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      source,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-c",
      "copy",
      "-movflags",
      "+faststart"
    ];
    // hvc1 is what Safari expects for HEVC; an H.264 source rejects the tag, hence
    // the retry rather than guessing the codec up front.
    const attempts = [
      [...baseArgs, "-tag:v", "hvc1", file],
      [...baseArgs, file]
    ];
    for (const args of attempts) {
      const ok = await runFfmpeg(args);
      if (ok && existsSync(file) && statSync(file).size > 0) return file;
      await rm(file, { force: true }).catch(() => {});
    }
    throw new Error("remux-failed");
  }

  function runFfmpeg(args) {
    return new Promise((resolve) => {
      let settled = false;
      const child = spawnImpl(ffmpegPath, args, { stdio: "ignore" });
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          child.kill("SIGKILL");
        } catch {
          // already gone
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
        resolve(code === 0);
      });
    });
  }

  async function fileFor(source, key) {
    const existing = jobs.get(key);
    if (existing) {
      existing.lastUsed = now();
      return existing.promise;
    }
    const job = { lastUsed: now(), file: null, promise: null };
    job.promise = remux(source, key).then((file) => {
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

  return async function handleRemuxBridge(request, response) {
    const requestUrl = new URL(
      request.url || "/",
      `http://${request.headers?.host || "localhost"}`
    );
    if (requestUrl.pathname === HEALTH_PATH) {
      json(response, 200, { ok: true });
      return;
    }
    if (requestUrl.pathname !== STREAM_PATH) {
      json(response, 404, { ok: false, error: "unknown_path" });
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      json(response, 405, { ok: false, error: "method_not_allowed" });
      return;
    }

    const parsed = parseRemuxSource(requestUrl.searchParams.get("u"), { allowHosts });
    if (!parsed.ok) {
      json(response, 400, { ok: false, error: parsed.reason });
      return;
    }
    sweep();

    let file;
    try {
      file = await fileFor(parsed.url, parsed.key);
    } catch {
      json(response, 502, { ok: false, error: "remux-failed" });
      return;
    }

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
      createReadStream(file, range).pipe(response);
      return;
    }

    response.writeHead(200, { ...headers, "Content-Length": size });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(file).pipe(response);
  };
}

export function createRemuxBridgeServer(options = {}) {
  return createServer(createRemuxBridgeHandler(options));
}
