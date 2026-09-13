const CACHE_NAME = "nuvio-app-shell-__NUVIO_APP_VERSION__";
const LOCALE_ASSETS = __NUVIO_LOCALE_ASSETS__;
const APP_SHELL = [
  "./",
  "./index.html",
  "./boot-guard.js",
  "./assets/runtime/legacy-features.js",
  "./core-js.bundle.js",
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
  "./assets/icons/ic_player_play.svg",
  "./assets/icons/ic_player_pause.svg",
  "./assets/icons/ic_player_skip_next.svg",
  "./assets/icons/ic_player_subtitles.svg",
  "./assets/icons/ic_player_audio_filled.svg",
  "./assets/icons/ic_player_audio_outline.svg",
  "./assets/icons/ic_player_source.svg",
  "./assets/icons/ic_player_episodes.svg",
  "./assets/icons/ic_player_aspect_ratio.svg",
  "./assets/icons/ic_player_picture_in_picture.svg",
  "./assets/icons/ic_player_volume.svg",
  "./assets/icons/ic_player_volume_muted.svg",
  "./assets/icons/ic_player_fullscreen.svg",
  "./assets/icons/ic_player_fullscreen_exit.svg",
  "./assets/icons/ic_player_external.svg",
  "./assets/icons/ic_player_back.svg",
  "./assets/icons/ic_player_more.svg",
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

self.addEventListener("push", (event) => {
  let payload;
  try { payload = event.data?.json?.(); } catch (_) { return; }
  if (payload?.type !== "external-playback-return") return;
  const finished = payload.kind === "finished";
  event.waitUntil(self.registration.showNotification("NuvioWeb", {
    body: finished ? "Playback completed. Tap to return to NuvioWeb." : "Playback updated. Tap to return to NuvioWeb.",
    tag: "nuvio-external-playback-return",
    data: { type: "external-playback-return" }
  }));
});

self.addEventListener("notificationclick", (event) => {
  if (event.notification?.data?.type !== "external-playback-return") return;
  event.notification.close();
  event.waitUntil((async () => {
    const scope = self.registration.scope;
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = clients.find((client) => String(client.url || "").startsWith(scope));
    if (existing) return existing.focus();
    return self.clients.openWindow(scope);
  })());
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
  // Runtime deployment configuration must always be fetched from the active
  // container. Never return a stale value from the app-shell cache.
  if (url.pathname === "/nuvio.env.js") {
    event.respondWith(fetch(request));
    return;
  }
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
