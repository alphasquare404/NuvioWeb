const HOVER_DELAY_MS = 3000;
const CLOSE_GRACE_MS = 160;
const YOUTUBE_IFRAME_API_URL = "https://www.youtube.com/iframe_api";
let youtubeIframeApiPromise = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function canUseHoverPreview() {
  return Boolean(window.matchMedia?.("(hover: hover) and (pointer: fine)").matches);
}

function formatTypeLabel(type) {
  const normalized = String(type || "").trim().toLowerCase();
  return ["series", "show", "tv"].includes(normalized) ? "Series" : "Movie";
}

function formatGenres(genres) {
  return Array.isArray(genres)
    ? genres.map((genre) => String(genre || "").trim()).filter(Boolean).slice(0, 3).join(" · ")
    : "";
}

function logAudioDebug(marker, details = {}) {
  if (globalThis.__NUVIO_HOVER_PREVIEW_DEBUG__ !== true) return;
  console.info(`[hover-preview] audio ${marker}`, details);
}

function getBrowserOrigin() {
  const origin = String(globalThis.location?.origin || "").trim();
  return /^https?:\/\//i.test(origin) ? origin : "";
}

function loadYoutubeIframeApi() {
  if (globalThis.YT?.Player) return Promise.resolve(globalThis.YT);
  if (youtubeIframeApiPromise) return youtubeIframeApiPromise;

  youtubeIframeApiPromise = new Promise((resolve, reject) => {
    const previousReady = globalThis.onYouTubeIframeAPIReady;
    let settled = false;
    let timeoutId = 0;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      callback(value);
    };
    globalThis.onYouTubeIframeAPIReady = (...args) => {
      try { previousReady?.(...args); } catch (_) {}
      settle(resolve, globalThis.YT);
    };
    const existingScript = document.querySelector(`script[src="${YOUTUBE_IFRAME_API_URL}"]`);
    const script = existingScript || document.createElement("script");
    if (!existingScript) {
      script.src = YOUTUBE_IFRAME_API_URL;
      script.async = true;
      document.head.append(script);
    }
    script.addEventListener("error", () => settle(reject, new Error("youtube-iframe-api-load-failed")), {
      once: true
    });
    timeoutId = setTimeout(
      () => settle(reject, new Error("youtube-iframe-api-timeout")),
      15000
    );
  });
  return youtubeIframeApiPromise;
}

export function createDesktopMediaHoverPreview({ getItem, openDetail, resolveTrailer, resolveMetadata } = {}) {
  let homeContainer = null;
  let sourceNode = null;
  let previewNode = null;
  let openTimer = 0;
  let closeTimer = 0;
  let generation = 0;
  const trailerCache = new Map();
  const metadataCache = new Map();
  const trailerPlayerCleanup = new WeakMap();

  const isSourceCard = (node) =>
    node instanceof HTMLElement &&
    node.matches(".home-modern-catalogs .home-poster-card.focusable:not(.home-collection-card)") &&
    String(node.dataset.action || "") === "openDetail";
  const cancelOpen = () => { if (openTimer) clearTimeout(openTimer); openTimer = 0; };
  const cancelClose = () => { if (closeTimer) clearTimeout(closeTimer); closeTimer = 0; };
  const stopTrailer = () => {
    if (!previewNode) return;
    trailerPlayerCleanup.get(previewNode)?.();
    trailerPlayerCleanup.delete(previewNode);
  };
  const mountTrailer = (node, item, source) => {
    const media = node.querySelector(".desktop-media-hover-preview-media");
    if (!media || !source?.ytId) return;
    media.innerHTML = `<div class="desktop-media-hover-preview-youtube-host" aria-label="${escapeHtml(item.name || "Media")} trailer"></div><div class="desktop-media-hover-preview-trailer-controls"><button type="button" class="desktop-media-hover-preview-audio" data-hover-preview-audio aria-label="Unmute trailer" title="Unmute trailer" disabled><span class="material-icons" aria-hidden="true">volume_off</span></button></div>`;
    const host = media.querySelector(".desktop-media-hover-preview-youtube-host");
    const audioButton = media.querySelector("[data-hover-preview-audio]");
    let muted = true;
    let playerReady = false;
    let disposed = false;
    let player = null;
    const setTrailerMutedState = (nextMuted, reason) => {
      muted = Boolean(nextMuted);
      const label = muted ? "Unmute trailer" : "Mute trailer";
      audioButton.setAttribute("aria-label", label);
      audioButton.title = label;
      audioButton.querySelector(".material-icons").textContent = muted ? "volume_off" : "volume_up";
      logAudioDebug(`audio state -> ${muted ? "muted" : "unmuted"} [${reason}]`, {
        muted,
        volume: Number(player?.getVolume?.() || 0)
      });
    };
    setTrailerMutedState(true, "initial");
    trailerPlayerCleanup.set(node, () => {
      disposed = true;
      playerReady = false;
      audioButton.disabled = true;
      try { player?.stopVideo?.(); } catch (_) {}
      try { player?.destroy?.(); } catch (_) {}
      player = null;
      setTrailerMutedState(true, "cleanup");
    });
    audioButton?.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      const rect = audioButton.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const topElement = document.elementFromPoint(centerX, centerY);
      logAudioDebug("pointerdown", {
        topElement: topElement?.className || topElement?.tagName || "none",
        topElementIsButton: topElement === audioButton || audioButton.contains(topElement)
      });
    });
    audioButton?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!playerReady || !player) return;
      const before = { muted: Boolean(player.isMuted()), volume: Number(player.getVolume()) };
      logAudioDebug("before audio toggle", before);
      if (muted) {
        player.setVolume(100);
        player.unMute();
        setTrailerMutedState(false, "user click");
      } else {
        player.mute();
        setTrailerMutedState(true, "user click");
      }
      setTimeout(() => {
        if (!disposed && playerReady && player) {
          logAudioDebug("after audio toggle", {
            muted: Boolean(player.isMuted()),
            volume: Number(player.getVolume())
          });
        }
      }, 100);
    });
    void loadYoutubeIframeApi()
      .then((YT) => {
        if (disposed || previewNode !== node || !host) return;
        player = new YT.Player(host, {
          videoId: source.ytId,
          playerVars: {
            autoplay: 1,
            enablejsapi: 1,
            controls: 0,
            loop: 1,
            playlist: source.ytId,
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
            origin: getBrowserOrigin()
          },
          events: {
            onReady: (event) => {
              if (disposed || previewNode !== node) return;
              player = event.target;
              const iframe = player.getIframe?.();
              if (iframe instanceof HTMLIFrameElement) {
                iframe.allow = "autoplay; encrypted-media; picture-in-picture";
                iframe.allowFullscreen = true;
              }
              player.mute();
              player.setVolume(100);
              player.playVideo();
              playerReady = true;
              // We explicitly mute at startup. Do not replace this known state
              // with YouTube's early isMuted() result before a user action.
              setTrailerMutedState(true, "player ready");
              audioButton.disabled = false;
              logAudioDebug("youtube ready", { muted, volume: Number(player.getVolume()) });
            },
            onError: () => {
              if (disposed) return;
              audioButton.title = "Trailer controls unavailable";
              audioButton.setAttribute("aria-label", "Trailer controls unavailable");
            }
          }
        });
      })
      .catch(() => {
        if (disposed) return;
        audioButton.title = "Trailer controls unavailable";
        audioButton.setAttribute("aria-label", "Trailer controls unavailable");
      });
  };
  const close = () => {
    cancelOpen(); cancelClose(); generation += 1;
    sourceNode?.classList?.remove("desktop-hover-preview-active");
    sourceNode = null;
    if (!previewNode) return;
    stopTrailer();
    const closingNode = previewNode;
    previewNode = null;
    closingNode.classList.add("is-closing");
    setTimeout(() => closingNode.remove(), 180);
  };
  const scheduleClose = () => { cancelClose(); closeTimer = setTimeout(close, CLOSE_GRACE_MS); };
  const position = (card) => {
    if (!previewNode || !card?.isConnected) return;
    const rect = card.getBoundingClientRect();
    const width = Math.min(450, Math.max(320, window.innerWidth - 32));
    const left = Math.max(16, Math.min(rect.left, window.innerWidth - width - 16));
    const height = previewNode.offsetHeight || 370;
    // Start at the source poster and only move as much as viewport bounds require.
    // This makes the portal read as the card itself expanding forward.
    const navbarClearance = 72;
    const top = Math.max(
      navbarClearance,
      Math.min(rect.top, window.innerHeight - height - 16)
    );
    previewNode.style.cssText += `width:${width}px;left:${Math.round(left)}px;top:${Math.round(top)}px;`;
  };
  const renderCopy = (node, item, subtitle = "") => {
    const type = formatTypeLabel(item.type || item.apiType);
    const meta = [type, subtitle].filter(Boolean).join(" · ");
    const rating = item.imdbRating ? `IMDb ${escapeHtml(item.imdbRating)}` : "";
    const genres = formatGenres(item.genres);
    const overview = String(item.description || item.overview || "").trim();
    node.querySelector(".desktop-media-hover-preview-copy").innerHTML = `
      <h2>${escapeHtml(item.name || item.title || "Untitled")}</h2>
      ${meta ? `<p class="desktop-media-hover-preview-meta">${escapeHtml(meta)}</p>` : ""}
      ${rating || genres ? `<p class="desktop-media-hover-preview-facts">${[rating, genres ? escapeHtml(genres) : ""].filter(Boolean).join("<span aria-hidden=\"true\"> • </span>")}</p>` : ""}
      ${overview ? `<p class="desktop-media-hover-preview-overview">${escapeHtml(overview)}</p>` : ""}
      <div class="desktop-media-hover-preview-actions"><button type="button" class="desktop-media-hover-preview-primary" data-hover-preview-details><span class="material-icons">info</span>View Details</button><button type="button" class="desktop-media-hover-preview-secondary" data-hover-preview-trailer><span class="material-icons">play_arrow</span>Play Trailer</button></div>`;
  };
  const render = (card) => {
    const item = getItem?.(card);
    if (!item?.id || !card?.isConnected) return;
    close(); sourceNode = card;
    card.classList.add("desktop-hover-preview-active");
    const subtitle = card.querySelector(".home-poster-subtitle")?.textContent?.trim() || "";
    const mediaSrc = item.background || item.backdrop || item.poster || "";
    const token = ++generation;
    const node = document.createElement("aside");
    node.className = "desktop-media-hover-preview";
    node.setAttribute("aria-label", `${item.name || "Media"} preview`);
    node.innerHTML = `<div class="desktop-media-hover-preview-media">${mediaSrc ? `<img src="${escapeHtml(mediaSrc)}" alt="" />` : '<div class="desktop-media-hover-preview-placeholder"></div>'}<div class="desktop-media-hover-preview-media-layer"></div></div><div class="desktop-media-hover-preview-copy"></div>`;
    renderCopy(node, item, subtitle);
    document.body.append(node); previewNode = node; position(card); requestAnimationFrame(() => node.classList.add("is-open"));
    node.addEventListener("pointerenter", cancelClose);
    node.addEventListener("pointerleave", (event) => { if (!sourceNode?.contains(event.relatedTarget)) scheduleClose(); });
    node.querySelector("[data-hover-preview-details]")?.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); close(); openDetail?.(card); });
    node.querySelector("[data-hover-preview-trailer]")?.addEventListener("click", async (event) => {
      event.preventDefault(); event.stopPropagation();
      const button = event.currentTarget; button.disabled = true; button.textContent = "Loading trailer…";
      const key = `${item.type || "movie"}:${item.id}`;
      let source = trailerCache.get(key);
      if (!source) { source = await resolveTrailer?.(item); if (source) trailerCache.set(key, source); }
      if (token !== generation || previewNode !== node) return;
      if (!source?.embedUrl) { button.textContent = "Trailer unavailable"; return; }
      mountTrailer(node, item, source);
    });
    const metadataKey = `${String(item.type || item.apiType || "movie").toLowerCase()}:${item.id}`;
    const metadataPromise = metadataCache.get(metadataKey) || resolveMetadata?.(item);
    if (metadataPromise) {
      metadataCache.set(metadataKey, metadataPromise);
      Promise.resolve(metadataPromise)
        .then((metadata) => {
          if (token !== generation || previewNode !== node || !metadata) return;
          const enrichedItem = {
            ...item,
            ...metadata,
            // The card's data-item-type is the route/activation type and remains
            // authoritative even when a metadata addon uses a different alias.
            type: item.type || item.apiType || metadata.type
          };
          renderCopy(node, enrichedItem, subtitle);
          position(card);
          // Rebind actions after the copy refresh without changing the activation path.
          node.querySelector("[data-hover-preview-details]")?.addEventListener("click", (event) => {
            event.preventDefault(); event.stopPropagation(); close(); openDetail?.(card);
          });
          node.querySelector("[data-hover-preview-trailer]")?.addEventListener("click", async (event) => {
            event.preventDefault(); event.stopPropagation();
            const button = event.currentTarget; button.disabled = true; button.textContent = "Loading trailer…";
            const key = `${item.type || "movie"}:${item.id}`;
            let source = trailerCache.get(key);
            if (!source) { source = await resolveTrailer?.(enrichedItem); if (source) trailerCache.set(key, source); }
            if (token !== generation || previewNode !== node) return;
            if (!source?.embedUrl) { button.textContent = "Trailer unavailable"; return; }
            mountTrailer(node, enrichedItem, source);
          });
        })
        .catch(() => {});
    }
  };
  const scheduleOpen = (card) => {
    if (!canUseHoverPreview() || !isSourceCard(card)) return;
    cancelClose(); if (sourceNode === card && previewNode) return;
    if (previewNode && sourceNode !== card) close();
    cancelOpen(); sourceNode = card;
    openTimer = setTimeout(() => { openTimer = 0; if (sourceNode === card && card.matches(":hover")) render(card); }, HOVER_DELAY_MS);
  };
  const onPointerOver = (event) => {
    const card = event.target instanceof Element ? event.target.closest(".home-poster-card") : null;
    if (!isSourceCard(card) || card.contains(event.relatedTarget)) return;
    scheduleOpen(card);
  };
  const onPointerOut = (event) => {
    const card = event.target instanceof Element ? event.target.closest(".home-poster-card") : null;
    if (!isSourceCard(card) || card.contains(event.relatedTarget) || previewNode?.contains(event.relatedTarget)) return;
    cancelOpen(); if (sourceNode === card) scheduleClose();
  };
  const onPointerDown = (event) => {
    const card = event.target instanceof Element ? event.target.closest(".home-poster-card") : null;
    if (isSourceCard(card)) close();
  };
  const onKeyDown = (event) => { if (event.key === "Escape" && previewNode) { event.preventDefault(); event.stopPropagation(); close(); } };
  const onViewportChange = () => { if (previewNode && sourceNode) position(sourceNode); };
  const destroy = () => {
    homeContainer?.removeEventListener("pointerover", onPointerOver); homeContainer?.removeEventListener("pointerout", onPointerOut); homeContainer?.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("keydown", onKeyDown); window.removeEventListener("resize", onViewportChange); window.removeEventListener("scroll", onViewportChange, true);
    homeContainer = null; close();
  };
  const bind = (container) => {
    if (!canUseHoverPreview() || homeContainer === container) return;
    destroy(); homeContainer = container;
    homeContainer.addEventListener("pointerover", onPointerOver); homeContainer.addEventListener("pointerout", onPointerOut); homeContainer.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown); window.addEventListener("resize", onViewportChange, { passive: true }); window.addEventListener("scroll", onViewportChange, true);
  };
  return { bind, destroy, cancelForDrag: close };
}
