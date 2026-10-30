import { LocalStore } from "../../core/storage/localStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";

const STORE_KEY = "mdbListAuthState";

function activeProfileId() {
  return String(ProfileManager.getActiveProfileId() || "1");
}

function normalizeState(value = {}) {
  return {
    accessToken: String(value.accessToken || value.access_token || "") || null,
    refreshToken: String(value.refreshToken || value.refresh_token || "") || null,
    tokenType: String(value.tokenType || value.token_type || "") || null,
    expiresAt: Number(value.expiresAt || 0) || null,
    username: String(value.username || "") || null,
    userId: value.userId == null ? null : Number(value.userId),
    deviceCode: String(value.deviceCode || value.device_code || "") || null,
    userCode: String(value.userCode || value.user_code || "") || null,
    verificationUri: String(value.verificationUri || value.verification_uri || "") || null,
    verificationUriComplete:
      String(value.verificationUriComplete || value.verification_uri_complete || "") || null,
    deviceExpiresAt: Number(value.deviceExpiresAt || 0) || null,
    pollInterval: Math.max(1, Number(value.pollInterval || value.interval || 5) || 5),
    nextPollAt: Number(value.nextPollAt || 0) || null
  };
}

function readEnvelope() {
  const raw = LocalStore.get(STORE_KEY, null);
  if (!raw || typeof raw !== "object" || !raw.profiles || typeof raw.profiles !== "object") {
    return { version: 1, profiles: {} };
  }
  return {
    version: 1,
    profiles: Object.fromEntries(
      Object.entries(raw.profiles).map(([profileId, state]) => [
        String(profileId),
        normalizeState(state)
      ])
    )
  };
}

function readProfileState(profileId = activeProfileId()) {
  return normalizeState(readEnvelope().profiles[String(profileId)] || {});
}

function writeProfileState(profileId, nextState) {
  const envelope = readEnvelope();
  envelope.profiles[String(profileId)] = normalizeState(nextState);
  LocalStore.set(STORE_KEY, envelope);
  return normalizeState(envelope.profiles[String(profileId)]);
}

export const MdbListAuthStore = {
  get(profileId = activeProfileId()) {
    return readProfileState(profileId);
  },

  isAuthenticated(profileId = activeProfileId()) {
    const state = readProfileState(profileId);
    return Boolean(state.accessToken && state.refreshToken);
  },

  saveDeviceFlow(data = {}, profileId = activeProfileId()) {
    const current = readProfileState(profileId);
    const now = Date.now();
    const expiresIn = Math.max(0, Number(data.expires_in || data.expiresIn || 0) || 0);
    return writeProfileState(profileId, {
      ...current,
      deviceCode: data.device_code || data.deviceCode || null,
      userCode: data.user_code || data.userCode || null,
      verificationUri:
        data.verification_uri || data.verificationUri || "https://mdblist.com/oauth/device",
      verificationUriComplete:
        data.verification_uri_complete || data.verificationUriComplete || null,
      deviceExpiresAt: now + expiresIn * 1000,
      pollInterval: Math.max(1, Number(data.interval || data.pollInterval || 5) || 5),
      nextPollAt: now + Math.max(1, Number(data.interval || 5) || 5) * 1000
    });
  },

  updatePolling({ pollInterval = 5, nextPollAt = Date.now() } = {}, profileId = activeProfileId()) {
    const current = readProfileState(profileId);
    return writeProfileState(profileId, {
      ...current,
      pollInterval: Math.max(1, Number(pollInterval || 5) || 5),
      nextPollAt: Number(nextPollAt || Date.now())
    });
  },

  saveToken(data = {}, profileId = activeProfileId()) {
    const current = readProfileState(profileId);
    const expiresIn = Math.max(0, Number(data.expires_in || data.expiresIn || 0) || 0);
    return writeProfileState(profileId, {
      ...current,
      accessToken: data.access_token || data.accessToken || null,
      refreshToken: data.refresh_token || data.refreshToken || current.refreshToken || null,
      tokenType: data.token_type || data.tokenType || "Bearer",
      expiresAt: expiresIn > 0 ? Date.now() + expiresIn * 1000 : null,
      deviceCode: null,
      userCode: null,
      verificationUri: null,
      verificationUriComplete: null,
      deviceExpiresAt: null,
      nextPollAt: null
    });
  },

  saveUser({ username = null, userId = null } = {}, profileId = activeProfileId()) {
    const current = readProfileState(profileId);
    return writeProfileState(profileId, {
      ...current,
      username: username || null,
      userId: userId == null ? null : Number(userId)
    });
  },

  clearAuth(profileId = activeProfileId()) {
    return writeProfileState(profileId, {});
  }
};
