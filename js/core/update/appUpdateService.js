import { APP_IDENTITY } from "../app/appIdentity.js";

const LATEST_RELEASE_URL = APP_IDENTITY.latestReleaseUrl;
const DEFAULT_TIMEOUT_MS = 8000;

export function normalizeAppVersion(raw) {
  return String(raw || "")
    .trim()
    .replace(/^[vV]/, "");
}

export function parseAppVersionParts(raw) {
  const normalized = normalizeAppVersion(raw);
  if (!normalized) {
    return null;
  }

  const parts = normalized
    .split(/[.\-_]/)
    .filter(Boolean)
    .map((token) => {
      const match = String(token).match(/^\d+/);
      return match ? Number.parseInt(match[0], 10) : null;
    })
    .filter((part) => Number.isFinite(part));

  return parts.length > 0 ? parts : null;
}

export function isRemoteAppVersionNewer(remote, local) {
  const remoteParts = parseAppVersionParts(remote);
  const localParts = parseAppVersionParts(local);

  if (!remoteParts || !localParts) {
    const normalizedRemote = normalizeAppVersion(remote);
    const normalizedLocal = normalizeAppVersion(local);
    return Boolean(normalizedRemote && normalizedLocal && normalizedRemote !== normalizedLocal);
  }

  const length = Math.max(remoteParts.length, localParts.length);
  for (let index = 0; index < length; index += 1) {
    const remotePart = remoteParts[index] || 0;
    const localPart = localParts[index] || 0;
    if (remotePart !== localPart) {
      return remotePart > localPart;
    }
  }
  return false;
}

function releaseTag(release) {
  return String(release?.tag_name || release?.name || "").trim();
}

export function parseLatestRelease(release) {
  if (!release || release.draft || release.prerelease) {
    return null;
  }

  const tag = releaseTag(release);
  if (!tag) {
    return null;
  }

  return {
    tag,
    title: String(release.name || tag).trim() || tag,
    notes: String(release.body || "").trim(),
    releaseUrl: String(release.html_url || "").trim() || null
  };
}

export async function getLatestAppUpdate({
  currentVersion,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch is unavailable");
  }

  const supportsAbort = typeof globalThis.AbortController === "function";
  const controller = supportsAbort ? new AbortController() : null;
  let timeoutId = null;

  try {
    const request = fetchImpl(LATEST_RELEASE_URL, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json"
      },
      cache: "no-store",
      signal: controller?.signal
    });
    const response = await Promise.race([
      request,
      new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => {
            controller?.abort();
            reject(new Error("GitHub release check timed out"));
          },
          Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS)
        );
      })
    ]);

    if (!response?.ok) {
      throw new Error(`GitHub release check failed: HTTP ${response?.status || 0}`);
    }

    const release = parseLatestRelease(await response.json());
    if (!release || !isRemoteAppVersionNewer(release.tag, currentVersion)) {
      return null;
    }
    return release;
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}
