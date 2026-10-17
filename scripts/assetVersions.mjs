import { createHash } from "node:crypto";

// The bundle and the stylesheets do not carry their contents in their names, and
// `index.html` used to ship a frozen `?v=20260531supporters2` for both. A browser
// that reloads without a service worker can therefore be served the previous
// bundle from its HTTP cache for as long as the static-asset rule allows -- seven
// days. Versioning the URLs with an id that follows the build makes every reload
// ask for files that only the new build has.

export function assetBuildId(contents) {
  if (contents === undefined || contents === null) {
    throw new Error("Asset build id needs the contents of the built bundle.");
  }
  return createHash("sha256").update(contents).digest("hex").slice(0, 12);
}

export function versionAssetUrls(html, buildId) {
  const id = String(buildId || "").trim();
  if (!id) {
    throw new Error("Asset build id is required to version the app shell URLs.");
  }
  return String(html ?? "").replace(/(\?v=)[A-Za-z0-9._-]+/g, `$1${id}`);
}
