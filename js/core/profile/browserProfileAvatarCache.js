import { LocalStore } from "../storage/localStore.js";
import { Platform } from "../../platform/index.js";

const CACHE_NAME = "nuvio-profile-avatars-v1";
const CACHE_INDEX_KEY = "browserProfileAvatarCacheIndex";
const objectUrls = new Map();

function safeSourceIdentity(sourceUrl = "") {
  try {
    const url = new URL(String(sourceUrl || ""));
    if (!/^https?:$/.test(url.protocol)) return "";
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

function cacheKey(identity = "") {
  const origin = globalThis.location?.origin || "https://nuvio.local";
  return new Request(new URL(`__nuvio_profile_avatar__/${encodeURIComponent(identity)}`, `${origin}/`).href);
}

function readIndex() {
  const value = LocalStore.get(CACHE_INDEX_KEY, {});
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function writeIndex(index) {
  LocalStore.set(CACHE_INDEX_KEY, index);
}

function profileKey(profileId) {
  return `profile:${String(profileId || "").trim()}`;
}

function avatarKey(avatarId) {
  return `avatar:${String(avatarId || "").trim()}`;
}

function candidateIdentities(profile = {}, sourceUrl = "") {
  const index = readIndex();
  const currentIdentity = safeSourceIdentity(sourceUrl);
  if (currentIdentity) return [currentIdentity];
  const mapped = [index[profileKey(profile?.id)], index[avatarKey(profile?.avatarId)]]
    .filter(Boolean)
    .map((entry) => String(entry.identity || ""));
  return Array.from(new Set(mapped.filter(Boolean)));
}

async function getCachedObjectUrl(identity) {
  if (!identity || !globalThis.caches || typeof globalThis.URL?.createObjectURL !== "function") {
    return "";
  }
  if (objectUrls.has(identity)) return objectUrls.get(identity);
  const cache = await caches.open(CACHE_NAME);
  const response = await cache.match(cacheKey(identity));
  if (!response) return "";
  const blob = await response.blob();
  if (!blob.size) return "";
  const objectUrl = URL.createObjectURL(blob);
  objectUrls.set(identity, objectUrl);
  return objectUrl;
}

async function storeAvatar(identity, response) {
  if (!identity || !response?.ok || !globalThis.caches) return "";
  const declaredType = String(response.headers?.get("content-type") || "").toLowerCase();
  if (declaredType && !declaredType.startsWith("image/")) return "";
  const blob = await response.blob();
  if (!blob.size || (blob.type && !blob.type.toLowerCase().startsWith("image/"))) return "";
  const cache = await caches.open(CACHE_NAME);
  await cache.put(
    cacheKey(identity),
    new Response(blob, { headers: { "content-type": blob.type || "image/*" } })
  );
  const existing = objectUrls.get(identity);
  if (existing) URL.revokeObjectURL?.(existing);
  const objectUrl = globalThis.URL?.createObjectURL?.(blob) || "";
  if (objectUrl) objectUrls.set(identity, objectUrl);
  return objectUrl;
}

function rememberIdentity(profile = {}, identity = "") {
  if (!identity) return;
  const index = readIndex();
  const entry = { identity, updatedAt: Date.now() };
  if (String(profile?.id || "").trim()) index[profileKey(profile.id)] = entry;
  if (String(profile?.avatarId || "").trim()) index[avatarKey(profile.avatarId)] = entry;
  writeIndex(index);
}

/** Resolves a durable cached profile avatar without retaining remote URLs. */
export async function resolveBrowserProfileAvatar(
  profile = {},
  sourceUrl = "",
  { allowNetwork = true } = {}
) {
  if (!Platform.isBrowser()) return String(sourceUrl || "").trim();
  const identities = candidateIdentities(profile, sourceUrl);
  for (const identity of identities) {
    const cached = await getCachedObjectUrl(identity).catch(() => "");
    if (cached) return cached;
  }

  const identity = safeSourceIdentity(sourceUrl);
  if (!identity || !allowNetwork || globalThis.navigator?.onLine === false) return "";
  try {
    const response = await fetch(sourceUrl, { credentials: "omit" });
    const cached = await storeAvatar(identity, response);
    if (cached) rememberIdentity(profile, identity);
    return cached;
  } catch {
    return "";
  }
}

export async function removeBrowserProfileAvatar(profile = {}) {
  const index = readIndex();
  const keys = [profileKey(profile?.id), avatarKey(profile?.avatarId)].filter(
    (key) => !key.endsWith(":")
  );
  const identities = keys.map((key) => index[key]?.identity).filter(Boolean);
  keys.forEach((key) => delete index[key]);
  writeIndex(index);
  if (!globalThis.caches) return;
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(
    Array.from(new Set(identities)).map(async (identity) => {
      if (Object.values(index).some((entry) => entry?.identity === identity)) return;
      await cache.delete(cacheKey(identity));
      const objectUrl = objectUrls.get(identity);
      if (objectUrl) URL.revokeObjectURL?.(objectUrl);
      objectUrls.delete(identity);
    })
  );
}
