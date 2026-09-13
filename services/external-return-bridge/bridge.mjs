import { createServer } from "node:http";
import webpush from "web-push";

const TOKEN_PATTERN = /^[a-f0-9]{32}$/i;
const REPORT_TTL_MS = 10 * 60 * 1000;
const MAX_RECORDS = 500;
const MAX_VALUE = 1_000_000_000;

function json(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(payload));
}

function formatPosition(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function returnPage(response, status, { finished = false, position = null, error = "", pushSent = false } = {}) {
  const positionLine = Number.isFinite(position) ? `<p class="detail">Position <strong>${formatPosition(position)}</strong></p>` : "";
  const heading = error ? "Playback unavailable" : finished ? "Playback completed" : "Playback received";
  const detail = error
    ? error
    : finished
      ? "Marked as finished. Return to NuvioWeb to update Continue Watching."
      : pushSent ? "A notification was sent to NuvioWeb." : "Your playback result was received. Return to NuvioWeb to update Continue Watching.";
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  });
  const action = `<p class="safe">${pushSent ? "Tap the notification to return to the app." : "Return to NuvioWeb from your Home Screen to continue."}</p>${pushSent ? `<script>setTimeout(function(){try{window.close()}catch(_){ }},800)</script>` : ""}`;
  response.end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="dark light"><title>NuvioWeb</title><style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;background:#090a0d;color:#f7f7f8;font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:max(24px,env(safe-area-inset-top)) max(20px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(20px,env(safe-area-inset-left))}.card{width:min(100%,390px);padding:30px 24px;border:1px solid #30323a;border-radius:24px;background:#191a1f;box-shadow:0 20px 60px #0008;text-align:center}.brand{font-weight:800;letter-spacing:-.04em;font-size:20px}.check{width:48px;height:48px;margin:24px auto 16px;display:grid;place-items:center;border-radius:50%;background:#277a53;color:white;font-size:28px}h1{margin:0;font-size:26px;letter-spacing:-.035em}.copy,.detail,.safe{color:#c4c6ce;margin:12px 0}.detail strong{display:block;color:#fff;font-size:22px;margin-top:4px}.return{display:block;width:100%;margin-top:24px;padding:14px 16px;border:0;border-radius:14px;background:#fff;color:#15161a;text-decoration:none;font:750 16px inherit;cursor:pointer}.safe{font-size:13px;margin-top:15px}</style></head><body><main class="card"><div class="brand">NuvioWeb</div><div class="check" aria-hidden="true">✓</div><h1>${heading}</h1><p class="copy">${detail}</p>${positionLine}${action}</main></body></html>`);
}

function isValidToken(token) {
  return TOKEN_PATTERN.test(String(token || ""));
}

function readOptionalNumber(search, name) {
  if (!search.has(name)) return { present: false, value: null };
  const value = Number(search.get(name));
  if (!Number.isFinite(value) || value < 0 || value > MAX_VALUE) return { invalid: true };
  return { present: true, value };
}

function readProvider(search) {
  const provider = String(search.get("provider") || "outplayer").trim().toLowerCase();
  return ["outplayer", "infuse", "lenna", "vlc"].includes(provider) ? provider : "";
}

function validPosition(position, duration) {
  if (position == null || duration == null) return true;
  return position <= duration * 1.1 + 60;
}

export function createExternalReturnStore({ now = () => Date.now(), ttlMs = REPORT_TTL_MS, maxRecords = MAX_RECORDS } = {}) {
  const records = new Map();
  const bindings = new Map();
  const cleanup = () => {
    const current = now();
    for (const [token, record] of records) {
      if (record.expiresAt <= current) records.delete(token);
    }
    for (const [token, binding] of bindings) {
      if (binding.expiresAt <= current) bindings.delete(token);
    }
  };
  return {
    put(token, report) {
      cleanup();
      if (!isValidToken(token)) return false;
      while (records.size >= maxRecords) records.delete(records.keys().next().value);
      records.set(token, { ...report, createdAt: now(), expiresAt: now() + ttlMs });
      return true;
    },
    take(token) {
      cleanup();
      const record = records.get(token);
      if (!record) return null;
      records.delete(token);
      return record;
    },
    size() {
      cleanup();
      return records.size;
    }
    ,bind(token, subscription) {
      cleanup(); if (!isValidToken(token) || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) return false;
      while (bindings.size >= maxRecords) bindings.delete(bindings.keys().next().value);
      bindings.set(token, { subscription, expiresAt: now() + ttlMs }); return true;
    },
    takeBinding(token) { cleanup(); const binding = bindings.get(token); bindings.delete(token); return binding?.subscription || null; }
  };
}

function pushConfig(env = process.env) {
  const publicKey = String(env.NUVIO_WEB_PUSH_PUBLIC_KEY || "");
  const privateKey = String(env.NUVIO_WEB_PUSH_PRIVATE_KEY || "");
  const subject = String(env.NUVIO_WEB_PUSH_SUBJECT || "");
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

async function sendReturnPush(subscription, finished, config = pushConfig(), sender = webpush) {
  if (!subscription || !config) return false;
  try {
    sender.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    await sender.sendNotification(subscription, JSON.stringify({ type: "external-playback-return", kind: finished ? "finished" : "progress" }));
    return true;
  } catch (_) { return false; }
}

export function createExternalReturnHandler({ store = createExternalReturnStore(), env = process.env, sender = webpush } = {}) {
  return function handleExternalReturn(request, response) {
    const url = new URL(request.url || "/", "http://external-return.local");
    const match = /^\/api\/external-return\/(report|collect)\/([a-f0-9]{32})$/i.exec(url.pathname);
    if (url.pathname === "/api/external-return/health" && request.method === "GET") {
      json(response, 200, { ok: true });
      return;
    }
    if (url.pathname === "/api/external-return/push/public-key" && request.method === "GET") {
      const config = pushConfig(env); json(response, 200, config ? { enabled: true, publicKey: config.publicKey } : { enabled: false }); return;
    }
    if (url.pathname === "/api/external-return/push/bind") {
      if (request.method !== "POST") { json(response, 405, { bound: false, error: "method_not_allowed" }); return; }
      let body = ""; request.on("data", (chunk) => { body += chunk; if (body.length > 16_384) request.destroy(); });
      request.on("end", () => { try { const value = JSON.parse(body); const bound = store.bind(value.token, value.subscription); json(response, bound ? 200 : 400, { bound }); } catch (_) { json(response, 400, { bound: false }); } }); return;
    }
    if (!match) {
      json(response, 404, { found: false, error: "not_found" });
      return;
    }
    const [, action, token] = match;
    if (!isValidToken(token)) {
      json(response, 400, { found: false, error: "invalid_token" });
      return;
    }
    if (action === "collect") {
      if (request.method !== "GET") {
        json(response, 405, { found: false, error: "method_not_allowed" });
        return;
      }
      const report = store.take(token);
      json(response, 200, report ? { found: true, outcome: report.outcome, provider: report.provider, sourceOutcome: report.sourceOutcome, position: report.position, duration: report.duration, progress: report.progress, parameterNames: report.parameterNames } : { found: false });
      return;
    }
    if (request.method !== "GET") {
      json(response, 405, { found: false, error: "method_not_allowed" });
      return;
    }
    const outcome = url.searchParams.get("outcome");
    const provider = readProvider(url.searchParams);
    const sourceOutcome = ["finished", "stopped", "success", "cancel", "error"].includes(url.searchParams.get("sourceOutcome"))
      ? url.searchParams.get("sourceOutcome")
      : outcome;
    const position = readOptionalNumber(url.searchParams, "position");
    const duration = readOptionalNumber(url.searchParams, "duration");
    const progress = readOptionalNumber(url.searchParams, "progress");
    if (!["finished", "stopped"].includes(outcome) || !provider || position.invalid || duration.invalid || progress.invalid || (progress.present && progress.value > 1) || !validPosition(position.value, duration.value)) {
      returnPage(response, 400, { error: "This playback report could not be accepted." });
      return;
    }
    const parameterNames = ["position", "duration", "progress", "lastPlayedUrl"].filter((name) => url.searchParams.has(name));
    store.put(token, { outcome, provider, sourceOutcome, position: position.value, duration: duration.value, progress: progress.value, parameterNames });
    if (provider === "infuse" && sourceOutcome === "error") {
      returnPage(response, 200, { error: "Infuse could not play this stream. Return to NuvioWeb to choose another source." });
      return;
    }
    void sendReturnPush(store.takeBinding(token), provider === "outplayer" && sourceOutcome === "finished", pushConfig(env), sender).then((pushSent) => {
      returnPage(response, 200, { finished: provider === "outplayer" && sourceOutcome === "finished", position: position.value, pushSent });
    });
  };
}

export function createExternalReturnServer(options = {}) {
  return createServer(createExternalReturnHandler(options));
}
