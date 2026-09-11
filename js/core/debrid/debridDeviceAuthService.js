import { PREMIUMIZE_CLIENT_ID } from "../../config.js";
import { DebridApi } from "../../data/remote/api/debridApi.js";
import { DebridProviders } from "./debridProviders.js";

export const DEBRID_DEVICE_AUTH_STATUS = Object.freeze({
  AUTHORIZED: "authorized",
  PENDING: "pending",
  EXPIRED: "expired",
  FAILED: "failed",
  UNSUPPORTED: "unsupported"
});

function textValue(value) {
  return String(value || "").trim();
}

function positiveSeconds(value, fallback = 5) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? Math.max(1, Math.trunc(seconds)) : fallback;
}

export function isDeviceAuthorizationExpired(expiresAt, now = Date.now()) {
  const timestamp =
    typeof expiresAt === "number" ? expiresAt : Date.parse(String(expiresAt || ""));
  return Number.isFinite(timestamp) && timestamp <= now;
}

function failureMessage(response) {
  const data = response?.data;
  if (data && typeof data === "object") {
    return textValue(data.error_description || data.detail || data.error || data.message);
  }
  return textValue(response?.text || response?.error?.message);
}

function requireSessionFields(session) {
  if (!session.deviceCode || !session.userCode || !session.verificationUrl) {
    throw new Error("Device authorization response is incomplete.");
  }
  return session;
}

export function parseTorboxDeviceTokenResult(response) {
  const envelope = response?.data && typeof response.data === "object" ? response.data : {};
  const accessToken = textValue(envelope?.data?.access_token);
  if (response?.ok && envelope.success !== false && accessToken) {
    return { status: DEBRID_DEVICE_AUTH_STATUS.AUTHORIZED, accessToken };
  }

  const message = [envelope.error, envelope.detail, failureMessage(response)]
    .map(textValue)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (
    message.includes("pending") ||
    message.includes("not authorized") ||
    message.includes("not been used") ||
    message.includes("not used yet") ||
    message.includes("scan the code") ||
    [404, 409, 425].includes(Number(response?.status || 0))
  ) {
    return { status: DEBRID_DEVICE_AUTH_STATUS.PENDING };
  }
  if (message.includes("expired") || Number(response?.status || 0) === 410) {
    return { status: DEBRID_DEVICE_AUTH_STATUS.EXPIRED };
  }
  return { status: DEBRID_DEVICE_AUTH_STATUS.FAILED, message: failureMessage(response) };
}

export function parsePremiumizeDeviceTokenResult(response) {
  const data = response?.data && typeof response.data === "object" ? response.data : {};
  const accessToken = textValue(data.access_token);
  if (response?.ok && accessToken) {
    return { status: DEBRID_DEVICE_AUTH_STATUS.AUTHORIZED, accessToken };
  }

  const error = textValue(data.error).toLowerCase();
  if (error === "authorization_pending" || error === "slow_down") {
    return { status: DEBRID_DEVICE_AUTH_STATUS.PENDING };
  }
  if (error === "invalid_grant" || error === "expired_token") {
    return { status: DEBRID_DEVICE_AUTH_STATUS.EXPIRED };
  }
  if (Number(response?.status || 0) === 400 && !error) {
    return { status: DEBRID_DEVICE_AUTH_STATUS.PENDING };
  }
  return {
    status: DEBRID_DEVICE_AUTH_STATUS.FAILED,
    message: textValue(data.error_description || data.error || failureMessage(response))
  };
}

export const DebridDeviceAuthService = {
  isConfigured(providerId) {
    const provider = DebridProviders.byId(providerId);
    if (provider?.id === "premiumize") return Boolean(PREMIUMIZE_CLIENT_ID);
    return provider?.id === "torbox";
  },

  async start(providerId) {
    const provider = DebridProviders.byId(providerId);
    if (provider?.id === "torbox") {
      const response = await DebridApi.startTorboxDeviceAuthorization("Nuvio");
      const data = response?.data?.data;
      if (!response?.ok || response?.data?.success === false || !data) {
        throw new Error(failureMessage(response) || "Could not start Torbox sign-in.");
      }
      return requireSessionFields({
        providerId: provider.id,
        deviceCode: textValue(data.device_code),
        userCode: textValue(data.code),
        verificationUrl: textValue(data.verification_url),
        friendlyVerificationUrl:
          textValue(data.friendly_verification_url) || textValue(data.verification_url),
        intervalSeconds: positiveSeconds(data.interval),
        expiresAt: textValue(data.expires_at)
      });
    }

    if (provider?.id === "premiumize") {
      if (!PREMIUMIZE_CLIENT_ID) {
        throw new Error("Premiumize sign-in is missing PREMIUMIZE_CLIENT_ID.");
      }
      const response = await DebridApi.startPremiumizeDeviceAuthorization(PREMIUMIZE_CLIENT_ID);
      const data = response?.data && typeof response.data === "object" ? response.data : {};
      if (!response?.ok || data.error) {
        throw new Error(failureMessage(response) || "Could not start Premiumize sign-in.");
      }
      return requireSessionFields({
        providerId: provider.id,
        deviceCode: textValue(data.device_code),
        userCode: textValue(data.user_code),
        verificationUrl: textValue(data.verification_uri),
        friendlyVerificationUrl:
          textValue(data.verification_uri_complete) || textValue(data.verification_uri),
        intervalSeconds: positiveSeconds(data.interval),
        expiresAt:
          Number(data.expires_in || 0) > 0 ? Date.now() + Number(data.expires_in) * 1000 : null
      });
    }

    throw new Error("Device authorization is not supported for this provider.");
  },

  async redeem(providerId, deviceCode) {
    const normalized = textValue(deviceCode);
    if (!normalized) {
      return { status: DEBRID_DEVICE_AUTH_STATUS.FAILED };
    }
    const provider = DebridProviders.byId(providerId);
    if (provider?.id === "torbox") {
      return parseTorboxDeviceTokenResult(
        await DebridApi.redeemTorboxDeviceAuthorization(normalized)
      );
    }
    if (provider?.id === "premiumize") {
      if (!PREMIUMIZE_CLIENT_ID) {
        return {
          status: DEBRID_DEVICE_AUTH_STATUS.FAILED,
          message: "Premiumize sign-in is missing PREMIUMIZE_CLIENT_ID."
        };
      }
      return parsePremiumizeDeviceTokenResult(
        await DebridApi.redeemPremiumizeDeviceAuthorization(normalized, PREMIUMIZE_CLIENT_ID)
      );
    }
    return { status: DEBRID_DEVICE_AUTH_STATUS.UNSUPPORTED };
  }
};
