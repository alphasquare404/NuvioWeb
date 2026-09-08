const CACHE_NAME = "nuvio-app-shell-__NUVIO_APP_VERSION__";
const LOCALE_ASSETS = __NUVIO_LOCALE_ASSETS__;
const APP_SHELL = [
  "./",
  "./index.html",
  "./boot-guard.js",
  "./assets/runtime/legacy-features.js",
  "./core-js.bundle.js",
  "./nuvio.env.js",
  "./app.bundle.js",
  "./css/base.css",
  "./css/layout.css",
  "./css/components.css",
  "./css/themes.css",
  "./css/desktop.css",
  "./manifest.webmanifest",
  "./assets/brand/nuvio-favicon.png",
  "./assets/brand/app_logo_wordmark.png",
  "./assets/brand/pwa-apple-touch-icon-180.png",
  "./assets/brand/pwa-icon-192.png",
  "./assets/brand/pwa-icon-512.png",
  "./assets/brand/pwa-icon-maskable-192.png",
  "./assets/brand/pwa-icon-maskable-512.png",
  "./assets/icons/imdb_logo_2016.svg",
  "./assets/libs/qrcode-generator.js",
  ...LOCALE_ASSETS
];

const GOOGLE_FONT_ORIGINS = new Set(["https://fonts.googleapis.com", "https://fonts.gstatic.com"]);
const MATERIAL_ICONS_STYLESHEET = "https://fonts.googleapis.com/icon?family=Material+Icons";

function cacheAppShell() {
  return caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL));
}

async function cacheGoogleFont(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok || response.type === "opaque") {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return cache.match(request);
  }
}

async function cacheMaterialIconAssets() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const stylesheetRequest = new Request(MATERIAL_ICONS_STYLESHEET);
    const response = await fetch(stylesheetRequest);
    if (!response.ok) return;
    await cache.put(stylesheetRequest, response.clone());
    const stylesheet = await response.text();
    const fontUrls = [...stylesheet.matchAll(/url\(([^)]+)\)/g)]
      .map((match) => match[1].trim().replace(/^['"]|['"]$/g, ""))
      .filter((url) => {
        try {
          return new URL(url).origin === "https://fonts.gstatic.com";
        } catch {
          return false;
        }
      });
    await Promise.all(
      fontUrls.map(async (fontUrl) => {
        const fontRequest = new Request(fontUrl);
        const fontResponse = await fetch(fontRequest);
        if (fontResponse.ok || fontResponse.type === "opaque") {
          await cache.put(fontRequest, fontResponse);
        }
      })
    );
  } catch {
    // The shell remains installable if the optional icon font is temporarily unavailable.
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    cacheAppShell()
      .then(cacheMaterialIconAssets)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys
      .filter((key) => key.startsWith("nuvio-app-shell-") && key !== CACHE_NAME)
      .map((key) => caches.delete(key)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (GOOGLE_FONT_ORIGINS.has(url.origin)) {
    event.respondWith(cacheGoogleFont(request));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("./index.html")));
    return;
  }
  if (!APP_SHELL.some((entry) => url.pathname.endsWith(entry.replace(/^\.\//, "")))) return;
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
        }
        return response;
      });
    })
  );
});
