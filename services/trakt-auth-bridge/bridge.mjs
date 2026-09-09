import { createServer } from "node:http";

const TRAKT_API_BASE_URL = "https://api.trakt.tv";
const MAX_BODY_BYTES = 8 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const TOKEN_RESPONSE_FIELDS = new Set([
  "access_token",
  "refresh_token",
  "expires_in",
  "created_at",
  "token_type",
  "scope"
]);
const DEVICE_RESPONSE_FIELDS = new Set([
  "device_code",
  "user_code",
  "verification_url",
  "expires_in",
  "interval"
]);

function json(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
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
  return Object.fromEntries(
    Object.entries(payload || {}).filter(([key]) => fields.has(key))
  );
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function bridgeConfiguration(environment) {
  return {
    clientId: String(environment.TRAKT_CLIENT_ID || "").trim(),
    clientSecret: String(environment.TRAKT_CLIENT_SECRET || "").trim(),
    redirectUri: String(environment.TRAKT_REDIRECT_URI || "urn:ietf:wg:oauth:2.0:oob").trim()
  };
}

async function requestTraktToken(fetchImpl, path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${TRAKT_API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = {};
    }
    return { status: response.status, payload };
  } finally {
    clearTimeout(timeout);
  }
}

function upstreamError(status, payload) {
  const safeMessage = String(payload?.error_description || payload?.error || "Trakt authorization failed");
  return { status: Math.max(400, Math.min(599, Number(status) || 502)), body: { error: safeMessage } };
}

export function createTraktAuthBridgeHandler({ environment = process.env, fetchImpl = fetch } = {}) {
  const config = bridgeConfiguration(environment);
  const configured = Boolean(config.clientId && config.clientSecret);

  return async function handleTraktAuthBridge(request, response) {
    const pathname = new URL(request.url || "/", "http://bridge.local").pathname;
    if (pathname === "/api/trakt/health" && request.method === "GET") {
      json(response, 200, { configured });
      return;
    }
    if (!configured) {
      json(response, 503, { error: "Trakt browser authentication is not configured" });
      return;
    }
    if (request.method !== "POST") {
      json(response, 405, { error: "Method not allowed" });
      return;
    }

    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      json(response, error.statusCode || 400, { error: "Invalid request" });
      return;
    }

    try {
      if (pathname === "/api/trakt/device/code") {
        const result = await requestTraktToken(fetchImpl, "/oauth/device/code", {
          client_id: config.clientId
        });
        if (result.status < 200 || result.status >= 300) {
          const failure = upstreamError(result.status, result.payload);
          json(response, failure.status, failure.body);
          return;
        }
        json(response, 200, pickFields(result.payload, DEVICE_RESPONSE_FIELDS));
        return;
      }
      if (pathname === "/api/trakt/device/token") {
        if (!isNonEmptyString(body.code)) {
          json(response, 400, { error: "Missing device code" });
          return;
        }
        const result = await requestTraktToken(fetchImpl, "/oauth/device/token", {
          code: body.code.trim(),
          client_id: config.clientId,
          client_secret: config.clientSecret
        });
        if (result.status < 200 || result.status >= 300) {
          const failure = upstreamError(result.status, result.payload);
          json(response, failure.status, failure.body);
          return;
        }
        json(response, 200, pickFields(result.payload, TOKEN_RESPONSE_FIELDS));
        return;
      }
      if (pathname === "/api/trakt/refresh") {
        if (!isNonEmptyString(body.refresh_token)) {
          json(response, 400, { error: "Missing refresh token" });
          return;
        }
        const result = await requestTraktToken(fetchImpl, "/oauth/token", {
          refresh_token: body.refresh_token.trim(),
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.redirectUri,
          grant_type: "refresh_token"
        });
        if (result.status < 200 || result.status >= 300) {
          const failure = upstreamError(result.status, result.payload);
          json(response, failure.status, failure.body);
          return;
        }
        json(response, 200, pickFields(result.payload, TOKEN_RESPONSE_FIELDS));
        return;
      }
      json(response, 404, { error: "Not found" });
    } catch {
      json(response, 502, { error: "Unable to reach Trakt authorization service" });
    }
  };
}

export function createTraktAuthBridgeServer(options = {}) {
  return createServer(createTraktAuthBridgeHandler(options));
}
