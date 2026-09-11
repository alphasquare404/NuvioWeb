import { createServer } from "node:http";

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
    .map((entry) => String(entry || "").trim().toLowerCase())
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
  const form = new URLSearchParams({ response_type: "device_code", client_id: body.clientId.trim() });
  const result = await providerRequest(fetchImpl, `${PROVIDERS.premiumize}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: form.toString()
  }, timeoutMs);
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
    result = await providerRequest(fetchImpl, `${PROVIDERS.torbox}/v1/api/user/auth/device/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_code: body.deviceCode.trim() })
    }, timeoutMs);
  } else {
    if (!nonEmptyString(body.clientId)) {
      return bridgeFailure(response, 400, "missing_public_client_id");
    }
    const form = new URLSearchParams({
      grant_type: "device_code",
      code: body.deviceCode.trim(),
      client_id: body.clientId.trim()
    });
    result = await providerRequest(fetchImpl, `${PROVIDERS.premiumize}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: form.toString()
    }, timeoutMs);
  }
  const token = providerId === "torbox" ? result.data?.data?.access_token : result.data?.access_token;
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
  const result = await providerRequest(fetchImpl, `${PROVIDERS[providerId]}${path}`, {
    headers: { Authorization: `Bearer ${credential}` }
  }, timeoutMs);
  if (result.status < 200 || result.status >= 300 || String(result.data?.status || "").toLowerCase() === "error") {
    return bridgeFailure(response, result.status);
  }
  json(response, 200, { ok: true });
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
  } else if (action === "link/resolve") {
    if (!nonEmptyString(body.torrentId)) return bridgeFailure(response, 400, "missing_torrent_id");
    const query = new URLSearchParams({
      token: credential,
      torrent_id: body.torrentId.trim(),
      zip_link: "false",
      redirect: "false",
      append_name: "false"
    });
    if (body.fileId != null && String(body.fileId).trim()) query.set("file_id", String(body.fileId).trim());
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
  requestTimeoutMs = REQUEST_TIMEOUT_MS
} = {}) {
  return async function handleDebridApiBridge(request, response) {
    const url = new URL(request.url || "/", "http://bridge.local");
    const match = /^\/api\/debrid\/(torbox|premiumize)\/(device\/start|device\/redeem|account|cache\/check|torrent\/create|torrent\/lookup|link\/resolve)$/.exec(
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
    const isTorboxPlaybackAction =
      providerId === "torbox" &&
      ["cache/check", "torrent/create", "torrent/lookup", "link/resolve"].includes(action);
    if (["cache/check", "torrent/create", "torrent/lookup", "link/resolve"].includes(action) && !isTorboxPlaybackAction) {
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
