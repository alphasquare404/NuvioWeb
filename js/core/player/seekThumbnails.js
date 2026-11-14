import { clientMediaUrlResolver } from "../streams/clientMediaUrlResolver.js";
import { clientRemuxAssets } from "./remuxClient.js";

const FRAME_INTERVAL_SECONDS = 5;
const MAX_CACHED_FRAMES = 32;
const REQUEST_DELAY_MS = 100;
const REQUEST_TIMEOUT_MS = 8000;

export function createSeekThumbnails(url, headers, { hls = false } = {}) {
  const abort = new AbortController();
  const cache = new Map();
  let source;
  let request;
  let timer;
  let busy = false;
  let unavailable = false;

  async function loadFrame() {
    const { time } = request;
    busy = true;
    const timeout = setTimeout(() => {
      unavailable = true;
      abort.abort();
      source?.dispose();
      source = null;
    }, REQUEST_TIMEOUT_MS);
    try {
      if (!source) {
        const { assetBase } = clientRemuxAssets();
        const module = await import(new URL("decode-runtime.js", assetBase).href);
        abort.signal.throwIfAborted();
        const opened = await module.openSeekThumbnailSource({
          url,
          headers,
          hls,
          signal: abort.signal,
          resolveSource: async (signal) => {
            if (!clientMediaUrlResolver.canUseHost(url)) return null;
            const resolved = await clientMediaUrlResolver.resolve(url, {
              signal,
              skipDirect: true
            });
            return resolved.ok ? resolved.url : null;
          }
        });
        if (abort.signal.aborted) {
          opened.dispose();
          return;
        }
        source = opened;
      }
      const frame = await source.frame(time);
      if (abort.signal.aborted) return;
      cache.set(time, frame);
      if (cache.size > MAX_CACHED_FRAMES) cache.delete(cache.keys().next().value);
      if (request?.time === time) {
        request.show(frame, time);
        request = null;
      }
    } catch (_) {
      unavailable = true;
      source?.dispose();
      source = null;
    } finally {
      clearTimeout(timeout);
      busy = false;
      schedule();
    }
  }

  function schedule() {
    if (!request || abort.signal.aborted) return;
    if (cache.has(request.time)) {
      clearTimeout(timer);
      timer = null;
      const frame = cache.get(request.time);
      request.show(frame, request.time);
      request = null;
    } else if (!busy && !unavailable && !timer) {
      timer = setTimeout(() => {
        timer = null;
        void loadFrame();
      }, REQUEST_DELAY_MS);
    }
  }

  return {
    request(seconds, show) {
      const time = Math.floor(seconds / FRAME_INTERVAL_SECONDS) * FRAME_INTERVAL_SECONDS;
      if (request?.time === time) {
        request.show = show;
        return;
      }
      request = { time, show };
      schedule();
    },
    clear() {
      request = null;
      clearTimeout(timer);
      timer = null;
    },
    dispose() {
      this.clear();
      abort.abort();
      source?.dispose();
      source = null;
      cache.clear();
    }
  };
}
