/* global __NUVIO_APP_IDENTITY__ */

const FALLBACK_IDENTITY = {
  name: "NuvioWeb",
  version: "0.0.0",
  upstreamVersion: "0.3.35",
  maintainer: "alphasquare",
  sourceRepositoryUrl: "https://github.com/alphasquare404/NuvioWeb",
  issuesUrl: "https://github.com/alphasquare404/NuvioWeb/issues",
  contributorsUrl: "https://github.com/alphasquare404/NuvioWeb/graphs/contributors",
  licenseUrl: "https://github.com/alphasquare404/NuvioWeb/blob/main/LICENSE",
  upstreamRepositoryUrl: "https://github.com/NuvioMedia/NuvioWeb",
  latestReleaseUrl: "https://api.github.com/repos/alphasquare404/NuvioWeb/releases/latest"
};

function text(value, fallback = "") {
  return String(value || "").trim() || fallback;
}

function httpsUrl(value, fallback) {
  const candidate = text(value);
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" ? parsed.href.replace(/\/$/, "") : fallback;
  } catch (_) {
    return fallback;
  }
}

export function createAppIdentity(raw = {}) {
  return Object.freeze({
    name: text(raw.name, FALLBACK_IDENTITY.name),
    version: text(raw.version, FALLBACK_IDENTITY.version),
    upstreamVersion: text(raw.upstreamVersion, FALLBACK_IDENTITY.upstreamVersion),
    maintainer: text(raw.maintainer, FALLBACK_IDENTITY.maintainer),
    sourceRepositoryUrl: httpsUrl(raw.sourceRepositoryUrl, FALLBACK_IDENTITY.sourceRepositoryUrl),
    issuesUrl: httpsUrl(raw.issuesUrl, FALLBACK_IDENTITY.issuesUrl),
    contributorsUrl: httpsUrl(raw.contributorsUrl, FALLBACK_IDENTITY.contributorsUrl),
    licenseUrl: httpsUrl(raw.licenseUrl, FALLBACK_IDENTITY.licenseUrl),
    upstreamRepositoryUrl: httpsUrl(raw.upstreamRepositoryUrl, FALLBACK_IDENTITY.upstreamRepositoryUrl),
    latestReleaseUrl: httpsUrl(raw.latestReleaseUrl, FALLBACK_IDENTITY.latestReleaseUrl)
  });
}

const buildIdentity =
  typeof __NUVIO_APP_IDENTITY__ !== "undefined" ? __NUVIO_APP_IDENTITY__ : FALLBACK_IDENTITY;

export const APP_IDENTITY = createAppIdentity(buildIdentity);
