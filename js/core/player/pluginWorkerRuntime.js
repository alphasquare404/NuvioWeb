import { registerAccountRuntimeResetHandler } from "../auth/accountLocalDataReset.js";
import { emitPluginDiagnostic } from "../diagnostics/pluginDiagnostics.js";
import { fetchPluginRequest } from "./pluginFetch.js";
import { randomPluginUuid } from "./pluginModels.js";

/* global __NUVIO_PLUGIN_WORKER_PATH__ */
export const PLUGIN_LIMITS = Object.freeze({
  maxConcurrent: 10,
  maxManifestBytes: 5 * 1024 * 1024,
  maxCodeBytes: 5 * 1024 * 1024,
  maxFetchBytes: 1024 * 1024,
  maxCacheBytes: 16 * 1024 * 1024,
  maxResults: 150,
  maxResultsPerScraper: 150,
  providerTimeoutMs: 60_000,
  globalTimeoutMs: 120_000,
  maxDocuments: 8,
  maxDomElements: 10_000,
  memoryLimitBytes: 64 * 1024 * 1024
});

const executions = new Set();
let runtimeCheck;

export function executePlugin({
  code,
  filename,
  scraperId,
  settings = {},
  args,
  signal,
  onRequestFailure
} = {}) {
  if (signal?.aborted) return Promise.reject(signal.reason);
  const path =
    typeof __NUVIO_PLUGIN_WORKER_PATH__ === "string"
      ? __NUVIO_PLUGIN_WORKER_PATH__
      : "assets/runtime/plugin-worker.js";
  const worker = new Worker(new URL(path, document.baseURI));
  const network = new Map();
  return new Promise((resolve, reject) => {
    const finish = (error, results) => {
      if (!executions.delete(cancel)) return;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      for (const request of network.values()) request.abort();
      worker.terminate();
      if (error) reject(error);
      else resolve(results);
    };
    const cancel = () => finish(new DOMException("Plugin execution cancelled", "AbortError"));
    executions.add(cancel);
    const timeoutMs = PLUGIN_LIMITS.providerTimeoutMs;
    const timer = setTimeout(() => finish(new Error("Plugin execution timed out")), timeoutMs);
    signal?.addEventListener("abort", cancel, { once: true });
    worker.onerror = (event) => finish(new Error(event.message || "Plugin worker failed"));
    worker.onmessage = async ({ data }) => {
      if (data.type === "result") return finish(null, data.results);
      if (data.type === "error") return finish(new Error(data.error || "Plugin execution failed"));
      if (data.type === "cancel") return network.get(data.requestId)?.abort();
      if (data.type === "pluginLog") {
        emitPluginDiagnostic(data.level === "error" ? "error" : "warn", "plugin scraper", {
          scraperId,
          message: data.message
        });
        return;
      }
      if (data.type !== "fetch" || network.has(data.requestId)) return;
      const request = new AbortController();
      network.set(data.requestId, request);
      let payload;
      try {
        payload = await fetchPluginRequest({
          ...data.payload,
          signal: request.signal,
          maxResponseBytes: PLUGIN_LIMITS.maxFetchBytes
        });
      } catch (error) {
        payload = {
          returnValue: true,
          ok: false,
          status: 0,
          statusText: error.message || "Fetch failed",
          url: String(data.payload?.url || ""),
          body: "",
          headers: {}
        };
      } finally {
        network.delete(data.requestId);
      }
      if (executions.has(cancel)) {
        worker.postMessage({ type: "fetchResult", requestId: data.requestId, payload });
        if (onRequestFailure && !request.signal.aborted && (!payload.ok || payload.truncated)) {
          let host = "";
          try {
            host = new URL(payload.url).hostname;
          } catch {
            // Invalid destinations have no hostname to report.
          }
          onRequestFailure({
            host,
            status: payload.status,
            truncated: Boolean(payload.truncated)
          });
        }
      }
    };
    try {
      worker.postMessage({
        type: "execute",
        executionId: randomPluginUuid(),
        code,
        filename,
        scraperId,
        settings,
        args,
        quota: PLUGIN_LIMITS,
        timeoutMs,
        deadline: Date.now() + timeoutMs
      });
    } catch (error) {
      finish(error);
    }
  });
}

export function ensurePluginRuntime() {
  runtimeCheck ??= Promise.resolve()
    .then(() =>
      executePlugin({
        code: "module.exports.getStreams = function(){ return []; };",
        filename: "self-test.js",
        args: { tmdbId: "0", mediaType: "movie" }
      })
    )
    .catch((error) => {
      runtimeCheck = undefined;
      throw error;
    });
  return runtimeCheck;
}

registerAccountRuntimeResetHandler(() => {
  for (const cancel of executions) cancel();
});
