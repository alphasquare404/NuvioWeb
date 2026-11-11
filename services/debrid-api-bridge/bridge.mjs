import { createPluginFetchHandler } from "./pluginFetch.mjs";
import { createServer } from "node:http";
import { parseHttpsPlaybackUrl } from "./addonPlaybackPolicy.mjs";
import { requestPublicAddonHeaders, resolvePublicAddonRedirect } from "./publicAddonRedirect.mjs";

const PROVIDERS = Object.freeze({
  torbox: "https://api.torbox.app",
  premiumize: "https://www.premiumize.me"
});
const MAX_BODY_BYTES = 8 * 1024;
const MAX_UPSTREAM_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

function json(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(payload));
}

function bridgeFailure(response, status = 502, error = "provider_request_failed") {
  json(response, Math.max(400, Math.min(599, Number(status) || 502)), {
    ok: false,
    error,
    status: Math.max(0, Math.trunc(Number(status) || 0))
  });
}

function readJsonBody(request, { allowEmpty = false } = {}) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let rejected = false;
    const chunks = [];
    request.on("data", (chunk) => {
      if (rejected) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejected = true;
        reject(Object.assign(new Error("Request body too large"), { statusCode: 413 }));
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (rejected) return;
      if (!chunks.length && allowEmpty) return resolve({});
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new Error("Request body must be a JSON object");
        }
        resolve(value);
      } catch (error) {
        reject(Object.assign(error, { statusCode: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function bearerCredential(request) {
  const value = String(request.headers.authorization || "").trim();
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1]?.trim() || "";
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizedStringArray(value, limit = 100) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) =>
      String(entry || "")
        .trim()
        .toLowerCase()
    )
    .filter(Boolean)
    .slice(0, limit);
}

async function readUpstreamJson(response) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_UPSTREAM_RESPONSE_BYTES) {
    throw Object.assign(new Error("Provider response too large"), { statusCode: 502 });
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_UPSTREAM_RESPONSE_BYTES) {
      throw Object.assign(new Error("Provider response too large"), { statusCode: 502 });
    }
    return text ? JSON.parse(text) : {};
  }
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_UPSTREAM_RESPONSE_BYTES) {
        await reader.cancel();
        throw Object.assign(new Error("Provider response too large"), { statusCode: 502 });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks));
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

async function providerRequest(fetchImpl, url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...options,
      redirect: "manual",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.headers || {})
      }
    });
    if (response.status >= 300 && response.status < 400) {
      return { status: 502, data: {}, redirectRejected: true };
    }
    return { status: response.status, data: await readUpstreamJson(response) };
  } finally {
    clearTimeout(timeout);
  }
}

function torboxStartPayload(data = {}) {
  const source = data?.data || {};
  return {
    success: data?.success !== false,
    data: {
      device_code: String(source.device_code || ""),
      code: String(source.code || ""),
      verification_url: String(source.verification_url || ""),
      friendly_verification_url: String(source.friendly_verification_url || ""),
      interval: source.interval ?? null,
      expires_at: source.expires_at ?? null
    }
  };
}

function premiumizeStartPayload(data = {}) {
  return {
    device_code: String(data.device_code || ""),
    user_code: String(data.user_code || ""),
    verification_uri: String(data.verification_uri || ""),
    verification_uri_complete: String(data.verification_uri_complete || ""),
    interval: data.interval ?? null,
    expires_in: data.expires_in ?? null
  };
}

function tokenPayload(providerId, data = {}) {
  const token = providerId === "torbox" ? data?.data?.access_token : data?.access_token;
  return providerId === "torbox"
    ? { success: data?.success !== false, data: { access_token: String(token || "") } }
    : { access_token: String(token || "") };
}

function torboxRedeemFailure(data, status) {
  const detail = `${String(data?.error || "")} ${String(data?.detail || "")}`.toLowerCase();
  if (status === 410 || detail.includes("expired")) return "authorization_expired";
  if (detail.includes("denied") || detail.includes("cancelled") || detail.includes("canceled")) {
    return "authorization_denied";
  }
  if (detail.includes("invalid") || detail.includes("malformed")) {
    return "provider_request_failed";
  }
  // TorBox documents a 400/success:false response while a valid device code
  // awaits user approval. Do not translate that normal polling state to failure.
  if (status === 400 && data?.success === false) return "authorization_pending";
  if ([404, 409, 425].includes(status)) return "authorization_pending";
  return "provider_request_failed";
}

function deviceFailure(providerId, data, status) {
  if (providerId === "torbox") return torboxRedeemFailure(data, status);
  if (status === 410) return "authorization_expired";
  if (providerId === "premiumize" && status === 400) return "authorization_pending";
  return "provider_request_failed";
}

async function handleDeviceStart(providerId, response, fetchImpl, body, timeoutMs) {
  if (providerId === "torbox") {
    const result = await providerRequest(
      fetchImpl,
      `${PROVIDERS.torbox}/v1/api/user/auth/device/start?app=Nuvio`,
      {},
      timeoutMs
    );
    if (result.status < 200 || result.status >= 300 || result.data?.success === false) {
      return bridgeFailure(response, result.status);
    }
    json(response, 200, torboxStartPayload(result.data));
    return;
  }

  if (!nonEmptyString(body.clientId)) {
    return bridgeFailure(response, 400, "missing_public_client_id");
  }
  const form = new URLSearchParams({
    response_type: "device_code",
    client_id: body.clientId.trim()
  });
  const result = await providerRequest(
    fetchImpl,
    `${PROVIDERS.premiumize}/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: form.toString()
    },
    timeoutMs
  );
  if (result.status < 200 || result.status >= 300 || result.data?.error) {
    return bridgeFailure(response, result.status);
  }
  json(response, 200, premiumizeStartPayload(result.data));
}

async function handleDeviceRedeem(providerId, response, fetchImpl, body, timeoutMs) {
  if (!nonEmptyString(body.deviceCode)) {
    return bridgeFailure(response, 400, "missing_device_code");
  }
  let result;
  if (providerId === "torbox") {
    result = await providerRequest(
      fetchImpl,
      `${PROVIDERS.torbox}/v1/api/user/auth/device/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_code: body.deviceCode.trim() })
      },
      timeoutMs
    );
  } else {
    if (!nonEmptyString(body.clientId)) {
      return bridgeFailure(response, 400, "missing_public_client_id");
    }
    const form = new URLSearchParams({
      grant_type: "device_code",
      code: body.deviceCode.trim(),
      client_id: body.clientId.trim()
    });
    result = await providerRequest(
      fetchImpl,
      `${PROVIDERS.premiumize}/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: form.toString()
      },
      timeoutMs
    );
  }
  const token =
    providerId === "torbox" ? result.data?.data?.access_token : result.data?.access_token;
  if (result.status >= 200 && result.status < 300 && token) {
    json(response, 200, tokenPayload(providerId, result.data));
    return;
  }
  bridgeFailure(response, result.status, deviceFailure(providerId, result.data, result.status));
}

async function handleAccount(providerId, request, response, fetchImpl, timeoutMs) {
  const credential = bearerCredential(request);
  if (!credential) {
    return bridgeFailure(response, 401, "missing_provider_credential");
  }
  const path = providerId === "torbox" ? "/v1/api/user/me" : "/api/account/info";
  const result = await providerRequest(
    fetchImpl,
    `${PROVIDERS[providerId]}${path}`,
    {
      headers: { Authorization: `Bearer ${credential}` }
    },
    timeoutMs
  );
  if (
    result.status < 200 ||
    result.status >= 300 ||
    String(result.data?.status || "").toLowerCase() === "error"
  ) {
    return bridgeFailure(response, result.status);
  }
  json(response, 200, { ok: true });
}

async function resolveTorrentioTorboxUrl(credential, body, fetchImpl, timeoutMs) {
  let stage = "addon",
    upstreamStatus = 0;
  const failure = (reason) => ({ resolveStage: stage, upstreamStatus, resolveReason: reason });
  if (
    !/^[a-f0-9]{40}$/i.test(String(body.infoHash || "")) ||
    !Number.isSafeInteger(body.fileIdx) ||
    body.fileIdx < 0 ||
    !nonEmptyString(body.entry) ||
    !nonEmptyString(body.filename)
  )
    return failure("invalid-descriptor");
  const parts = [credential, body.infoHash, body.entry, body.fileIdx, body.filename].map((part) =>
    encodeURIComponent(String(part))
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const reply = await fetchImpl("https://torrentio.strem.fun/resolve/torbox/" + parts.join("/"), {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal
    });
    upstreamStatus = reply.status;
    const location = reply.headers.get("location");
    await reply.body?.cancel();
    if (![301, 302, 303, 307, 308].includes(reply.status) || !location)
      return failure("missing-redirect");
    const target = new URL(location);
    if (
      target.protocol !== "https:" ||
      target.host !== "api.torbox.app" ||
      target.username ||
      target.password ||
      target.pathname !== "/v1/api/torrents/requestdl" ||
      target.searchParams.get("token") !== credential
    )
      return failure("untrusted-redirect");
    const torrentId = target.searchParams.get("torrent_id"),
      fileId = target.searchParams.get("file_id");
    if (!/^\d+$/.test(torrentId || "") || !/^\d+$/.test(fileId || ""))
      return failure("invalid-file-id");
    // Keep the addon's exact signed/provider request. Only follow this one
    // validated TorBox hop; return its CDN Location without requesting media.
    stage = "provider";
    upstreamStatus = 0;
    const provider = await fetchImpl(target.href, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal
    });
    upstreamStatus = provider.status;
    const cdnLocation = provider.headers.get("location");
    await provider.body?.cancel();
    if (![301, 302, 303, 307, 308].includes(provider.status) || !cdnLocation)
      return failure("missing-redirect");
    const cdn = new URL(cdnLocation);
    if (cdn.protocol !== "https:" || cdn.username || cdn.password || cdn.host === "api.torbox.app")
      return failure("untrusted-redirect");
    return { url: cdn.href };
  } catch {
    return failure(controller.signal.aborted ? "timeout" : "network-or-invalid-redirect");
  } finally {
    clearTimeout(timeout);
  }
}

async function handleTorboxPlaybackAction(action, request, response, fetchImpl, body, timeoutMs) {
  const credential = bearerCredential(request);
  if (!credential) {
    return bridgeFailure(response, 401, "missing_provider_credential");
  }

  let endpoint = "";
  let options = { method: "POST", headers: { Authorization: `Bearer ${credential}` } };
  if (action === "cache/check") {
    const hashes = normalizedStringArray(body.hashes);
    if (!hashes.length) return bridgeFailure(response, 400, "missing_hashes");
    endpoint = `${PROVIDERS.torbox}/v1/api/torrents/checkcached?format=object`;
    options = {
      ...options,
      headers: { ...options.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ hashes })
    };
  } else if (action === "torrent/create") {
    if (!nonEmptyString(body.magnet)) return bridgeFailure(response, 400, "missing_magnet");
    const form = new FormData();
    form.set("magnet", body.magnet.trim());
    form.set("add_only_if_cached", "true");
    form.set("allow_zip", "false");
    endpoint = `${PROVIDERS.torbox}/v1/api/torrents/createtorrent`;
    options = { ...options, body: form };
  } else if (action === "torrent/lookup") {
    if (!nonEmptyString(body.torrentId)) return bridgeFailure(response, 400, "missing_torrent_id");
    const query = new URLSearchParams({ id: body.torrentId.trim(), bypass_cache: "true" });
    endpoint = `${PROVIDERS.torbox}/v1/api/torrents/mylist?${query.toString()}`;
    options = { ...options, method: "GET" };
  } else if (action === "link/from-addon") {
    const result = await resolveTorrentioTorboxUrl(credential, body, fetchImpl, timeoutMs);
    if (!result.url) {
      json(response, 502, { ok: false, error: "addon_resolve_failed", ...result });
      return;
    }
    json(response, 200, { success: true, data: result.url });
    return;
  } else if (action === "link/resolve") {
    if (!nonEmptyString(body.torrentId)) return bridgeFailure(response, 400, "missing_torrent_id");
    const query = new URLSearchParams({
      token: credential,
      torrent_id: body.torrentId.trim(),
      zip_link: "false",
      redirect: "false",
      append_name: "false"
    });
    if (body.fileId != null && String(body.fileId).trim())
      query.set("file_id", String(body.fileId).trim());
    endpoint = `${PROVIDERS.torbox}/v1/api/torrents/requestdl?${query.toString()}`;
    options = { ...options, method: "GET" };
  } else {
    return bridgeFailure(response, 404, "not_found");
  }

  const result = await providerRequest(fetchImpl, endpoint, options, timeoutMs);
  if (result.status < 200 || result.status >= 300 || result.data?.success === false) {
    return bridgeFailure(response, result.status);
  }
  // These are the existing DebridApi result envelopes consumed by cache and resolver code.
  json(response, 200, result.data);
}

export function createDebridApiBridgeHandler({
  fetchImpl = fetch,
  addonResolveEnabled = ["1", "true"].includes(
    String(process.env.MEDIA_URL_HOST_RESOLVE_ENABLED || "")
      .trim()
      .toLowerCase()
  ),
  pluginRelay,
  publicAddonRequest = requestPublicAddonHeaders,
  addonLookup,
  requestTimeoutMs = REQUEST_TIMEOUT_MS
} = {}) {
  const pluginFetch = createPluginFetchHandler(pluginRelay);
  let addonResolvesInFlight = 0;
  return async function handleDebridApiBridge(request, response) {
    const url = new URL(request.url || "/", "http://bridge.local");
    if (url.pathname === "/api/debrid/plugin/fetch") {
      return pluginFetch(request, response);
    }
    if (url.pathname === "/api/debrid/link/from-addon") {
      if (!addonResolveEnabled) return bridgeFailure(response, 404, "not_enabled");
      if (request.method !== "POST") return bridgeFailure(response, 405, "method_not_allowed");
      if (addonResolvesInFlight >= 8) return bridgeFailure(response, 429, "resolver_busy");
      addonResolvesInFlight++;
      const controller = new AbortController();
      const abort = () => controller.abort();
      response.once("close", abort);
      try {
        const body = await readJsonBody(request);
        const source = parseHttpsPlaybackUrl(body.url);
        if (!source) return bridgeFailure(response, 403, "untrusted_addon_url");
        const resolved = await resolvePublicAddonRedirect(source, {
          requestHeaders: publicAddonRequest,
          lookup: addonLookup,
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(requestTimeoutMs)])
        });
        if (!resolved) return bridgeFailure(response, 502, "addon_resolve_failed");
        return json(response, 200, { success: true, data: resolved });
      } catch (error) {
        if (!response.destroyed)
          return bridgeFailure(response, error?.statusCode || 502, "addon_resolve_failed");
      } finally {
        response.removeListener("close", abort);
        addonResolvesInFlight--;
      }
    }
    const match =
      /^\/api\/debrid\/(torbox|premiumize)\/(device\/start|device\/redeem|account|cache\/check|torrent\/create|torrent\/lookup|link\/resolve|link\/from-addon)$/.exec(
        url.pathname
      );
    if (url.pathname === "/api/debrid/health" && request.method === "GET") {
      json(response, 200, { ok: true });
      return;
    }
    if (!match) {
      bridgeFailure(response, 404, "not_found");
      return;
    }
    const [, providerId, action] = match;
    if (action === "link/from-addon" && !addonResolveEnabled) {
      bridgeFailure(response, 404, "not_enabled");
      return;
    }
    const isTorboxPlaybackAction =
      providerId === "torbox" &&
      [
        "cache/check",
        "torrent/create",
        "torrent/lookup",
        "link/resolve",
        "link/from-addon"
      ].includes(action);
    if (
      [
        "cache/check",
        "torrent/create",
        "torrent/lookup",
        "link/resolve",
        "link/from-addon"
      ].includes(action) &&
      !isTorboxPlaybackAction
    ) {
      bridgeFailure(response, 404, "not_found");
      return;
    }
    const expectedMethod = action === "account" ? "GET" : "POST";
    if (request.method !== expectedMethod) {
      bridgeFailure(response, 405, "method_not_allowed");
      return;
    }
    try {
      if (action === "account") {
        await handleAccount(providerId, request, response, fetchImpl, requestTimeoutMs);
        return;
      }
      const body = await readJsonBody(request, { allowEmpty: action === "device/start" });
      if (isTorboxPlaybackAction) {
        await handleTorboxPlaybackAction(
          action,
          request,
          response,
          fetchImpl,
          body,
          requestTimeoutMs
        );
        return;
      }
      if (action === "device/start") {
        await handleDeviceStart(providerId, response, fetchImpl, body, requestTimeoutMs);
      } else {
        await handleDeviceRedeem(providerId, response, fetchImpl, body, requestTimeoutMs);
      }
    } catch (error) {
      bridgeFailure(response, error?.statusCode || 502);
    }
  };
}

export function createDebridApiBridgeServer(options = {}) {
  return createServer(createDebridApiBridgeHandler(options));
}
