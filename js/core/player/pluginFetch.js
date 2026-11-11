import { validatePluginFetchRequest } from "./pluginSecurity.js";
import { httpRequest } from "../network/httpClient.js";
import { SessionStore } from "../storage/sessionStore.js";

async function readBounded(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) return { bytes: new Uint8Array(), truncated: false };
  const chunks = [];
  let length = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, maxBytes - length);
      chunks.push(chunk);
      length += chunk.length;
      if (chunk.length !== value.length) {
        truncated = true;
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { bytes, truncated };
}

export async function fetchPluginResource(request = {}) {
  const validation = validatePluginFetchRequest(request, { addDefaultUserAgent: false });
  if (!validation.ok) throw new Error(validation.reason);
  const url = new URL(validation.url);
  if (url.username || url.password) throw new Error("Plugin URL must not contain credentials");
  request.signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 30_000);
  try {
    const body =
      validation.bodyKind === "base64"
        ? Uint8Array.from(atob(validation.bodyBase64), (char) => char.charCodeAt(0))
        : validation.bodyKind === "text"
          ? validation.body
          : undefined;
    const response = await fetch(url.href, {
      method: validation.method,
      headers: validation.headers,
      body: ["GET", "HEAD"].includes(validation.method) ? undefined : body,
      credentials: "omit",
      signal: controller.signal
    });
    const { bytes, truncated } = await readBounded(
      response,
      request.maxResponseBytes || 1024 * 1024
    );
    const result = {
      returnValue: true,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      url: response.url || url.href,
      body: new TextDecoder().decode(bytes),
      headers: Object.fromEntries(response.headers),
      truncated
    };
    if (request.responseEncoding === "base64") {
      const chunks = [];
      for (let offset = 0; offset < bytes.length; offset += 8192) {
        chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
      }
      result.bodyBase64 = btoa(chunks.join(""));
    }
    return result;
  } finally {
    clearTimeout(timeout);
    request.signal?.removeEventListener("abort", abort);
  }
}

export async function fetchPluginRequest(request) {
  const validation = validatePluginFetchRequest(request, { addDefaultUserAgent: false });
  if (!validation.ok) throw new Error(validation.reason);
  const url = new URL(validation.url);
  const canRelay =
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    Boolean(globalThis.location && !SessionStore.isAnonymousSession && SessionStore.accessToken);
  if (!canRelay) return fetchPluginResource(request);

  const readOnly = ["GET", "HEAD"].includes(validation.method);
  if (readOnly) {
    try {
      return await fetchPluginResource(request);
    } catch {
      request.signal?.throwIfAborted();
    }
  }

  try {
    return await httpRequest("/api/debrid/plugin/fetch", {
      method: "POST",
      body: JSON.stringify({
        ...validation,
        responseEncoding: request.responseEncoding
      }),
      signal: request.signal,
      redirect: "error"
    });
  } catch (error) {
    request.signal?.throwIfAborted();
    if (!readOnly && [401, 404, 503].includes(error.status)) {
      // These responses are generated before the bridge contacts the provider.
      return fetchPluginResource(request);
    }
    if (error.status) {
      return {
        returnValue: true,
        ok: false,
        status: error.status,
        statusText: error.code || "Plugin relay request failed",
        url: url.href,
        body: "",
        headers: {}
      };
    }
    throw error;
  }
}
