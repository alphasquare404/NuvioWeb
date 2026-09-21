// A service worker only ever discards its cache when the cache's name changes,
// so that name has to follow the build. Keyed to the app version alone it never
// moved -- that version has not changed since the repository was forked -- so
// every install kept serving the app shell it first cached, and shipped fixes
// reached only the people who hard-reloaded past the service worker.
//
// Hashing what is actually cached gives both halves of that: a build which
// changes nothing keeps its name, and one that changes anything gets a new one.

export function readAppShellEntries(serviceWorkerSource) {
  const block = String(serviceWorkerSource || "").match(/const APP_SHELL\s*=\s*\[([\s\S]*?)\];/);
  if (!block) {
    // Failing the build beats shipping a cache name that cannot tell builds
    // apart, which is the very fault this exists to prevent.
    throw new Error("Could not read APP_SHELL from sw.js; the cache name would be wrong.");
  }
  return Array.from(block[1].matchAll(/"([^"]+)"/g), (match) => match[1]);
}

/**
 * @param {string} serviceWorkerSource the worker source, locale assets already
 *   substituted, so a change to those counts too
 * @param {string} version the app version, kept as a readable prefix
 * @param {(relativePath: string) => Promise<Buffer|string|null>} readShellFile
 *   resolves a built app-shell file, or null when it is not there
 */
export async function buildServiceWorkerCacheId(
  serviceWorkerSource,
  version,
  readShellFile,
  { createHash } = {}
) {
  const hash = (createHash || (await import("node:crypto")).createHash)("sha256");
  hash.update(String(serviceWorkerSource || ""));
  for (const entry of readAppShellEntries(serviceWorkerSource)) {
    const relative = entry.replace(/^\.\//, "");
    if (!relative) {
      continue;
    }
    const contents = await readShellFile(relative);
    // A missing entry still has to move the hash: a file dropped from the build
    // would otherwise leave every existing install on its cached copy.
    hash.update(relative).update(contents ?? "<missing>");
  }
  return `${version}-${hash.digest("hex").slice(0, 12)}`;
}
