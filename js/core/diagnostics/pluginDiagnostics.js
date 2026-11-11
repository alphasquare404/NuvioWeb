const MAX_STRING_LENGTH = 4000;
const MAX_OBJECT_DEPTH = 4;
const SENSITIVE_KEY_PATTERN =
  /^(?:authorization|cookie|set-cookie|password|passwd|secret|token|access_token|refresh_token|api[_-]?key|client_secret)$/i;
const URL_KEY_PATTERN = /url|uri|endpoint|location|redirect/i;
const remoteDiagnosticKeys = new Set();

function truncate(value, maxLength = MAX_STRING_LENGTH) {
  const text = String(value ?? "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function diagnosticUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.slice(0, 768);
  } catch (_) {
    return raw.split(/[?#]/, 1)[0].slice(0, 768);
  }
}

function redactUrls(value) {
  return truncate(value).replace(/https?:\/\/[^\s"'<>]+/gi, (match) => diagnosticUrl(match));
}

function sanitize(value, key = "", depth = 0, seen = new Set()) {
  if (SENSITIVE_KEY_PATTERN.test(String(key || ""))) return "[redacted]";
  if (value instanceof Error) {
    return {
      name: String(value.name || "Error"),
      message: redactUrls(value.message || String(value)),
      ...(value.code ? { code: String(value.code) } : {}),
      ...(value.stack ? { stack: redactUrls(String(value.stack)) } : {})
    };
  }
  if (value == null) return value;
  if (typeof value === "string") {
    return URL_KEY_PATTERN.test(String(key || "")) ? diagnosticUrl(value) : redactUrls(value);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  if (depth >= MAX_OBJECT_DEPTH) return "[depth limited]";
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, 64).map((entry) => sanitize(entry, "", depth + 1, seen));
  }
  const result = {};
  Object.keys(value)
    .slice(0, 64)
    .forEach((entryKey) => {
      result[entryKey] = sanitize(value[entryKey], entryKey, depth + 1, seen);
    });
  return result;
}

export function diagnosticError(error) {
  if (error && typeof error === "object" && !(error instanceof Error)) {
    return sanitize(error);
  }
  return sanitize(error instanceof Error ? error : new Error(String(error || "Unknown error")));
}

function numericStatus(details = {}) {
  return Number(
    details.status ?? details.providerStatus ?? details.statusCode ?? details.httpStatus ?? 0
  );
}

function severityForEvent(event, details = {}) {
  const name = String(event || "").toLowerCase();
  const status = numericStatus(details);
  if (
    /fatal|crash|failed|error|threw|exception|unavailable|incompatible|timeout|invalid|quota|overflow/.test(
      name
    )
  ) {
    return "error";
  }
  if (status >= 400 || /warn|warning|rejected|unsupported|unknown|degraded|stopped/.test(name)) {
    return "warn";
  }
  return "";
}

function log(level, prefix, event, details) {
  const logger = level === "error" ? console.error : console.warn;
  if (typeof logger !== "function") return false;
  const safeDetails = sanitize(details || {});
  logger.call(console, `${prefix} ${event}`, safeDetails);
  return true;
}

export function emitPluginDiagnostic(
  level,
  event,
  details = {},
  { prefix = "[Nuvio Plugin]" } = {}
) {
  const normalizedLevel = level === "error" ? "error" : "warn";
  return log(normalizedLevel, prefix, event, details);
}

export function emitPluginDiagnosticEvent(
  event,
  details = {},
  { prefix = "[Nuvio Plugin]", level = "" } = {}
) {
  const severity = level || severityForEvent(event, details);
  if (!severity) return false;
  return log(severity, prefix, event, details);
}

function remoteDiagnosticKey(entry) {
  const details = entry?.details || {};
  return [
    entry?.at || "",
    entry?.event || "",
    details.requestId || "",
    details.host || "",
    details.path || "",
    details.status || details.providerStatus || details.httpStatus || ""
  ].join("|");
}

function isTerminalProviderEvent(entry) {
  const event = String(entry?.event || "").toLowerCase();
  const details = entry?.details || {};
  const status = numericStatus(details);
  if (/rejected|error|failed|threw|timeout/.test(event)) return true;
  if (status < 400) return false;
  return (
    event === "fetch response sent" ||
    event === "fetch response failed" ||
    event === "fetch callback failed" ||
    event === "fetch route threw" ||
    /rejected|error|failed|threw|timeout/.test(event)
  );
}

/**
 * Relay the service's redacted terminal failures into the app console. The
 * service process has its own console (visible through device/Inspector logs),
 * so this bridge also makes the same failure available to the app's settings
 * console, which captures console.warn/error.
 */
export function emitPluginServiceDiagnostics(payload) {
  const entries = Array.isArray(payload?.recentEvents) ? payload.recentEvents : [];
  entries.forEach((entry) => {
    if (!entry || !isTerminalProviderEvent(entry)) return;
    const key = remoteDiagnosticKey(entry);
    if (remoteDiagnosticKeys.has(key)) return;
    remoteDiagnosticKeys.add(key);
    if (remoteDiagnosticKeys.size > 256) {
      const first = remoteDiagnosticKeys.values().next().value;
      remoteDiagnosticKeys.delete(first);
    }
    emitPluginDiagnosticEvent(entry.event, entry.details || {}, {
      prefix: "[Nuvio PluginService]"
    });
  });
}
