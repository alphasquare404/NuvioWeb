import { createHash } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { validateHeaderValue } from "node:http";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { parseHttpsPlaybackUrl } from "./addonPlaybackPolicy.mjs";
import { checkedAddressLookup, resolvePublicAddresses } from "./publicAddonRedirect.mjs";

const MAX_RESPONSE = 1024 * 1024;
const MAX_REQUEST = 2 * MAX_RESPONSE;
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const REQUEST_HEADERS = new Set([
  "accept",
  "accept-language",
  "authorization",
  "content-type",
  "cookie",
  "origin",
  "range",
  "referer",
  "user-agent",
  "x-requested-with"
]);
const REDIRECT_HEADERS = new Set(["accept", "accept-language", "user-agent"]);
const RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "content-encoding",
  "location",
  "set-cookie"
];
const DECODERS = { gzip: createGunzip, deflate: createInflate, br: createBrotliDecompress };

function failure(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function json(response, status, data) {
  if (response.destroyed) return;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(data));
}

async function readRequest(request) {
  if (Number(request.headers["content-length"]) > MAX_REQUEST) {
    throw failure(413, "request_too_large");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > MAX_REQUEST) throw failure(413, "request_too_large");
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks, size));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw failure(400, "invalid_request");
  }
}

function requestOptions(data) {
  const method = data.method || "GET";
  if (!METHODS.has(method)) throw failure(400, "unsupported_method");
  const headers = { "accept-encoding": "identity" };
  for (const [rawName, value] of Object.entries(data.headers || {})) {
    const name = rawName.toLowerCase();
    if (!REQUEST_HEADERS.has(name) || typeof value !== "string" || value.length > 8192) continue;
    try {
      validateHeaderValue(name, value);
      headers[name] = value;
    } catch {
      throw failure(400, "invalid_header");
    }
  }
  let body;
  if (!["GET", "HEAD"].includes(method)) {
    if (data.bodyKind === "base64") {
      if (typeof data.bodyBase64 !== "string" || !/^[a-z0-9+/]*={0,2}$/i.test(data.bodyBase64)) {
        throw failure(400, "invalid_body");
      }
      body = Buffer.from(data.bodyBase64, "base64");
    } else if (data.bodyKind === "text" && typeof data.body === "string") {
      body = Buffer.from(data.body);
    } else if (data.bodyKind && data.bodyKind !== "none") {
      throw failure(400, "invalid_body");
    }
  }
  if (body?.length > MAX_RESPONSE) throw failure(413, "request_too_large");
  if (body) headers["content-length"] = body.length;
  return { method, headers, body };
}

function openProviderResponse(url, addresses, signal, options) {
  return new Promise((resolve, reject) => {
    const upstream = httpsRequest(
      url,
      {
        method: options.method,
        headers: options.headers,
        agent: false,
        lookup: checkedAddressLookup(addresses),
        signal
      },
      resolve
    );
    upstream.once("error", reject);
    upstream.end(options.body);
  });
}

async function readProviderBody(upstream, signal) {
  const encoding = String(upstream.headers["content-encoding"] || "identity").toLowerCase();
  const createDecoder = Object.hasOwn(DECODERS, encoding) ? DECODERS[encoding] : null;
  if (encoding !== "identity" && !createDecoder) throw failure(502, "unsupported_encoding");
  const decoder = createDecoder?.();
  const stopDecoder = (error) => decoder?.destroy(error);
  if (decoder) upstream.once("error", stopDecoder);
  const stream = decoder ? upstream.pipe(decoder) : upstream;
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      signal.throwIfAborted();
      const part = chunk.subarray(0, MAX_RESPONSE - size);
      chunks.push(part);
      size += part.length;
      if (part.length < chunk.length) {
        return { bytes: Buffer.concat(chunks, size), truncated: true };
      }
    }
    return { bytes: Buffer.concat(chunks, size), truncated: false };
  } finally {
    if (decoder) {
      upstream.removeListener("error", stopDecoder);
      decoder.destroy();
    }
  }
}

async function fetchProvider(data, appHostname, { lookup, openResponse }, signal) {
  let rawUrl = data.url;
  let options = requestOptions(data);
  const metadataOnly = data.metadataOnly === true;
  if (metadataOnly) {
    options = {
      method: "GET",
      headers: { ...options.headers, range: "bytes=0-0" }
    };
    delete options.headers["content-length"];
  }
  for (let hop = 0; hop <= 4; hop++) {
    const url = parseHttpsPlaybackUrl(rawUrl);
    if (!url || url.hostname === appHostname) throw failure(403, "destination_not_public");
    const addresses = await resolvePublicAddresses(url, lookup, signal);
    const upstream = await openResponse(url, addresses, signal, options);
    try {
      const status = upstream.statusCode;
      const location = upstream.headers.location;
      if (REDIRECTS.has(status) && location) {
        if (hop === 4) throw failure(502, "too_many_redirects");
        const target = new URL(location, url);
        const switchToGet =
          (status === 303 && options.method !== "HEAD") ||
          ([301, 302].includes(status) && options.method === "POST");
        if (target.origin !== url.origin) {
          if (options.body && !switchToGet) {
            throw failure(403, "cross_origin_body_redirect");
          }
          const headers = Object.fromEntries(
            Object.entries(options.headers).filter(([name]) => REDIRECT_HEADERS.has(name))
          );
          options = { ...options, headers: { ...headers, "accept-encoding": "identity" } };
        }
        if (switchToGet) {
          const headers = { ...options.headers };
          delete headers["content-length"];
          delete headers["content-type"];
          options = { method: "GET", headers };
        }
        rawUrl = target.href;
        continue;
      }
      if (metadataOnly) {
        const range = /^bytes 0-0\/(\d+)$/.exec(upstream.headers["content-range"] || "");
        const size = Number(range?.[1]);
        const encoding = upstream.headers["content-encoding"];
        if (
          status !== 206 ||
          !Number.isSafeInteger(size) ||
          size <= 0 ||
          (encoding && encoding.toLowerCase() !== "identity")
        ) {
          throw failure(502, "media_size_unavailable");
        }
        return { url: url.href, size };
      }
      const { bytes, truncated } =
        options.method === "HEAD" || status === 204 || status === 304
          ? { bytes: Buffer.alloc(0), truncated: false }
          : await readProviderBody(upstream, signal);
      const headers = {};
      for (const name of RESPONSE_HEADERS) {
        if (upstream.headers[name] != null) headers[name] = String(upstream.headers[name]);
      }
      return {
        returnValue: true,
        ok: status >= 200 && status < 300,
        status,
        statusText: upstream.statusMessage || "",
        url: url.href,
        headers,
        body: bytes.toString("utf8"),
        ...(data.responseEncoding === "base64" ? { bodyBase64: bytes.toString("base64") } : {}),
        truncated
      };
    } finally {
      upstream.destroy();
    }
  }
}

function createSessionVerifier({ supabaseUrl, anonKey, authFetch }) {
  if (!supabaseUrl || !anonKey) return null;
  let userUrl;
  try {
    userUrl = new URL("/auth/v1/user", supabaseUrl);
    if (userUrl.protocol !== "https:") return null;
  } catch {
    return null;
  }
  const cache = new Map();
  return async (token) => {
    const key = createHash("sha256").update(token).digest("base64url");
    const existing = cache.get(key);
    if (existing?.expires > Date.now()) return existing.result;
    const entry = { expires: Date.now() + 30_000 };
    entry.result = (async () => {
      try {
        const response = await authFetch(userUrl, {
          headers: { apikey: anonKey, Authorization: "Bearer " + token },
          redirect: "error",
          signal: AbortSignal.timeout(4000)
        });
        if (!response.ok) {
          await response.body?.cancel();
          return null;
        }
        const user = await response.json();
        return typeof user?.id === "string" && !user.is_anonymous ? user.id : null;
      } catch {
        cache.delete(key);
        return null;
      }
    })();
    cache.set(key, entry);
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return entry.result;
  };
}

export function createPluginFetchHandler({
  supabaseUrl = process.env.NUVIO_SUPABASE_URL,
  anonKey = process.env.NUVIO_SUPABASE_ANON_KEY,
  authFetch = fetch,
  lookup,
  openResponse = openProviderResponse
} = {}) {
  const verifySession = createSessionVerifier({ supabaseUrl, anonKey, authFetch });
  let active = 0;
  const users = new Map();
  return async (request, response) => {
    if (request.method !== "POST") return json(response, 405, { error: "method_not_allowed" });
    if (!verifySession) return json(response, 503, { error: "plugin_relay_unavailable" });
    let appHostname;
    try {
      const app = new URL("https://" + request.headers.host);
      const origin = request.headers.origin;
      if (
        !request.headers.host ||
        (origin && new URL(origin).host !== app.host) ||
        (request.headers["sec-fetch-site"] && request.headers["sec-fetch-site"] !== "same-origin")
      ) {
        throw new Error();
      }
      appHostname = app.hostname;
    } catch {
      return json(response, 403, { error: "same_origin_required" });
    }
    const token = /^Bearer ([a-z0-9_.-]{1,8192})$/i.exec(request.headers.authorization || "")?.[1];
    if (!token) return json(response, 401, { error: "session_required" });
    if (active >= 40) return json(response, 429, { error: "plugin_relay_busy" });
    active++;
    let quota;
    const controller = new AbortController();
    const onClose = () => controller.abort();
    response.once("close", onClose);
    try {
      const userId = await verifySession(token);
      if (!userId) return json(response, 401, { error: "session_required" });
      const now = Date.now();
      for (const [id, entry] of users) {
        if (!entry.active && entry.expires <= now) users.delete(id);
      }
      const entry = users.get(userId) || { active: 0, used: 0, expires: now + 60_000 };
      if (entry.expires <= now) Object.assign(entry, { used: 0, expires: now + 60_000 });
      if (entry.active >= 12 || entry.used >= 240) {
        return json(response, 429, { error: "plugin_relay_rate_limit" });
      }
      quota = entry;
      users.set(userId, quota);
      quota.active++;
      quota.used++;
      request.setTimeout(10_000, () => request.destroy());
      const data = await readRequest(request);
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(18_000)]);
      const result = await fetchProvider(data, appHostname, { lookup, openResponse }, signal);
      return json(response, 200, result);
    } catch (error) {
      const status = error.statusCode || (error.name === "TimeoutError" ? 504 : 502);
      return json(response, status, {
        error: error.statusCode ? error.message : "provider_request_failed"
      });
    } finally {
      response.off("close", onClose);
      active--;
      if (quota) quota.active--;
    }
  };
}
