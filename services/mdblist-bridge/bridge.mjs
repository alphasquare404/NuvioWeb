import { createServer } from "node:http";

const DEFAULT_API_BASE_URL = "https://api.mdblist.com/";
const USER_AGENT = "NuvioWeb";
const MAX_BODY_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const AUTH_FIELDS = new Set([
  "device_code",
  "user_code",
  "verification_uri",
  "verification_uri_complete",
  "expires_in",
  "interval"
]);
const TOKEN_FIELDS = new Set([
  "access_token",
  "refresh_token",
  "expires_in",
  "token_type",
  "scope"
]);

function json(response, status, payload, extraHeaders = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders
  });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body too large"), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!chunks.length) return resolve({});
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

function pickFields(payload, fields) {
  return Object.fromEntries(Object.entries(payload || {}).filter(([key]) => fields.has(key)));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function apiBaseUrl(environment) {
  const candidate = String(environment.MDBLIST_API_BASE_URL || DEFAULT_API_BASE_URL).trim();
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      return DEFAULT_API_BASE_URL;
    }
    return url.href.endsWith("/") ? url.href : `${url.href}/`;
  } catch {
    return DEFAULT_API_BASE_URL;
  }
}

// Only the API surfaces needed by tracking may pass through this bridge. The
// bridge is intentionally not a general MDBList proxy: a path or method that is
// not on this list is rejected before any token is forwarded upstream.
const PROXY_RULES = [
  { method: "GET", pattern: /^\/user$/ },
  { method: "GET", pattern: /^\/watchlist\/items$/ },
  { method: "POST", pattern: /^\/watchlist\/items\/(?:add|remove)$/ },
  { method: "GET", pattern: /^\/lists\/user$/ },
  { method: "GET", pattern: /^\/lists\/\d+\/items$/ },
  { method: "POST", pattern: /^\/lists\/\d+\/items\/(?:add|remove)$/ },
  { method: "GET", pattern: /^\/sync\/(?:last_activities|playback|watched|journal)$/ },
  { method: "POST", pattern: /^\/sync\/watched(?:\/remove)?$/ },
  { method: "POST", pattern: /^\/scrobble\/(?:start|pause|stop|clear)$/ }
];

function proxyPathAllowed(method, path) {
  return PROXY_RULES.some((rule) => rule.method === method && rule.pattern.test(path));
}

function upstreamHeaders(accessToken, body) {
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": USER_AGENT
  };
  if (body != null) headers["Content-Type"] = "application/json";
  return headers;
}

async function requestUpstream(fetchImpl, url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }
    return {
      status: response.status,
      payload,
      retryAfter: response.headers?.get?.("Retry-After") || ""
    };
  } finally {
    clearTimeout(timeout);
  }
}

function upstreamFailure(result) {
  const status = Math.max(400, Math.min(599, Number(result.status) || 502));
  const error =
    result.payload && typeof result.payload === "object"
      ? String(
          result.payload.error_description ||
            result.payload.error ||
            result.payload.message ||
            "MDBList request failed"
        )
      : "MDBList request failed";
  const seconds = String(result.retryAfter || "").trim();
  return {
    status,
    body: { error },
    headers: /^[0-9]+$/.test(seconds) ? { "Retry-After": seconds } : {}
  };
}

function oauthConfiguration(environment) {
  return {
    clientId: String(environment.MDBLIST_CLIENT_ID || "").trim(),
    apiBaseUrl: apiBaseUrl(environment)
  };
}

async function postOAuth(fetchImpl, config, path, fields) {
  return requestUpstream(fetchImpl, `${config.apiBaseUrl}${path.replace(/^\/+/, "")}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": USER_AGENT
    },
    body: new URLSearchParams({ ...fields, client_id: config.clientId }).toString()
  });
}

function bearerToken(request) {
  const value = String(request.headers?.authorization || "").trim();
  return /^Bearer\s+\S+$/i.test(value) ? value.slice(7).trim() : "";
}

export function createMdbListBridgeHandler({ environment = process.env, fetchImpl = fetch } = {}) {
  const config = oauthConfiguration(environment);
  const configured = Boolean(config.clientId);

  return async function handleMdbListBridge(request, response) {
    const parsed = new URL(request.url || "/", "http://bridge.local");
    const pathname = parsed.pathname;

    if (pathname === "/api/mdblist/health" && request.method === "GET") {
      json(response, 200, { configured });
      return;
    }
    if (!configured) {
      json(response, 503, { error: "MDBList browser authentication is not configured" });
      return;
    }

    if (pathname === "/api/mdblist/oauth/device" && request.method === "POST") {
      const result = await postOAuth(fetchImpl, config, "/oauth/device-authorization/", {
        scope: "write"
      }).catch(() => null);
      if (!result) {
        json(response, 502, { error: "Unable to reach MDBList authorization service" });
        return;
      }
      if (result.status < 200 || result.status >= 300) {
        const failure = upstreamFailure(result);
        json(response, failure.status, failure.body, failure.headers);
        return;
      }
      json(response, 200, pickFields(result.payload, AUTH_FIELDS));
      return;
    }

    const proxyPrefix = "/api/mdblist/api";
    const proxyRequest = pathname.startsWith(proxyPrefix);
    if (request.method !== "POST" && !(proxyRequest && request.method === "GET")) {
      json(response, 405, { error: "Method not allowed" });
      return;
    }

    let body = {};
    if (request.method === "POST") {
      try {
        body = await readJsonBody(request);
      } catch (error) {
        json(response, error.statusCode || 400, { error: "Invalid request" });
        return;
      }
    }

    if (pathname === "/api/mdblist/oauth/token") {
      if (!isNonEmptyString(body.device_code)) {
        json(response, 400, { error: "Missing device code" });
        return;
      }
      const result = await postOAuth(fetchImpl, config, "/oauth/token/", {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: body.device_code.trim(),
        scope: "write"
      }).catch(() => null);
      if (!result) {
        json(response, 502, { error: "Unable to reach MDBList authorization service" });
        return;
      }
      if (result.status < 200 || result.status >= 300) {
        const failure = upstreamFailure(result);
        json(response, failure.status, failure.body, failure.headers);
        return;
      }
      json(response, 200, pickFields(result.payload, TOKEN_FIELDS));
      return;
    }

    if (pathname === "/api/mdblist/oauth/refresh") {
      if (!isNonEmptyString(body.refresh_token)) {
        json(response, 400, { error: "Missing refresh token" });
        return;
      }
      const result = await postOAuth(fetchImpl, config, "/oauth/token/", {
        grant_type: "refresh_token",
        refresh_token: body.refresh_token.trim()
      }).catch(() => null);
      if (!result) {
        json(response, 502, { error: "Unable to reach MDBList authorization service" });
        return;
      }
      if (result.status < 200 || result.status >= 300) {
        const failure = upstreamFailure(result);
        json(response, failure.status, failure.body, failure.headers);
        return;
      }
      json(response, 200, pickFields(result.payload, TOKEN_FIELDS));
      return;
    }

    if (pathname === "/api/mdblist/oauth/revoke") {
      if (!isNonEmptyString(body.token)) {
        json(response, 400, { error: "Missing token" });
        return;
      }
      const result = await postOAuth(fetchImpl, config, "/oauth/revoke_token/", {
        token: body.token.trim(),
        token_type_hint: "refresh_token"
      }).catch(() => null);
      if (!result) {
        json(response, 502, { error: "Unable to reach MDBList authorization service" });
        return;
      }
      json(response, result.status >= 200 && result.status < 300 ? 200 : 502, {
        revoked: result.status >= 200 && result.status < 300
      });
      return;
    }

    if (!proxyRequest) {
      json(response, 404, { error: "Not found" });
      return;
    }

    let upstreamPath;
    try {
      upstreamPath = decodeURIComponent(pathname.slice(proxyPrefix.length));
    } catch {
      json(response, 400, { error: "Invalid path" });
      return;
    }
    if (!proxyPathAllowed(request.method, upstreamPath)) {
      json(response, 403, { error: "MDBList path is not allowed" });
      return;
    }
    const accessToken = bearerToken(request);
    if (!accessToken) {
      json(response, 401, { error: "Missing MDBList access token" });
      return;
    }

    const target = new URL(upstreamPath.slice(1), config.apiBaseUrl);
    target.search = parsed.search;
    const payload = request.method === "GET" ? undefined : JSON.stringify(body);
    const result = await requestUpstream(fetchImpl, target.href, {
      method: request.method,
      headers: upstreamHeaders(accessToken, payload),
      body: payload
    }).catch(() => null);
    if (!result) {
      json(response, 502, { error: "Unable to reach MDBList" });
      return;
    }
    if (result.status < 200 || result.status >= 300) {
      const failure = upstreamFailure(result);
      json(response, failure.status, failure.body, failure.headers);
      return;
    }
    json(response, result.status, result.payload);
  };
}

export function createMdbListBridgeServer(options = {}) {
  return createServer(createMdbListBridgeHandler(options));
}
