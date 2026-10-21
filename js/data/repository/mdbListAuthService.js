import { MdbListAuthStore } from "../local/mdbListAuthStore.js";

const BRIDGE_BASE_PATH = "/api/mdblist";
const REFRESH_LEEWAY_MS = 60_000;
let bridgeStatus = "unknown";

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function requestBridge(path, { method = "POST", body = null } = {}) {
  const response = await fetch(`${BRIDGE_BASE_PATH}${path}`, {
    method,
    headers: body == null ? undefined : { "Content-Type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body),
    cache: "no-store"
  });
  return { response, payload: await readResponseBody(response) };
}

function errorMessage(payload, fallback) {
  if (payload && typeof payload === "object") {
    return String(payload.error_description || payload.error || payload.message || fallback);
  }
  return fallback;
}

async function checkBridge() {
  try {
    const { response, payload } = await requestBridge("/health", { method: "GET" });
    bridgeStatus = response.ok && payload?.configured === true ? "available" : "unavailable";
  } catch {
    bridgeStatus = "unavailable";
  }
  return bridgeStatus === "available";
}

function isTokenExpiring(state) {
  if (!state.accessToken) return true;
  if (!state.expiresAt) return false;
  return Number(state.expiresAt) <= Date.now() + REFRESH_LEEWAY_MS;
}

async function fetchUser() {
  const response = await MdbListAuthService.apiRequest("/user");
  if (!response.response.ok || !response.payload) return null;
  const user = response.payload;
  const username = String(user.username || user.name || user.user_name || "").trim() || null;
  const userId = Number(user.user_id ?? user.id ?? 0) || null;
  MdbListAuthStore.saveUser({ username, userId });
  return username;
}

export const MdbListAuthService = {
  hasRequiredCredentials() {
    return bridgeStatus === "available";
  },

  getBrowserBridgeStatus() {
    return bridgeStatus;
  },

  async refreshBrowserBridgeAvailability() {
    return checkBridge();
  },

  getCurrentAuthState() {
    return MdbListAuthStore.get();
  },

  isAuthenticated() {
    return MdbListAuthStore.isAuthenticated();
  },

  async startDeviceAuth() {
    if (!(await checkBridge())) {
      throw new Error("MDBList browser authentication is unavailable on this server");
    }
    const current = MdbListAuthStore.get();
    if (
      current.deviceCode &&
      current.deviceExpiresAt &&
      Date.now() < Number(current.deviceExpiresAt)
    ) {
      return current;
    }
    const { response, payload } = await requestBridge("/oauth/device");
    if (!response.ok || !payload?.device_code || !payload?.user_code) {
      throw new Error(errorMessage(payload, `Failed to start MDBList auth (${response.status})`));
    }
    return MdbListAuthStore.saveDeviceFlow(payload);
  },

  async pollDeviceAuth() {
    const state = MdbListAuthStore.get();
    if (!state.deviceCode) {
      return { type: "failed", message: "No active MDBList device code" };
    }
    if (state.deviceExpiresAt && Date.now() >= Number(state.deviceExpiresAt)) {
      MdbListAuthStore.clearAuth();
      return { type: "expired" };
    }
    if (state.nextPollAt && Date.now() < Number(state.nextPollAt)) {
      return { type: "pending" };
    }

    const { response, payload } = await requestBridge("/oauth/token", {
      body: { device_code: state.deviceCode }
    });
    const interval = Math.max(1, Number(state.pollInterval || 5) || 5);

    if (response.ok && payload?.access_token) {
      MdbListAuthStore.saveToken(payload);
      const username = await fetchUser();
      return { type: "approved", username };
    }

    const code = String(payload?.error || "").trim();
    if (response.status === 429 || code === "slow_down") {
      const nextInterval = Math.min(60, interval + 5);
      MdbListAuthStore.updatePolling({
        pollInterval: nextInterval,
        nextPollAt: Date.now() + nextInterval * 1000
      });
      return { type: "slow_down", pollIntervalSeconds: nextInterval };
    }
    if (code === "authorization_pending") {
      MdbListAuthStore.updatePolling({
        pollInterval: interval,
        nextPollAt: Date.now() + interval * 1000
      });
      return { type: "pending" };
    }
    if (code === "access_denied") {
      MdbListAuthStore.clearAuth();
      return { type: "denied" };
    }
    if (code === "expired_token") {
      MdbListAuthStore.clearAuth();
      return { type: "expired" };
    }
    MdbListAuthStore.updatePolling({
      pollInterval: interval,
      nextPollAt: Date.now() + interval * 1000
    });
    return {
      type: "failed",
      message: errorMessage(payload, `Token polling failed (${response.status})`)
    };
  },

  cancelDeviceAuth() {
    MdbListAuthStore.clearAuth();
  },

  async refreshTokenIfNeeded(force = false) {
    const state = MdbListAuthStore.get();
    if (!state.refreshToken) return false;
    if (!force && !isTokenExpiring(state)) return true;
    if (!(await checkBridge())) return false;
    const { response, payload } = await requestBridge("/oauth/refresh", {
      body: { refresh_token: state.refreshToken }
    });
    if (!response.ok || !payload?.access_token) {
      if ([400, 401, 403].includes(response.status)) {
        MdbListAuthStore.clearAuth();
      }
      return false;
    }
    MdbListAuthStore.saveToken(payload);
    await fetchUser();
    return true;
  },

  async getValidAccessToken() {
    const state = MdbListAuthStore.get();
    if (!state.accessToken) return null;
    if (isTokenExpiring(state)) {
      const refreshed = await this.refreshTokenIfNeeded(true);
      if (!refreshed) return null;
      return MdbListAuthStore.get().accessToken;
    }
    return state.accessToken;
  },

  async apiRequest(path, { method = "GET", body = null, query = null } = {}) {
    if (!String(path || "").startsWith("/")) {
      throw new Error("Invalid MDBList API path");
    }
    const token = await this.getValidAccessToken();
    if (!token) {
      throw new Error("MDBList is not connected");
    }
    const url = new URL(`${BRIDGE_BASE_PATH}/api${path}`, window.location.origin);
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value != null && value !== "") url.searchParams.set(key, String(value));
    });
    const response = await fetch(url.href, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body == null ? {} : { "Content-Type": "application/json" })
      },
      body: body == null ? undefined : JSON.stringify(body),
      cache: "no-store"
    });
    const payload = await readResponseBody(response);
    if (response.status === 401) {
      const refreshed = await this.refreshTokenIfNeeded(true);
      if (refreshed) {
        const nextToken = MdbListAuthStore.get().accessToken;
        const retry = await fetch(url.href, {
          method,
          headers: {
            Authorization: `Bearer ${nextToken}`,
            ...(body == null ? {} : { "Content-Type": "application/json" })
          },
          body: body == null ? undefined : JSON.stringify(body),
          cache: "no-store"
        });
        return { response: retry, payload: await readResponseBody(retry) };
      }
    }
    return { response, payload };
  },

  async disconnect() {
    const state = MdbListAuthStore.get();
    if (state.refreshToken) {
      await requestBridge("/oauth/revoke", {
        body: { token: state.refreshToken }
      }).catch(() => {});
    }
    MdbListAuthStore.clearAuth();
  }
};
