// Browser builds load normal image URLs directly. The former webOS companion
// proxy is removed with the native platform runtime.
export function isWebOsImageProxyUrl() {
  return false;
}

export function isWebOsImageProxyReady() {
  return true;
}

export function onWebOsImageProxyReady() {
  return () => {};
}

export function ensureWebOsImageProxyReady() {
  return Promise.resolve(false);
}

export function proxifyImageUrl(value = "") {
  return String(value || "").trim();
}

export function normalizeImageUrl(value = "", options = {}) {
  return proxifyImageUrl(value, options);
}
