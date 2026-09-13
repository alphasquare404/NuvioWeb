function supported(runtime = globalThis) {
  return Boolean(runtime?.isSecureContext && runtime?.navigator?.serviceWorker && runtime?.PushManager && runtime?.Notification);
}

export function decodeVapidPublicKey(value) {
  const base64 = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const bytes = globalThis.atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(bytes, (char) => char.charCodeAt(0));
}

export async function getBrowserPushReturnState({ runtime = globalThis, fetchImpl = runtime.fetch } = {}) {
  if (!supported(runtime)) return { state: "unavailable" };
  let config;
  try { config = await (await fetchImpl("/api/external-return/push/public-key", { cache: "no-store" })).json(); } catch (_) { return { state: "unavailable" }; }
  if (!config?.enabled || !config.publicKey) return { state: "server-not-configured" };
  if (runtime.Notification.permission === "denied") return { state: "blocked", publicKey: config.publicKey };
  try {
    const registration = await runtime.navigator.serviceWorker.ready;
    return { state: await registration.pushManager.getSubscription() ? "enabled" : "not-enabled", publicKey: config.publicKey, registration };
  } catch (_) { return { state: "unavailable" }; }
}

export async function enableBrowserPushReturn({ runtime = globalThis, fetchImpl = runtime.fetch } = {}) {
  const current = await getBrowserPushReturnState({ runtime, fetchImpl });
  if (current.state !== "not-enabled") return current;
  const permission = await runtime.Notification.requestPermission();
  if (permission !== "granted") return { ...current, state: permission === "denied" ? "blocked" : "not-enabled" };
  const existing = await current.registration.pushManager.getSubscription();
  if (existing) return { ...current, state: "enabled" };
  try {
    await current.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeVapidPublicKey(current.publicKey) });
    return { ...current, state: "enabled" };
  } catch (error) {
    return { ...current, state: "not-enabled", diagnostic: {
      name: String(error?.name || "Error"),
      message: String(error?.message || "Unknown push subscription error")
    } };
  }
}

export async function disableBrowserPushReturn({ runtime = globalThis } = {}) {
  if (!supported(runtime)) return { state: "unavailable" };
  const registration = await runtime.navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) await subscription.unsubscribe();
  return { state: "not-enabled" };
}

export async function bindBrowserPushReturn({ token, runtime = globalThis, fetchImpl = runtime.fetch } = {}) {
  if (!token || !supported(runtime) || typeof fetchImpl !== "function") return false;
  try {
    const registration = await runtime.navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return false;
    const response = await fetchImpl("/api/external-return/push/bind", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, subscription: subscription.toJSON() })
    });
    return response.ok;
  } catch (_) { return false; }
}
