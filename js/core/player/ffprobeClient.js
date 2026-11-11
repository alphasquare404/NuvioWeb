import { probeSourceId } from "./probeDiagnostics.js";
import { createProbeRangeReader } from "./probeRangeReader.js";
import { resolveMediaHead } from "./mediaHeadResolver.js";
import { normalizeClientProbeConcurrency } from "./probeMode.js";

function debugProbe(event, facts) {
  if (globalThis.__NUVIO_CLIENT_PROBE_DEBUG__ !== true) return;
  // Callers supply only fixed stage names and file facts, never URLs/errors/tokens.
  console.warn("[ClientProbe] " + JSON.stringify({ event, ...facts }));
}

// Each runner owns one WASM instance; the page-wide pool bounds parallel work.
// No SharedArrayBuffer, proxy, server fallback, or full-video download.
export function createBrowserProbeRunner({
  fetchImpl = globalThis.fetch,
  onEvent = debugProbe,
  urlResolver,
  makeWorker = () => {
    const url = new URL("./assets/libs/ffprobe/ffprobe-worker.js", document.baseURI);
    url.searchParams.set(
      "v",
      typeof __NUVIO_BUILD_STAMP__ === "undefined" ? "dev" : __NUVIO_BUILD_STAMP__
    );
    return new Worker(url);
  }
} = {}) {
  let worker = null,
    warm = false,
    queue = Promise.resolve(),
    nextId = 0,
    idleTimer = null;
  function stop() {
    clearTimeout(idleTimer);
    worker?.terminate();
    worker = null;
    warm = false;
  }
  return {
    get warm() {
      return warm;
    },
    probe(
      url,
      {
        timeoutMs = 15000,
        resolveTimeoutMs = 0,
        initializationTimeoutMs = 20000,
        allowHostHead = false,
        signal,
        onFailure
      } = {}
    ) {
      const id = ++nextId;
      const submittedAt = Date.now();
      const resolveBudget = Math.max(0, Math.min(15000, Number(resolveTimeoutMs) || 0));
      // Callers can reserve time for cold initialization separately from media reads.
      const initializationBudget = resolveBudget
        ? Math.max(1, Math.min(30000, Number(initializationTimeoutMs) || 20000))
        : 0;
      const preparationDeadline = submittedAt + Math.max(1, timeoutMs) + resolveBudget;
      const deadline = preparationDeadline + initializationBudget;
      const report = (event, facts = {}) => {
        try {
          onEvent(event, { id, sourceId: probeSourceId(url), ...facts });
        } catch {
          /* Diagnostics cannot break probing. */
        }
      };
      report("queued", {
        timeoutMs,
        ...(resolveBudget
          ? { resolveTimeoutMs: resolveBudget, initializationTimeoutMs: initializationBudget }
          : {})
      });
      const task = queue.then(async () => {
        if (signal?.aborted) return null;
        const queuedMs = Date.now() - submittedAt;
        const remaining = preparationDeadline - Date.now();
        if (remaining <= 0) {
          report("failure", { reason: "queue-timeout", queuedMs, stage: "queue" });
          return null;
        }
        clearTimeout(idleTimer);
        const controller = new AbortController();
        let finish;
        const answer = new Promise((resolve) => {
          finish = resolve;
        });
        let settled = false,
          started = false;
        let stage = "source-range-or-head",
          lastStage = "",
          reader,
          ranges = 0,
          initializationStartedAt = null,
          initializationMs = 0,
          probeDeadline = preparationDeadline;
        report("start", { queuedMs });
        const done = (result, fatal = false, reason = "") => {
          if (settled) return;
          settled = true;
          if (!result) onFailure?.(reason || "metadata-unavailable");
          if (result) warm = true;
          report(result ? "success" : "failure", {
            stage,
            reason,
            queuedMs,
            elapsedMs: Date.now() - submittedAt,
            workerStarted: started,
            initializationMs:
              initializationStartedAt == null
                ? initializationMs
                : Date.now() - initializationStartedAt,
            ranges,
            mediaBytes: reader?.bytesRead || 0,
            fileBytes: reader?.size || 0,
            sourceResponse: reader?.diagnostics || null,
            ...(result
              ? { container: result.container, video: result.videoCodec, audio: result.audioCodec }
              : {})
          });
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          controller.abort();
          if (worker) {
            worker.onmessage = null;
            worker.onerror = null;
          }
          if (fatal && started) stop();
          else if (worker) {
            idleTimer = setTimeout(stop, 30000);
            idleTimer.unref?.();
          }
          finish(result);
        };
        const onAbort = () => done(null, true, "cancelled");
        let timer = Number.isFinite(remaining)
          ? setTimeout(() => done(null, true, "timeout"), remaining)
          : null;
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) {
          onAbort();
          return answer;
        }
        const arm = (at, reason = "timeout") => {
          clearTimeout(timer);
          const delay = Math.min(at, deadline) - Date.now();
          timer = Number.isFinite(delay)
            ? setTimeout(() => done(null, true, reason), Math.max(1, delay))
            : null;
        };
        try {
          reader = createProbeRangeReader(url, {
            fetchImpl,
            signal: controller.signal,
            resolveHead: allowHostHead ? resolveMediaHead : undefined,
            ...(urlResolver ? { urlResolver } : {})
          });
          if (resolveBudget) {
            await reader.prepare();
            if (settled) return answer;
            probeDeadline = Math.min(deadline, Date.now() + timeoutMs);
            arm(probeDeadline);
          }
          const chunk = await reader.read(0);
          ranges++;
          if (settled) return answer;
          stage = "worker-start";
          if (!warm && initializationBudget) {
            initializationStartedAt = Date.now();
            arm(initializationStartedAt + initializationBudget, "wasm-initialization-timeout");
          }
          worker ||= makeWorker();
          started = true;
          worker.onerror = () => done(null, true, "worker-error");
          worker.onmessage = async (event) => {
            const message = event.data;
            if (settled || message.id !== id) return;
            if (message.type === "stage") {
              if (!["worker-script", "wasm-loading", "metadata"].includes(message.stage)) return;
              stage = message.stage;
              if (stage === "metadata") {
                warm = true;
                if (initializationStartedAt != null) {
                  initializationMs = Date.now() - initializationStartedAt;
                  initializationStartedAt = null;
                  probeDeadline = Math.min(deadline, probeDeadline + initializationMs);
                  arm(probeDeadline);
                }
              }
              if (lastStage !== stage)
                report("stage", { stage, elapsedMs: Date.now() - submittedAt });
              lastStage = stage;
              return;
            }
            if (message.type === "result") {
              done(message.result);
              return;
            }
            if (message.type !== "range") {
              const failure = [
                "CompileError",
                "LinkError",
                "RuntimeError",
                "TypeError",
                "Error"
              ].includes(message.failure)
                ? message.failure
                : "worker-result-error";
              done(null, true, failure);
              return;
            }
            stage = "media-range";
            let part;
            try {
              part = await reader.read(message.position);
              ranges++;
            } catch (error) {
              if (settled) return;
              // ffprobe already returned and is waiting for bytes. A source or
              // byte-budget failure does not invalidate the initialized core.
              try {
                worker.postMessage({ id, type: "release" });
              } catch {
                done(null, true, "worker-message-failed");
                return;
              }
              done(
                null,
                false,
                /^probe-[a-z-]+$/.test(error?.message || "") ? error.message : "range-fetch-failed"
              );
              return;
            }
            try {
              if (!settled)
                worker.postMessage({ id, type: "chunk", chunk: part }, [part.bytes.buffer]);
            } catch {
              done(null, true, "worker-message-failed");
            }
          };
          worker.postMessage({ id, type: "start", size: reader.size, chunk }, [chunk.bytes.buffer]);
        } catch (error) {
          done(
            null,
            true,
            /^probe-[a-z-]+$/.test(error?.message || "") ? error.message : "source-or-worker-failed"
          );
        }
        return answer;
      });
      queue = task.catch(() => null);
      return queue;
    }
  };
}
export function createBrowserProbePool({ concurrency = 1, ...options } = {}) {
  const count = normalizeClientProbeConcurrency(concurrency);
  const onEvent = options.onEvent || debugProbe;
  let firstResultReady = false;
  const slots = Array.from({ length: count }, (_, index) => ({
    pending: 0,
    runner: createBrowserProbeRunner({
      ...options,
      onEvent: (event, facts) => onEvent(event, { ...facts, slot: index + 1, concurrency: count })
    })
  }));
  const canParallel = () => firstResultReady && slots.some((slot) => slot.runner.warm);
  return {
    get parallelReady() {
      return count > 1 && canParallel();
    },
    probe(url, requestOptions) {
      if (!slots.some((slot) => slot.runner.warm)) firstResultReady = false;
      // Publish a first result before two cold WASM instances compete.
      const available = canParallel() ? slots : slots.slice(0, 1);
      const slot = available.reduce((best, candidate) =>
        candidate.pending < best.pending ? candidate : best
      );
      slot.pending++;
      return slot.runner
        .probe(url, requestOptions)
        .then((result) => {
          if (result) firstResultReady = true;
          return result;
        })
        .finally(() => {
          slot.pending--;
        });
    }
  };
}

let sharedRunner;
export function isBrowserProbeParallelReady() {
  return sharedRunner?.parallelReady === true;
}
export function probeInBrowser(url, options) {
  if (
    typeof Worker === "undefined" ||
    typeof WebAssembly === "undefined" ||
    typeof AbortController === "undefined"
  ) {
    debugProbe("unsupported", {
      worker: typeof Worker !== "undefined",
      wasm: typeof WebAssembly !== "undefined",
      abort: typeof AbortController !== "undefined"
    });
    return Promise.resolve(null);
  }
  sharedRunner ||= createBrowserProbePool({ concurrency: options?.concurrency });
  return sharedRunner.probe(url, options);
}
