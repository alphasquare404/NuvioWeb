const PROVIDER_VERIFICATION_HOSTS = Object.freeze({
  torbox: "tor.box",
  premiumize: "www.premiumize.me"
});

function trustedVerificationUrl(providerId, value) {
  const expectedHost = PROVIDER_VERIFICATION_HOSTS[String(providerId || "").toLowerCase()];
  if (!expectedHost) return null;
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" &&
      url.hostname.toLowerCase() === expectedHost &&
      !url.port &&
      !url.username &&
      !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}

function copyWithDocumentFallback(value, documentRef) {
  if (
    !documentRef?.createElement ||
    !documentRef.body?.appendChild ||
    typeof documentRef.execCommand !== "function"
  ) {
    return false;
  }
  const input = documentRef.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.cssText = "position:fixed;opacity:0;pointer-events:none;";
  documentRef.body.appendChild(input);
  try {
    input.select?.();
    return documentRef.execCommand("copy") === true;
  } catch {
    return false;
  } finally {
    input.remove?.();
  }
}

/**
 * Copy text, preferring the async clipboard and falling back to the legacy
 * user-gesture path. The fallback is what makes this work in an installed iOS
 * PWA, where `navigator.clipboard` is frequently absent or rejects.
 */
export async function copyTextToClipboard(
  text,
  { clipboard = globalThis.navigator?.clipboard, documentRef = globalThis.document } = {}
) {
  const value = String(text || "");
  if (!value) return false;
  if (typeof clipboard?.writeText === "function") {
    try {
      await clipboard.writeText(value);
      return true;
    } catch {
      // Continue to the browser's legacy, user-gesture copy fallback.
    }
  }
  return copyWithDocumentFallback(value, documentRef);
}

export const copyDeviceAuthorizationCode = copyTextToClipboard;

export function openDeviceAuthorizationLink(
  providerId,
  verificationUrl,
  { open } = {}
) {
  const url = trustedVerificationUrl(providerId, verificationUrl);
  const windowRef = globalThis.window;
  const openLink = open || windowRef?.open?.bind(windowRef);
  if (!url || typeof openLink !== "function") return false;
  openLink(url.href, "_blank", "noopener,noreferrer");
  return true;
}
