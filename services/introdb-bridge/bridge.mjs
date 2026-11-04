import { createServer } from "node:http";

// Relay for IntroDB's segment endpoint.
//
// Why it exists: the upstream answers with
//   Access-Control-Allow-Origin: https://introdb.app
// so a browser on any other origin cannot read the response. The failure is
// indistinguishable from "this episode has no timestamps", which is exactly how
// skip-intro looked broken rather than blocked. Relaying the request server-side
// and answering on the app's own origin removes CORS from the path.
//
// Deliberately narrow, like the other bridges:
//  - one path, one method;
//  - only the three parameters the app sends are forwarded, so this cannot become
//    an open proxy;
//  - no Access-Control-Allow-Origin header, because the whole point is that the
//    app asks its own origin. A caller that needs CORS is a caller pointing at the
//    wrong deployment.

const DEFAULT_UPSTREAM = "https://api.introdb.app/";
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const SEGMENTS_PATH = "/api/introdb/segments";
const HEALTH_PATH = "/api/introdb/health";
const IMDB_ID = /^tt\d+$/i;

function json(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(payload));
}

function bridgeFailure(response, status = 502, error = "upstream_request_failed") {
  json(response, status, { ok: false, error });
}

function upstreamUrl(base, { imdbId, season, episode }) {
  const url = new URL("segments", base);
  url.searchParams.set("imdb_id", imdbId);
  url.searchParams.set("season", String(season));
  url.searchParams.set("episode", String(episode));
  return url.toString();
}

export function createIntrodbBridgeHandler({
  fetchImpl = globalThis.fetch,
  upstreamBase = DEFAULT_UPSTREAM,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  return async function handleIntrodbBridge(request, response) {
    if (request.method !== "GET") {
      bridgeFailure(response, 405, "method_not_allowed");
      return;
    }

    const requestUrl = new URL(
      request.url || "/",
      `http://${request.headers?.host || "localhost"}`
    );
    if (requestUrl.pathname === HEALTH_PATH) {
      json(response, 200, { ok: true });
      return;
    }
    if (requestUrl.pathname !== SEGMENTS_PATH) {
      bridgeFailure(response, 404, "unknown_path");
      return;
    }

    const imdbId = String(requestUrl.searchParams.get("imdb_id") || "").trim();
    const season = Number(requestUrl.searchParams.get("season"));
    const episode = Number(requestUrl.searchParams.get("episode"));
    if (
      !IMDB_ID.test(imdbId) ||
      !Number.isInteger(season) ||
      season <= 0 ||
      !Number.isInteger(episode) ||
      episode <= 0
    ) {
      bridgeFailure(response, 400, "invalid_request");
      return;
    }

    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let upstreamResponse;
    try {
      upstreamResponse = await fetchImpl(upstreamUrl(upstreamBase, { imdbId, season, episode }), {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller?.signal
      });
    } catch (_) {
      bridgeFailure(response, 502, "upstream_unreachable");
      return;
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (!upstreamResponse?.ok) {
      bridgeFailure(response, 502, `upstream_status_${Number(upstreamResponse?.status) || 0}`);
      return;
    }

    let body;
    try {
      body = await upstreamResponse.text();
    } catch (_) {
      bridgeFailure(response, 502, "upstream_body_unreadable");
      return;
    }
    if (body.length > MAX_RESPONSE_BYTES) {
      bridgeFailure(response, 502, "upstream_response_too_large");
      return;
    }

    // Passed through as received: the app parses the upstream shape, and rewriting
    // it here would mean two places to keep in step with IntroDB.
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(body);
  };
}

export function createIntrodbBridgeServer(options = {}) {
  return createServer(createIntrodbBridgeHandler(options));
}
