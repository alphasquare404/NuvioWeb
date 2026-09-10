/* global __NUVIO_APP_VERSION__ */

import { Platform } from "../../platform/index.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { AuthManager } from "./authManager.js";
import { AuthState } from "./authState.js";

const CLIENT_NAME = "Nuvio Web";
const INSTALLATION_ID_KEY = "nuvio_web_installation_id";
const INSTALLATION_ID_PREFIX = "nuvio-web-";
const INSTALLATION_ID_LENGTH = 32;
const INSTALLATION_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const REGISTRATION_INTERVAL_MS = 15 * 60 * 1000;
const MAX_PLATFORM_LENGTH = 80;
const MAX_DEVICE_NAME_LENGTH = 160;

let volatileInstallationId = null;

function normalizedText(value) {
  return String(value ?? "").trim();
}

function firstText(...values) {
  for (const value of values) {
    const normalized = normalizedText(value);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function readAppVersion() {
  return typeof __NUVIO_APP_VERSION__ !== "undefined" ? __NUVIO_APP_VERSION__ : "0.0.0";
}

export function isValidInstallationId(value) {
  const normalized = normalizedText(value);
  return normalized.length >= 16 && normalized.length <= 96 && /^[A-Za-z0-9_-]+$/.test(normalized);
}

export function generateInstallationId(randomValues = null) {
  const bytes = new Uint8Array(INSTALLATION_ID_LENGTH);
  if (typeof randomValues === "function") {
    randomValues(bytes);
  } else if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  let suffix = "";
  for (const byte of bytes) {
    suffix += INSTALLATION_ID_ALPHABET[byte % INSTALLATION_ID_ALPHABET.length];
  }
  return `${INSTALLATION_ID_PREFIX}${suffix}`;
}

export function getOrCreateInstallationId(storage = globalThis.localStorage, randomValues = null) {
  if (volatileInstallationId) {
    return volatileInstallationId;
  }

  try {
    const stored = storage?.getItem?.(INSTALLATION_ID_KEY);
    if (isValidInstallationId(stored)) {
      volatileInstallationId = normalizedText(stored);
      return volatileInstallationId;
    }
  } catch {
    // Continue with an in-memory identity when persistent storage is unavailable.
  }

  volatileInstallationId = generateInstallationId(randomValues);
  try {
    storage?.setItem?.(INSTALLATION_ID_KEY, volatileInstallationId);
  } catch {
    // Registration still works for this app process when storage is unavailable.
  }
  return volatileInstallationId;
}

export function buildDeviceRegistrationParams({ installationId, clientVersion, metadata }) {
  return {
    p_installation_id: installationId,
    p_client_name: CLIENT_NAME,
    p_client_version: normalizedText(clientVersion).slice(0, 40),
    p_platform: firstText(metadata?.platform, "Unknown").slice(0, MAX_PLATFORM_LENGTH),
    p_device_name: normalizedText(metadata?.deviceName).slice(0, MAX_DEVICE_NAME_LENGTH) || null
  };
}

export async function resolveCurrentDeviceMetadata(platform = Platform, runtime = globalThis) {
  const fallbackDeviceName = normalizedText(platform.getDeviceLabel?.());
  const browserPlatform = firstText(
    runtime.navigator?.userAgentData?.platform,
    runtime.navigator?.platform
  );
  return {
    deviceName: fallbackDeviceName || "Web Browser",
    platform: browserPlatform ? `Web Browser ${browserPlatform}` : "Web Browser"
  };
}

export class DeviceSessionRegistrationService {
  constructor({
    authManager = AuthManager,
    rpc = (functionName, params) => SupabaseApi.rpc(functionName, params),
    storage = globalThis.localStorage,
    metadataResolver = resolveCurrentDeviceMetadata,
    clientVersion = readAppVersion(),
    now = () => Date.now(),
    logger = console,
    documentRef = globalThis.document,
    windowRef = globalThis
  } = {}) {
    this.authManager = authManager;
    this.rpc = rpc;
    this.storage = storage;
    this.metadataResolver = metadataResolver;
    this.clientVersion = clientVersion;
    this.now = now;
    this.logger = logger;
    this.documentRef = documentRef;
    this.windowRef = windowRef;
    this.lastRegistrationAtMs = 0;
    this.registrationPromise = null;
    this.unsubscribe = null;
    this.lifecycleStarted = false;
  }

  start() {
    if (!this.unsubscribe) {
      this.unsubscribe = this.authManager.subscribe((state) => {
        if (state === AuthState.AUTHENTICATED) {
          void this.registerIfAuthenticated({ force: true });
        } else if (state === AuthState.SIGNED_OUT) {
          this.lastRegistrationAtMs = 0;
        }
      });
    }
    this.startLifecycleTracking();
  }

  startLifecycleTracking() {
    if (this.lifecycleStarted) return;
    this.lifecycleStarted = true;

    const registerWhenVisible = () => {
      const hidden =
        this.documentRef?.visibilityState === "hidden" || this.documentRef?.webkitHidden === true;
      if (!hidden) {
        void this.requestForegroundRegistration();
      }
    };

    this.documentRef?.addEventListener?.("visibilitychange", registerWhenVisible);
    this.documentRef?.addEventListener?.("webkitvisibilitychange", registerWhenVisible);
    this.windowRef?.addEventListener?.("pageshow", registerWhenVisible);
    this.windowRef?.addEventListener?.("focus", registerWhenVisible);
  }

  requestForegroundRegistration() {
    return this.registerIfAuthenticated();
  }

  registerIfAuthenticated({ force = false } = {}) {
    if (!this.authManager.isAuthenticated) {
      return Promise.resolve(false);
    }
    if (this.registrationPromise) {
      return this.registrationPromise;
    }

    const elapsed = this.now() - this.lastRegistrationAtMs;
    if (!force && this.lastRegistrationAtMs > 0 && elapsed < REGISTRATION_INTERVAL_MS) {
      return Promise.resolve(true);
    }

    this.registrationPromise = (async () => {
      if (!this.authManager.isAuthenticated) {
        return false;
      }
      const metadata = await this.metadataResolver();
      const params = buildDeviceRegistrationParams({
        installationId: getOrCreateInstallationId(this.storage),
        clientVersion: this.clientVersion,
        metadata
      });
      await this.rpc("register_current_device", params);
      this.lastRegistrationAtMs = this.now();
      return true;
    })()
      .catch((error) => {
        this.logger?.warn?.("Device session registration failed", error);
        return false;
      })
      .finally(() => {
        this.registrationPromise = null;
      });

    return this.registrationPromise;
  }
}

export const DeviceSessionRegistration = new DeviceSessionRegistrationService();
