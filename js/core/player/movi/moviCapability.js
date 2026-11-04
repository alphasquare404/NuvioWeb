// Can this browser run the movi engine, and can it read the source at all?
//
// Both questions are asked BEFORE the player route opens: the first decides
// whether the engine is even offered, the second turns a dead link into a
// sentence instead of a black screen. Keeping them here — plain functions with
// injectable dependencies — is what lets the answers be tested without a DOM.

export const MOVI_ENGINE = "movi";
export const NATIVE_ENGINE = "native";
export const SOURCE_UNREACHABLE = "source-unreachable";

/** movi decodes through WebCodecs; without it the element has no engine. */
export function hasWebCodecs(scope = globalThis) {
  return typeof scope?.VideoDecoder === "function";
}

/**
 * Which engine should render this playback?
 *
 * The stored preference is the whole answer for a capable device, and no answer
 * at all for one that cannot decode: a profile that picked movi on an iPhone and
 * then opened the app on an older browser must not be sent to a route that can
 * never paint a frame.
 */
export function shouldUseMovi(settings, { webCodecs = hasWebCodecs() } = {}) {
  if (!webCodecs) return false;
  return (
    String(settings?.playerEngine || "")
      .trim()
      .toLowerCase() === MOVI_ENGINE
  );
}

/**
 * Should a request for the player route be answered by the movi engine instead?
 *
 * The player route has six doorways — stream picker, detail page twice, next
 * episode, library, and anything added later — so this rule is stated once, in a
 * function, rather than remembered by each caller. Only an http(s) source
 * qualifies: an offline blob has no CORS to satisfy and belongs to the player
 * that already owns it.
 */
export function shouldRoutePlayerToMovi(
  params = {},
  settings = null,
  { webCodecs = hasWebCodecs() } = {}
) {
  const source = String(params?.streamUrl || "");
  // A downloaded file arrives as a blob: URL, and that is the one case where movi
  // needs no permission from anyone: the bytes are already local, so there is no
  // CORS to satisfy and no host to ask. It is also where movi earns its keep — a
  // downloaded MKV or AV1 is exactly what the built-in player cannot open.
  const offline = /^blob:/i.test(source) || params?.offlineDownload != null;
  if (!offline && !/^https?:/i.test(source)) return false;
  return shouldUseMovi(settings, { webCodecs });
}

/**
 * One byte of the source, before the engine is mounted.
 *
 * This is what separates "the host will not let a page read it" from "the
 * player could not decode it": movi reads bytes through fetch, so a source
 * without `Access-Control-Allow-Origin` fails here and would otherwise fail as
 * an unexplained black screen. The Range header keeps it to a single byte and
 * also proves the host answers ranges, which seeking depends on.
 */
export async function preflightSource(
  url,
  { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}
) {
  if (typeof url !== "string" || !url.trim()) {
    return { ok: false, code: SOURCE_UNREACHABLE, reason: "empty-source" };
  }
  if (typeof fetchImpl !== "function") {
    return { ok: false, code: SOURCE_UNREACHABLE, reason: "no-fetch" };
  }

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      mode: "cors",
      headers: { Range: "bytes=0-1" },
      signal: controller?.signal
    });
    const status = Number(response?.status || 0);
    if (!response?.ok && status !== 206) {
      return { ok: false, code: SOURCE_UNREACHABLE, reason: "http", status };
    }
    return {
      ok: true,
      status,
      contentType: String(response?.headers?.get?.("content-type") || ""),
      crossOrigin: String(response?.headers?.get?.("access-control-allow-origin") || "")
    };
  } catch (error) {
    // A cross-origin read without ACAO lands here: fetch rejects rather than
    // handing back a body a demuxer could read.
    return {
      ok: false,
      code: SOURCE_UNREACHABLE,
      reason: "network",
      message: String(error?.message || error)
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
