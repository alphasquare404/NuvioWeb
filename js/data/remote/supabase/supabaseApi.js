import { httpRequest } from "../../../core/network/httpClient.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../../../config.js";

// Every sync subsystem failing at once says nothing about which of them is
// wrong -- the answer is in the request they all share, and the console
// redacts the URL wholesale to keep credentials out of it. The origin and path
// carry no credentials (those live in headers and the body), and without them
// a 404 cannot be told apart from a backend that is down, a relative URL
// answered by the page's own host, or an argument list no overload matches.
// Reported once per distinct failure so a retry loop cannot flood the buffer.
const reportedFailures = new Set();

function reportRequestFailure(url, error) {
  const status = Number(error?.status || 0);
  let where = "unparseable-url";
  try {
    const parsed = new URL(url, globalThis.location?.href || "http://localhost");
    where = `${parsed.origin}${parsed.pathname}`;
  } catch (_) {
    where = String(url || "").split("?")[0];
  }
  const signature = `${status}:${where}`;
  if (reportedFailures.has(signature)) {
    return;
  }
  reportedFailures.add(signature);
  console.warn(
    `[Supabase] ${status || "no status"} from ${where} ` +
      `(configured base: ${SUPABASE_URL || "EMPTY"}, key: ${SUPABASE_ANON_KEY ? "present" : "EMPTY"})`
  );
}

function request(url, options) {
  return httpRequest(url, options).catch((error) => {
    reportRequestFailure(url, error);
    throw error;
  });
}

function buildHeaders(extra = {}, useSession = true) {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    ...extra
  };
  if (!useSession && headers.Authorization == null) {
    headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
  }
  return headers;
}

export const SupabaseApi = {
  rpc(functionName, body = {}, useSession = true) {
    return request(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
      method: "POST",
      headers: buildHeaders({ "Content-Type": "application/json" }, useSession),
      includeSessionAuth: useSession,
      body: JSON.stringify(body)
    });
  },

  select(table, query = "", useSession = true) {
    const suffix = query ? `?${query}` : "";
    return request(`${SUPABASE_URL}/rest/v1/${table}${suffix}`, {
      method: "GET",
      headers: buildHeaders({}, useSession),
      includeSessionAuth: useSession
    });
  },

  upsert(table, rows, onConflict = null, useSession = true) {
    const query = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : "";
    return request(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
      method: "POST",
      headers: buildHeaders(
        {
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=representation"
        },
        useSession
      ),
      includeSessionAuth: useSession,
      body: JSON.stringify(rows)
    });
  },

  delete(table, query, useSession = true) {
    return request(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      method: "DELETE",
      headers: buildHeaders({ Prefer: "return=representation" }, useSession),
      includeSessionAuth: useSession
    });
  }
};
