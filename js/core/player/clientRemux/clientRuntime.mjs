import { attachRemuxMediaSources } from "./airplaySource.mjs";
import {
  BufferBudget,
  playbackBufferLimits,
  shouldThrottleAhead,
  isManagedBufferBlocked
} from "./bufferBudget.mjs";
import { createNativeSeekRecovery, isTimeBuffered } from "./nativeSeekRecovery.mjs";
import { OpfsCache, removeOwned } from "./opfsCache.mjs";
import { IO_BYTES } from "./mediaFragments.mjs";
import { createStartupPlayback } from "./startupPlayback.mjs";
import { clientRemuxFailureFacts, runStartupStep } from "./startupFailure.mjs";
import { createEmbeddedSubtitles } from "./embeddedSubtitles.mjs";
import { holdStaging, cleanOrphanStaging } from "./stagingLease.mjs";
export function createClientRemux({
  video,
  assetBase,
  version,
  cacheMaxMiB = 512,
  transcode = false,
  requestHeaders = {},
  expectedAudio = null,
  canResolveSource = () => false,
  resolveSource = async () => null,
  resolveMediaHead,
  onStatus = () => {},
  onError = () => {},
  onTracks = () => {},
  onCues = () => {}
}) {
  const Source = globalThis.ManagedMediaSource || globalThis.MediaSource;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const capabilities = {
    secureContext: globalThis.isSecureContext,
    opfs: !!navigator.storage?.getDirectory
  };
  let film = null,
    session = null,
    producer = null,
    intent = 0,
    control = Promise.resolve(),
    latest = {},
    position = 0,
    logicalDuration = 0,
    audioIndex = 0,
    desiredPaused = false,
    desiredRate = 1,
    disposed = false;
  const subtitles = createEmbeddedSubtitles({
    video,
    assetBase,
    version,
    requestHeaders,
    onTracks,
    onCues,
    onStatus,
    getTime: () => (isRestoring() ? session?.target || position : video.currentTime)
  });
  function isRestoring() {
    try {
      return (
        !session ||
        !session.sb ||
        (session.media.readyState !== "open" && session.media.readyState !== "ended") ||
        !session.seekApplied ||
        !session.startup?.ready ||
        !session.sb.buffered.length
      );
    } catch {
      return true;
    }
  }
  function render() {
    if (session && !isRestoring()) {
      position = Math.max(0, video.currentTime);
      desiredRate = video.playbackRate;
    }
    if (latest.duration > 0) logicalDuration = latest.duration;
    onStatus(snapshot());
  }
  function snapshot() {
    let bufferStart = null,
      bufferEnd = null;
    try {
      if (video.buffered.length) {
        bufferStart = video.buffered.start(0);
        bufferEnd = video.buffered.end(video.buffered.length - 1);
      }
    } catch {}
    return {
      bufferStart,
      bufferEnd,
      ...latest,
      ...film?.cache.stats(),
      processing: transcode === "audio" ? "audio-transcode" : transcode ? "transcode" : "remux",
      outputContainer: latest.mime ? "fmp4" : "",
      position: isRestoring() ? position : Math.max(0, video.currentTime),
      duration: logicalDuration,
      restoring: isRestoring(),
      audioIndex,
      audioTracks: film?.audioTracks || [],
      subtitle: subtitles.snapshot()
    };
  }
  function fail(reason) {
    latest.state = "error";
    latest.reason = /^[a-z0-9-]+$/.test(reason) ? reason : "playback-error";
    render();
    onError(latest.reason);
  }
  function logFailure(phase, error) {
    const facts = clientRemuxFailureFacts(phase, error, latest, video);
    const detail = JSON.stringify({
      ...facts,
      conversion: transcode === "audio" ? "audio" : transcode ? "full" : "copy"
    });
    console.warn("[ClientRemux] failure", detail);
    if (globalThis.__NUVIO_PLAYBACK_STARTUP_DEBUG__ === true) {
      void fetch("/api/debug/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "media-worker",
          message: facts.reason,
          stack: detail,
          at: new Date().toISOString()
        })
      }).catch(() => {});
    }
  }
  async function clean(name) {
    if (!name) return;
    const root = await navigator.storage.getDirectory();
    const owned = await root.getDirectoryHandle("nuvio-remux-staging", { create: true });
    await removeOwned(owned, name);
  }
  function queue(fn) {
    const p = control.then(fn);
    control = p.catch(() => {});
    return p;
  }
  function active(s) {
    return session === s && s.intent === intent;
  }
  function observe(job, stats) {
    if (!film || job.owner !== film || !stats) return;
    film.sourceBytes += Math.max(0, (stats.bytes || 0) - job.lastBytes);
    job.lastBytes = stats.bytes || 0;
    job.stats = { ...job.stats, ...stats };
    if (session?.runId === job.id)
      latest = { ...latest, ...stats, targetSourceBytes: stats.bytes || 0 };
    else latest.prefetchSourceBytes = stats.bytes || 0;
  }
  function reply(job, data, value) {
    if (producer === job)
      job.worker.postMessage({ type: "reply", jobId: job.id, requestId: data.requestId, value });
  }
  function ack(job, data) {
    if (producer === job)
      job.worker.postMessage({
        type: "ack",
        jobId: job.id,
        requestId: data.requestId,
        unitId: data.entry?.id
      });
  }
  async function abortProducer() {
    const old = producer;
    producer = null;
    if (!old) return;
    old.resolveAbort.abort();
    old.worker.terminate();
    await old.owner.cache.finishRun(old.id);
    try {
      await clean(old.id);
    } finally {
      old.lease?.release();
      await old.lease?.finished?.();
    }
  }
  function detachRenderer() {
    const old = session;
    if (!old) return;
    if (!isRestoring()) position = Math.max(0, video.currentTime);
    session = null;
    old?.seekRecovery.dispose();
    old?.startup.dispose();
    video.pause();
    old.releaseMediaSources?.();
    video.removeAttribute("src");
    video.load();
    if (old?.objectUrl) URL.revokeObjectURL(old.objectUrl);
  }
  async function releasePlayback() {
    detachRenderer();
    await abortProducer();
  }
  async function closeFilm() {
    subtitles.dispose();
    await releasePlayback();
    const old = film;
    film = null;
    if (old) {
      latest.totalSourceBytesReported = old.sourceBytes;
      latest.cacheReplayBytes = old.replayBytes;
      await old.cache.close();
    }
    latest = {
      ...latest,
      state: "stopped",
      opfsBytes: 0,
      rangeRequestsInFlight: 0,
      currentRangeStartedAt: null,
      cacheBytes: 0,
      cacheReservedBytes: 0,
      cleaned: true
    };
    render();
  }
  function stop() {
    ++intent;
    session?.cancelOpen?.();
    return queue(closeFilm);
  }
  function update(sb, action) {
    return new Promise((resolve, reject) => {
      const done = () => {
          sb.removeEventListener("error", bad);
          resolve();
        },
        bad = () => {
          sb.removeEventListener("updateend", done);
          reject(Error("sourcebuffer-error"));
        };
      sb.addEventListener("updateend", done, { once: true });
      sb.addEventListener("error", bad, { once: true });
      try {
        action();
      } catch (e) {
        sb.removeEventListener("error", bad);
        sb.removeEventListener("updateend", done);
        reject(e);
      }
    });
  }
  async function renderer(
    target,
    {
      autoplay = true,
      playbackRate = 1,
      reason = "manual",
      seekPath = "network",
      nativeSeekRecoveries = 0,
      runId
    } = {}
  ) {
    subtitles.seek(target);
    const began = performance.now(),
      media = new Source(),
      s = {
        media,
        runId,
        target,
        began,
        intent,
        objectUrl: URL.createObjectURL(media),
        seekApplied: false,
        managedAllowed: !globalThis.ManagedMediaSource,
        managedSignalSeen: false,
        budget: new BufferBudget({
          ...playbackBufferLimits(globalThis.navigator?.deviceMemory),
          requireRandomAccessPoints: true
        }),
        sb: null,
        autoplay,
        playbackRate
      };
    session = s;
    s.seekRecovery = createNativeSeekRecovery({
      video,
      autoplay,
      isActive: () => active(s) && !!s.sb && s.seekApplied,
      recover: ({ time, autoplay, rate }) =>
        void seekTo(time, {
          autoplay,
          playbackRate: rate,
          nativeSeekRecoveries: nativeSeekRecoveries + 1,
          reason: "native-seekbar"
        }).catch((e) => fail(e.message))
    });
    s.startup = createStartupPlayback({
      video,
      target,
      isActive: () => active(s),
      wantsPlay: () => !desiredPaused,
      noteSeek: (time) => {
        s.seekApplied = true;
        s.seekRecovery.noteInternalSeek(time);
        latest.targetBufferedMs ??= Math.round(performance.now() - s.began);
      },
      onPhase: (phase, window) => {
        latest.startupPhase = phase;
        if (window) {
          latest.startupBufferedAheadSeconds = window.ahead;
          latest.startupRequiredAheadSeconds = window.required;
        }
      },
      onBlocked: (error) => {
        if (error?.name !== "NotAllowedError") return;
        latest.autoplayBlocked = true;
        render();
      }
    });
    media.addEventListener("startstreaming", () => {
      if (active(s)) {
        s.managedSignalSeen = true;
        s.managedAllowed = true;
        latest.managedStreaming = true;
      }
    });
    media.addEventListener("endstreaming", () => {
      if (active(s)) {
        s.managedSignalSeen = true;
        s.managedAllowed = false;
        latest.managedStreaming = false;
      }
    });
    latest = {
      state: "opening",
      requested: target,
      seekPath,
      targetSourceBytes: 0,
      sourceRestartReason: reason,
      nativeSeekRecoveries,
      sessionInitMs: 0
    };
    render();
    const opened = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("sourceopen-timeout")), 10000);
      s.cancelOpen = () => {
        clearTimeout(timer);
        resolve();
      };
      media.addEventListener(
        "sourceopen",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
    });
    s.releaseMediaSources = attachRemuxMediaSources(video, s.objectUrl, film?.sourceUrl);
    video.load();
    video.playbackRate = playbackRate;
    await opened;
    if (!active(s)) return null;
    latest.sourceOpenMs = Math.round(performance.now() - began);
    return s;
  }
  function metadata(s, info) {
    if (!active(s)) return;
    const outputMimeSupported = Source.isTypeSupported(info.mime);
    latest = { ...latest, ...info, outputMimeSupported, requested: s.target, state: "remuxing" };
    if (!outputMimeSupported) throw Error("output-codecs-unsupported");
    if (film) {
      film.audioTracks = (info.audioTracks || []).map((track) => ({
        ...track,
        supported:
          track.supported &&
          (Boolean(transcode) || Boolean(track.mime && Source.isTypeSupported(track.mime)))
      }));
      onTracks();
    }
    s.sb = s.media.addSourceBuffer(info.mime);
    if (info.timestampOffset) s.sb.timestampOffset = info.timestampOffset;
    s.media.duration = info.duration;
  }
  function ahead() {
    for (let i = 0; i < video.buffered.length; i++)
      if (
        video.currentTime >= video.buffered.start(i) &&
        video.currentTime <= video.buffered.end(i)
      )
        return video.buffered.end(i) - video.currentTime;
    return 0;
  }
  async function trimBufferedBehind(s, cutoff) {
    const sb = s.sb;
    const cut = s.budget.trimPoint(cutoff);
    if (sb.buffered.length && sb.buffered.start(0) < cut) {
      latest.lastRemovalDependencyEnd = s.budget.removalDependencyEnd(cut);
      latest.removalCurrentTime = video.currentTime;
      await update(sb, () => sb.remove(0, cut));
      if (!active(s)) return;
      latest.lastRemovalEnd = cut;
      latest.bufferStartAfterRemoval = sb.buffered.length ? sb.buffered.start(0) : null;
    }
    s.budget.forgetBefore(cut);
  }

  async function appendBytes(s, bytes) {
    const sb = s.sb;
    let retryUntil = 0;
    while (active(s)) {
      try {
        await update(sb, () => sb.appendBuffer(bytes));
        return;
      } catch (error) {
        const bufferedAhead = ahead();
        if (error?.name !== "QuotaExceededError" || !s.seekApplied || bufferedAhead <= 4) {
          throw error;
        }
        if (!retryUntil) {
          // The browser can have a lower quota than our compressed-byte cap.
          // Leave headroom in subsequent appends and retry only unaccepted bytes.
          s.quotaAheadSeconds = Math.min(
            s.quotaAheadSeconds ?? Infinity,
            Math.max(4, bufferedAhead - 4)
          );
          retryUntil = performance.now() + 5000;
        } else if (performance.now() >= retryUntil) {
          throw error;
        }
        await trimBufferedBehind(s, video.currentTime - 0.25);
        while (active(s) && video.paused && !video.ended) {
          await sleep(100);
          retryUntil = performance.now() + 5000;
        }
        await sleep(100);
      }
    }
  }

  async function appendFile(s, file, boundary) {
    const sb = s.sb;
    if (!sb || !active(s)) return;
    if (boundary.first) {
      s.budget.noteRandomAccessPoints(
        boundary.randomAccessPoints || [],
        boundary.randomAccessGuardSeconds || 0
      );
      while (active(s)) {
        const { trimBefore } = s.budget.plan(boundary.writeBytes, video.currentTime);
        await trimBufferedBehind(s, trimBefore);
        if (!active(s)) return;
        const plan = s.budget.plan(boundary.writeBytes, video.currentTime);
        latest.compressedByteBudget = s.budget.limitBytes;
        latest.maxCompressedByteBudget = s.budget.maxBytes;
        latest.videoRemovalGuardSeconds = s.budget.reorderGuardSeconds;
        const managedBlocked = isManagedBufferBlocked({
            signalSeen: s.managedSignalSeen,
            allowed: s.managedAllowed,
            seekApplied: s.seekApplied,
            hasBufferedData: sb.buffered.length > 0
          }),
          seekBlocked = s.seekRecovery.pending;
        const bufferedAhead = ahead();
        latest.bufferedAheadSeconds = bufferedAhead;
        const timeBlocked = shouldThrottleAhead({
          aheadSeconds: bufferedAhead,
          readyState: video.readyState,
          paused: video.paused,
          limitSeconds: s.quotaAheadSeconds
        });
        if (!plan.bytePressure && !timeBlocked && !managedBlocked && !seekBlocked) break;
        if (plan.bytePressure && !s.seekApplied)
          throw Error("startup-window-exceeds-buffer-budget");
        if (plan.bytePressure && !video.paused && video.readyState < 3 && !seekBlocked)
          throw Error("decoder-not-ready-within-buffer-budget");
        if (plan.bytePressure && bufferedAhead <= 0 && !video.paused && !seekBlocked)
          throw Error("buffer-budget-cannot-progress");
        latest.state = "backpressure";
        latest.backpressureReason = seekBlocked
          ? "native-seek"
          : plan.bytePressure
            ? "bytes"
            : managedBlocked
              ? "managed"
              : "time";
        if (plan.bytePressure) latest.byteBudgetWaits = (latest.byteBudgetWaits || 0) + 1;
        maybePrefetch(s);
        await sleep(100);
      }
      if (!active(s)) return;
      s.budget.reserve(boundary.writeBytes);
    }
    for (let at = 0; at < file.size && active(s); at += IO_BYTES) {
      const bytes = await file.slice(at, at + IO_BYTES).arrayBuffer();
      if (!active(s)) return;
      await appendBytes(s, bytes);
      if (!active(s)) return;
      latest.firstAppendMs ??= Math.round(performance.now() - s.began);
      const end = sb.buffered.length ? sb.buffered.end(sb.buffered.length - 1) : 0;
      s.budget.append(bytes.byteLength, end, boundary.last && at + IO_BYTES >= file.size);
      latest.retainedCompressedBytes = s.budget.heldBytes;
      latest.reservedCompressedBytes = s.budget.reservedBytes;
      latest.peakRetainedCompressedBytes = Math.max(
        latest.peakRetainedCompressedBytes || 0,
        s.budget.heldBytes
      );
      if (s.seekApplied && sb.buffered.length) {
        video.playbackRate = desiredRate;
        if (desiredPaused) video.pause();
      }
      latest.state = "remuxing";
    }
    // A range may expose audio samples before the complete muxer unit has landed.
    // Apply the initial position only at its final OPFS/MSE boundary, then play
    // after the browser has settled that seek. Do not await it in the producer queue.
    s.startup.completeBoundary(boundary.last);
    if (s.startup.ready) latest.state = "playing";
    render();
  }
  async function appendEntry(s, entry) {
    const owner = film;
    if (!owner || !owner.cache.pin(entry.id)) throw Error("cache-file-missing");
    try {
      const file = await owner.cache.file(entry);
      if (!active(s)) return;
      await appendFile(s, file, {
        writeBytes: file.size,
        first: true,
        last: true,
        randomAccessPoints: entry.timing?.randomAccessPoints || [],
        randomAccessGuardSeconds: entry.timing?.reorderGuardSeconds || 0
      });
      if (s.replay) owner.replayBytes += file.size;
    } finally {
      owner.cache.unpin(entry.id);
    }
  }
  function delivery(job, fn) {
    job.delivery = job.delivery.then(fn).catch(async (e) => {
      if (producer === job) {
        if (job.prefetch) {
          job.failed = true;
          latest.prefetchFailed = true;
          await abortProducer();
        } else {
          logFailure("output-append", e);
          await stop();
          fail(e.message);
        }
      }
    });
  }
  async function launchProducer(start, { prefetch = false, frontier = start } = {}) {
    if (!film) return null;
    const owner = film,
      expectedIntent = intent,
      id = crypto.randomUUID(),
      cached = !transcode && (await runStartupStep("cache-run", () => owner.cache.createRun(id)));
    if (film !== owner || expectedIntent !== intent || producer) {
      await owner.cache.finishRun(id);
      return null;
    }
    const lease = await runStartupStep("staging-lock", () => holdStaging(id));
    if (film !== owner || expectedIntent !== intent || producer) {
      lease.release();
      await owner.cache.finishRun(id);
      return null;
    }
    let worker;
    try {
      worker = await runStartupStep(
        "media-worker",
        () => new Worker(new URL("cache-worker.js", assetBase), { type: "module" })
      );
    } catch (error) {
      lease.release();
      await lease.finished();
      await owner.cache.finishRun(id);
      throw error;
    }
    const job = {
      id,
      owner,
      worker,
      lease,
      resolveAbort: new AbortController(),
      prefetch,
      info: null,
      init: null,
      units: [],
      stats: {},
      lastBytes: 0,
      delivery: Promise.resolve(),
      failed: false
    };
    producer = job;
    if (!prefetch && session) session.runId = id;
    worker.onmessage = ({ data }) => {
      if (producer !== job || data.jobId !== id) return;
      observe(job, data.stats);
      let phase = "producer";
      void (async () => {
        if (data.type === "resolve-source") {
          const resolved = await resolveSource(owner.sourceUrl, job.resolveAbort.signal);
          reply(job, data, resolved);
        } else if (data.type === "resolve-media-head") {
          const sameOrigin = new URL(data.url).origin === new URL(owner.sourceUrl).origin;
          const size = await resolveMediaHead?.(
            data.url,
            sameOrigin ? requestHeaders : {},
            job.resolveAbort.signal
          );
          reply(job, data, size);
        } else if (data.type === "supports-output") {
          const { mime, audio } = data.output;
          let supported = Source.isTypeSupported(mime);
          if (supported && audio?.channels > 2) {
            try {
              const answer = await Promise.race([
                navigator.mediaCapabilities?.decodingInfo({ type: "media-source", audio }),
                sleep(750)
              ]);
              supported = answer?.supported === true;
            } catch {
              supported = false;
            }
          }
          reply(job, data, supported);
        } else if (data.type === "transcode-credit") {
          while (
            producer === job &&
            session?.runId === id &&
            shouldThrottleAhead({
              aheadSeconds: ahead(),
              readyState: video.readyState,
              paused: video.paused,
              limitSeconds: Math.min(session.quotaAheadSeconds ?? Infinity, video.paused ? 12 : 24)
            })
          )
            await sleep(100);
          reply(job, data, true);
        } else if (data.type === "reserve") {
          const accepted = await owner.cache.reserve(data.entry);
          if (producer !== job) {
            if (accepted) await owner.cache.discard(data.entry.id);
            return;
          }
          reply(job, data, accepted);
        } else if (data.type === "discard") {
          await owner.cache.discard(data.unitId);
          reply(job, data, true);
        } else if (data.type === "evict") {
          await owner.cache.evictUnpinned();
          reply(job, data, true);
        } else if (data.type === "metadata") {
          phase = "output-setup";
          if (owner.size != null && owner.size !== data.stats.size) throw Error("source-changed");
          owner.size = data.stats.size;
          job.info = data.info;
          owner.cache.setInfo(id, data.info);
          if (!prefetch && session?.runId === id) metadata(session, data.info);
          reply(job, data, true);
        } else if (data.type === "capabilities") {
          latest.workerCapabilities = data.workerCapabilities;
        } else if (data.type === "unit") {
          const entry = await owner.cache.commit(data.entry.id);
          if (producer !== job) return;
          if (entry.kind === "init") {
            job.init = entry;
            if (job.prefetch) ack(job, data);
            else
              delivery(job, async () => {
                if (session?.runId === id) await appendEntry(session, entry);
                ack(job, data);
              });
          } else if (job.prefetch) {
            job.units.push({ entry, data });
          } else
            delivery(job, async () => {
              try {
                if (session?.runId === id) await appendEntry(session, entry);
              } finally {
                owner.cache.unpin(entry.id);
              }
              ack(job, data);
            });
        } else if (data.type === "chunk") {
          if (job.prefetch) throw Error("cache-prefetch-unavailable");
          delivery(job, async () => {
            if (session?.runId === id) await appendFile(session, data.file, data.boundary);
            ack(job, data);
          });
        } else if (data.type === "cache-failed") {
          owner.cache.disable(data.reason);
          latest.cacheWriteFailure = data.reason;
        } else if (data.type === "sealed-end") {
          job.eof = true;
          owner.cache.eof(id);
        } else if (data.type === "done") {
          delivery(job, async () => {
            if (session?.runId === id) {
              latest.state = "remux-complete";
              if (session.media.readyState === "open") session.media.endOfStream();
              render();
            }
          });
        } else if (data.type === "error") throw Error(data.reason);
        render();
      })().catch(async (e) => {
        if (producer !== job) return;
        if (job.prefetch) {
          job.failed = true;
          latest.prefetchFailed = true;
          await abortProducer();
        } else {
          logFailure(phase, e);
          await stop();
          fail(e.message);
        }
      });
    };
    worker.onerror = () => {
      if (producer !== job) return;
      logFailure("media-worker", Error("worker-error"));
      void stop().then(() => fail("worker-error"));
    };
    worker.postMessage({
      type: "start",
      requestHeaders,
      expectedAudio,
      transcode,
      hostResolveAvailable: canResolveSource(owner.sourceUrl),
      hostMediaHeadAvailable: typeof resolveMediaHead === "function",
      version,
      audioIndex,
      jobId: id,
      url: owner.sourceUrl,
      start,
      session: id,
      cacheSession: cached ? owner.cache.id : null,
      prefetch,
      prefetchEnd: frontier + 20
    });
    return job;
  }
  function maybePrefetch(s) {
    if (
      !active(s) ||
      !s.replay ||
      !s.seekApplied ||
      s.prefetchStarting ||
      producer ||
      s.eof ||
      s.replayEnd - video.currentTime > 20 ||
      video.paused
    )
      return;
    s.prefetchStarting = true;
    void launchProducer(s.replayEnd, { prefetch: true, frontier: s.replayEnd })
      .catch(() => {
        latest.prefetchFailed = true;
      })
      .finally(() => (s.prefetchStarting = false));
  }
  async function replay(s, hit) {
    const owner = film;
    s.replay = true;
    s.replayEnd = hit.end;
    s.eof = hit.init.eof && hit.end >= latest.duration - 0.1;
    try {
      await appendEntry(s, hit.init);
      for (let i = 0; i < hit.units.length && active(s); i++) {
        const next = hit.units[i + 1];
        if (next) owner.cache.pin(next.id);
        try {
          await appendEntry(s, hit.units[i]);
        } finally {
          if (next) owner.cache.unpin(next.id);
        }
        maybePrefetch(s);
      }
      if (!active(s)) return;
      if (s.eof) {
        latest.state = "remux-complete";
        s.media.endOfStream();
        return;
      }
      while (active(s) && video.currentTime < s.replayEnd - 0.12) {
        maybePrefetch(s);
        if (video.readyState < 3 && ahead() < 0.25) break;
        await sleep(100);
      }
      if (!active(s)) return;
      const target = s.replayEnd,
        options = {
          autoplay: !video.paused,
          playbackRate: video.playbackRate,
          reason: "cache-frontier",
          seekPath: "network"
        };
      await queue(async () => {
        if (!active(s)) return;
        let job = producer;
        if (job?.prefetch && job.info && job.init && job.units.length) {
          detachRenderer();
          const next = await renderer(target, { ...options, runId: job.id });
          if (!next) return;
          metadata(next, job.info);
          job.prefetch = false;
          job.worker.postMessage({ type: "activate", jobId: job.id });
          delivery(job, () => appendEntry(next, job.init));
          for (const item of job.units.splice(0))
            delivery(job, async () => {
              try {
                await appendEntry(next, item.entry);
              } finally {
                owner.cache.unpin(item.entry.id);
              }
              ack(job, item.data);
            });
          latest.cacheTransitions = owner.transitions = owner.transitions + 1;
        } else {
          await releasePlayback();
          const next = await renderer(target, options);
          if (next) await launchProducer(target);
          latest.cacheTransitions = owner.transitions = owner.transitions + 1;
        }
      });
    } catch (_e) {
      if (active(s)) {
        latest.cacheMissReason = "file-unavailable";
        await owner.cache.invalidateRun(hit.runId);
        await begin(s.target, owner.sourceUrl, {
          autoplay: s.autoplay,
          playbackRate: s.playbackRate,
          reason: "cache-read-fallback"
        });
      }
    }
  }
  function begin(
    start = 0,
    overrideUrl,
    { autoplay = true, playbackRate = video.playbackRate, newFilm = false, ...opts } = {}
  ) {
    desiredPaused = !autoplay;
    desiredRate = playbackRate;
    const targetIntent = ++intent,
      sourceUrl = new URL(overrideUrl, location.href).href;
    return queue(async () => {
      if (targetIntent !== intent) return;
      if (disposed) return;
      if (
        !capabilities.secureContext ||
        !Source ||
        !capabilities.opfs ||
        typeof Worker !== "function"
      )
        throw Error("required-browser-api-unavailable");
      if (!["http:", "https:"].includes(new URL(sourceUrl).protocol))
        throw Error("http-source-required");
      await runStartupStep("release-playback", releasePlayback);
      if (!film || film.sourceUrl !== sourceUrl || newFilm) {
        const old = film;
        film = null;
        if (old) await runStartupStep("cache-close", () => old.cache.close());
        await runStartupStep("storage-cleanup", cleanOrphanStaging);
        const cache = await runStartupStep("cache-open", () =>
          OpfsCache.open(undefined, undefined, cacheMaxMiB * 1024 * 1024)
        );
        if (targetIntent !== intent) {
          await cache.close();
          return;
        }
        film = { sourceUrl, cache, size: null, sourceBytes: 0, replayBytes: 0, transitions: 0 };
        if (!old || old.sourceUrl !== sourceUrl)
          await runStartupStep("subtitle-worker", () => subtitles.setSource(sourceUrl));
      }
      if (targetIntent !== intent) return;
      const s = await runStartupStep("renderer-open", () =>
        renderer(start, { autoplay, playbackRate, ...opts })
      );
      if (s) await runStartupStep("producer-start", () => launchProducer(start));
    });
  }
  async function seekTo(
    time,
    { autoplay = !desiredPaused, playbackRate = desiredRate, ...opts } = {}
  ) {
    desiredPaused = !autoplay;
    desiredRate = playbackRate;
    const owner = film;
    if (!owner || !Number.isFinite(time)) return;
    const duration = Number(latest.duration),
      target = Math.max(0, Math.min(duration > 0 ? duration - 0.05 : Infinity, time));
    if (session && active(session) && session.startup.ready && isTimeBuffered(video, target)) {
      subtitles.seek(target);
      session.seekRecovery.noteInternalSeek(target);
      latest.seekPath = "buffer";
      latest.requested = target;
      video.currentTime = target;
      video.playbackRate = desiredRate = playbackRate;
      if (autoplay && !desiredPaused) await video.play();
      else video.pause();
      render();
      return;
    }
    const request = ++intent;
    session?.cancelOpen?.();
    return queue(async () => {
      if (request !== intent || film !== owner) return;
      await releasePlayback();
      const hit = owner.cache.lookup(target);
      const s = await renderer(target, {
        autoplay,
        playbackRate,
        ...opts,
        reason: opts.reason || "seek",
        seekPath: hit ? "opfs" : "network",
        runId: hit?.runId
      });
      if (!s) return;
      if (hit) {
        latest.cacheHits = owner.hits = (owner.hits || 0) + 1;
        metadata(s, hit.init.info);
        void replay(s, hit);
      } else {
        latest.cacheMissReason = "not-cached";
        await launchProducer(target);
      }
    });
  }

  const errorHandler = (event) => {
    if (event.detail) return; // Controller reports must not recursively become native failures.
    if (session) {
      logFailure("native-media", Error("client-media-error"));
      void stop()
        .then(() => fail("client-media-error"))
        .catch(() => fail("client-cleanup-failed"));
    }
  };
  const playHandler = () => {
    desiredPaused = false;
  };
  const pauseHandler = () => {
    if (!isRestoring()) desiredPaused = true;
  };
  video.addEventListener("play", playHandler);
  video.addEventListener("pause", pauseHandler);
  video.addEventListener("error", errorHandler);
  return {
    start({ url, start = 0, audioIndex: index = 0, autoplay = true, playbackRate = 1 }) {
      audioIndex = index;
      position = start;
      return begin(start, url, { autoplay, playbackRate, newFilm: true });
    },
    seek: seekTo,
    snapshot,
    pause() {
      desiredPaused = true;
      video.pause();
    },
    resume() {
      desiredPaused = false;
      // A resume during loading records intent; it must not start an empty source.
      if (session && !session.startup.ready) return Promise.resolve();
      latest.autoplayBlocked = false;
      const current = session;
      const result = video.play();
      result?.catch((error) => {
        if (disposed || current !== session || error?.name !== "NotAllowedError") return;
        latest.autoplayBlocked = true;
        render();
      });
      return result;
    },
    setRate(rate) {
      desiredRate = rate;
      video.playbackRate = rate;
    },
    async selectAudio(index) {
      if (!Number.isInteger(index) || !film?.audioTracks[index]?.supported) return false;
      if (index === audioIndex) return true;
      const url = film.sourceUrl,
        time = isRestoring() ? position : video.currentTime;
      audioIndex = index;
      await begin(time, url, {
        autoplay: !desiredPaused,
        playbackRate: desiredRate,
        newFilm: true,
        reason: "audio-change"
      });
      return true;
    },
    getSubtitleTracks: () => subtitles.tracks(),
    selectSubtitle: (id) => subtitles.select(id),
    setSubtitleDelay: (delay) => subtitles.setDelay(delay),
    async dispose() {
      if (disposed) return;
      disposed = true;
      video.removeEventListener("play", playHandler);
      video.removeEventListener("pause", pauseHandler);
      video.removeEventListener("error", errorHandler);
      subtitles.destroy();
      await stop();
    }
  };
}
