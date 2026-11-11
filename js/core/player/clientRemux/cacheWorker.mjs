/* global __NUVIO_REMUX_ASSET_ID__ */
import { remux } from "./pipeline.mjs";
import { OutputFragments, IO_BYTES } from "./mediaFragments.mjs";
import { createRangeFetcher } from "./range.mjs";
let jobId = null,
  sequence = 0,
  stats,
  options,
  legacyDir,
  cacheDir,
  uncommitted = null,
  cacheMode = false;
const replies = new Map(),
  outstanding = new Map();
let wake;
const send = (type, value = {}) => postMessage({ type, jobId, ...value, stats });
function request(type, value = {}) {
  const requestId = String(++sequence);
  const promise = new Promise((resolve) => replies.set(requestId, resolve));
  send(type, { ...value, requestId });
  return promise;
}
async function credit(all = false) {
  while (
    outstanding.size >= (all ? 1 : options.prefetch ? 2 : 1) ||
    (!all && options.prefetch && stats.lastFragmentTimestamp >= options.prefetchEnd)
  )
    await new Promise((resolve) => (wake = resolve));
}
self.onmessage = ({ data }) => {
  if (data.type === "start") {
    if (data.version !== __NUVIO_REMUX_ASSET_ID__) {
      postMessage({ type: "error", jobId: data.jobId, reason: "remux-version-mismatch" });
      return;
    }
    if (jobId !== null) return;
    jobId = data.jobId;
    void start(data);
    return;
  }
  if (data.jobId !== jobId) return;
  if (data.type === "reply" || data.type === "ack") {
    const wait = replies.get(data.requestId);
    if (wait) {
      replies.delete(data.requestId);
      wait(data.value);
    }
    if (data.unitId) {
      outstanding.delete(data.unitId);
      stats.opfsBytes = [...outstanding.values()].reduce((n, b) => n + b, 0);
    }
  }
  if (data.type === "activate") options.prefetch = false;
  wake?.();
  wake = null;
};
async function legacy(bytes, boundary) {
  const name = `chunk-${stats.chunks++}`;
  const handle = await legacyDir.getFileHandle(name, { create: true }),
    access = await handle.createSyncAccessHandle();
  try {
    if (access.write(bytes, { at: 0 }) !== bytes.length) throw Error("short-opfs-write");
    access.flush();
  } finally {
    access.close();
  }
  stats.opfsBytes = bytes.length;
  stats.peakOpfsBytes = Math.max(stats.peakOpfsBytes, bytes.length);
  await request("chunk", { file: await handle.getFile(), boundary });
  await legacyDir.removeEntry(name);
  stats.opfsBytes = 0;
}
async function store(unit) {
  const id = crypto.randomUUID(),
    entry = { id, runId: options.session, kind: unit.kind, bytes: unit.data.length };
  if (unit.kind === "media") {
    entry.seq = unit.seq;
    entry.timing = unit.timing;
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!(await request("reserve", { entry }))) throw Error("cache-capacity-unavailable");
    uncommitted = id;
    let access;
    try {
      const handle = await cacheDir.getFileHandle(`${id}.bin`, { create: true });
      access = await handle.createSyncAccessHandle();
      for (let at = 0; at < unit.data.length; at += IO_BYTES) {
        const bytes = unit.data.subarray(at, at + IO_BYTES);
        if (access.write(bytes, { at }) !== bytes.length) throw Error("short-opfs-write");
      }
      access.flush();
      access.close();
      access = null;
      uncommitted = null;
      stats.opfsBytes = unit.data.length;
      stats.peakOpfsBytes = Math.max(stats.peakOpfsBytes, unit.data.length);
      stats.chunks++;
      if (unit.kind === "media") outstanding.set(id, unit.data.length);
      send("unit", { entry });
      return;
    } catch (e) {
      access?.close();
      await cacheDir.removeEntry(`${id}.bin`).catch(() => {});
      uncommitted = null;
      await request("discard", { unitId: id });
      if (e.name !== "QuotaExceededError" || attempt === 1) throw e;
      await request("evict");
    }
  }
}
async function start(data) {
  options = data;
  stats = { opfsBytes: 0, peakOpfsBytes: 0, chunks: 0, pipelinePhase: "worker-storage" };
  const ticker = setInterval(() => send("stats"), 2000),
    splitter = new OutputFragments();
  try {
    const root = await navigator.storage.getDirectory();
    legacyDir = await (
      await root.getDirectoryHandle("nuvio-remux-staging", { create: true })
    ).getDirectoryHandle(data.session, { create: true });
    if (data.cacheSession) {
      cacheDir = await (
        await (
          await (await root.getDirectoryHandle("nuvio-remux-cache")).getDirectoryHandle("v1")
        ).getDirectoryHandle(data.cacheSession)
      ).getDirectoryHandle(data.session);
      cacheMode = true;
    }
    // Staging must actually support bounded writes; no whole-file RAM fallback.
    const probeHandle = await legacyDir.getFileHandle("probe.bin", { create: true });
    const probeAccess = await probeHandle.createSyncAccessHandle();
    try {
      if (probeAccess.write(new Uint8Array([1]), { at: 0 }) !== 1)
        throw Error("staging-write-failed");
      probeAccess.flush();
    } finally {
      probeAccess.close();
    }
    await legacyDir.removeEntry("probe.bin");
    send("capabilities", {
      workerCapabilities: {
        opfs: true,
        syncAccessHandle:
          typeof FileSystemFileHandle.prototype.createSyncAccessHandle === "function"
      }
    });
    const fetchRange = createRangeFetcher(
      data.url,
      data.requestHeaders,
      data.hostMediaHeadAvailable
        ? async (url, requestOptions) => {
            try {
              return await fetch(url, requestOptions);
            } catch (error) {
              if (
                requestOptions.method !== "HEAD" ||
                error?.name !== "TypeError" ||
                requestOptions.signal?.aborted
              )
                throw error;
              const length = await request("resolve-media-head", { url });
              requestOptions.signal?.throwIfAborted();
              if (!length) throw error;
              stats.rangeHostHeadUsed = true;
              return new Response(null, { status: 200, headers: { "Content-Length": length } });
            }
          }
        : fetch,
      data.hostResolveAvailable
        ? async () => {
            stats.hostResolveAttempted = true;
            const url = await request("resolve-source");
            stats.hostResolveSucceeded = Boolean(url);
            return url;
          }
        : undefined
    );
    await remux({
      url: data.url,
      start: data.start,
      audioIndex: data.audioIndex,
      expectedAudio: data.expectedAudio,
      transcode: data.transcode,
      signal: new AbortController().signal,
      stats,
      fetcher: fetchRange,
      metadata: (info) => request("metadata", { info }),
      supportsOutput: (output) => request("supports-output", { output }),
      beforeEncode: () => request("transcode-credit"),
      beforePacket: async () => {
        if (cacheMode) await credit();
      },
      write: legacy,
      ...(cacheMode
        ? {
            writeOutput: async (bytes, _timing) => {
              // Keep splitting after a cache failure: an init or earlier media unit in
              // this same muxer write may already have been appended. Replay only the
              // failed unit through staging, with its complete init (including ftyp).
              for (const unit of splitter.split(bytes)) {
                if (cacheMode) {
                  try {
                    await store(unit);
                    continue;
                  } catch (e) {
                    send("cache-failed", {
                      reason:
                        e.name === "QuotaExceededError" ? "quota-exceeded" : "cache-write-failed"
                    });
                    if (options.prefetch) throw Error("cache-prefetch-unavailable");
                    cacheMode = false;
                  }
                }
                for (let at = 0; at < unit.data.length; at += IO_BYTES)
                  await legacy(unit.data.subarray(at, at + IO_BYTES), {
                    writeBytes: unit.data.length,
                    first: at === 0,
                    last: at + IO_BYTES >= unit.data.length,
                    randomAccessPoints: unit.timing?.randomAccessPoints || [],
                    randomAccessGuardSeconds: unit.timing?.reorderGuardSeconds || 0
                  });
              }
            }
          }
        : {})
    });
    send("sealed-end");
    if (cacheMode) await credit(true);
    send("done");
  } catch (error) {
    if (error.message === "client-transcode-software-video-decode-failed") {
      stats.softwareVideoStage = error.softwareVideoStage;
      stats.softwareVideoCode = error.softwareVideoCode;
    }
    send("error", { reason: /^[a-z0-9-]+$/.test(error.message) ? error.message : error.name });
  } finally {
    clearInterval(ticker);
    if (cacheDir && uncommitted) await cacheDir.removeEntry(`${uncommitted}.bin`).catch(() => {});
  }
}
