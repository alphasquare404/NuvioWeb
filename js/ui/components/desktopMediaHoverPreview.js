const HOVER_DELAY_MS = 3000;
const CLOSE_GRACE_MS = 160;

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

function buildYoutubeViewerUrl(videoId) {
  const cleanId = String(videoId || "").trim();
  if (!cleanId) return "";
  const params = new URLSearchParams({
    autoplay: "1",
    mute: "1",
    controls: "1",
    fs: "1",
    playsinline: "1",
    enablejsapi: "1",
    rel: "0"
  });
  const origin = String(globalThis.location?.origin || "").trim();
  if (/^https?:\/\//i.test(origin)) params.set("origin", origin);
  return `https://www.youtube.com/embed/${encodeURIComponent(cleanId)}?${params.toString()}`;
}

export function createDesktopMediaHoverPreview({
  getItem,
  openDetail,
  resolveTrailer,
  resolveMetadata,
  getLibraryMembership,
  toggleLibrary,
  openLibraryDestinationMenu,
  subscribeLibrarySource,
  cardSelector = ".home-modern-catalogs .home-poster-card.focusable:not(.home-collection-card)",
  subtitleSelector = ".home-poster-subtitle"
} = {}) {
  let homeContainer = null;
  let sourceNode = null;
  let previewNode = null;
  let openTimer = 0;
  let closeTimer = 0;
  let generation = 0;
  const trailerCache = new Map();
  const metadataCache = new Map();
  const trailerPlayerCleanup = new WeakMap();
  let unsubscribeLibrarySource = null;
  let libraryHoldTimer = 0;
  let libraryHold = null;
  let suppressLibraryClick = false;
  let libraryRequestToken = 0;

  const isSourceCard = (node) =>
    node instanceof HTMLElement &&
    node.matches(cardSelector) &&
    String(node.dataset.action || "") === "openDetail";
  const cancelOpen = () => { if (openTimer) clearTimeout(openTimer); openTimer = 0; };
  const cancelClose = () => { if (closeTimer) clearTimeout(closeTimer); closeTimer = 0; };
  const stopTrailer = () => {
    if (!previewNode) return;
    trailerPlayerCleanup.get(previewNode)?.();
    trailerPlayerCleanup.delete(previewNode);
  };
  const mountTrailerViewer = (node, item, source) => {
    const media = node.querySelector(".desktop-media-hover-preview-media");
    const frameUrl = buildYoutubeViewerUrl(source?.ytId);
    if (!media || !frameUrl) return;
    const frame = document.createElement("iframe");
    frame.className = "desktop-media-hover-preview-youtube-viewer";
    frame.src = frameUrl;
    frame.title = `${item.name || "Media"} trailer`;
    frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    frame.referrerPolicy = "origin-when-cross-origin";
    frame.allowFullscreen = true;
    media.replaceChildren(frame);
    trailerPlayerCleanup.set(node, () => {
      try { frame.src = "about:blank"; } catch (_) {}
      frame.removeAttribute("src");
      frame.remove();
    });
  };
  const close = () => {
    cancelOpen(); cancelClose(); generation += 1;
    libraryRequestToken += 1;
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
    const availableWidth = window.innerWidth - 32;
    const width = availableWidth >= 480 ? Math.min(520, availableWidth) : Math.max(320, availableWidth);
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
      <div class="desktop-media-hover-preview-actions"><button type="button" class="desktop-media-hover-preview-primary" data-hover-preview-details><span class="material-icons">info</span>View Details</button>${typeof resolveTrailer === "function" ? '<button type="button" class="desktop-media-hover-preview-secondary" data-hover-preview-trailer><span class="material-icons">play_arrow</span>Play Trailer</button>' : ""}${typeof getLibraryMembership === "function" && typeof toggleLibrary === "function" ? '<button type="button" class="desktop-media-hover-preview-library" data-hover-preview-library aria-label="Add to Library" title="Add to Library"><span class="material-icons">add</span></button>' : ""}</div>`;
  };
  const refreshLibraryButton = async (node, item, token) => {
    const button = node?.querySelector?.("[data-hover-preview-library]");
    if (!button || !getLibraryMembership) return;
    button.disabled = true;
    const requestToken = ++libraryRequestToken;
    const membership = await getLibraryMembership(item).catch(() => null);
    if (token !== generation || requestToken !== libraryRequestToken || previewNode !== node || !membership) return;
    const saved = Boolean(membership.isSaved);
    button.innerHTML = `<span class="material-icons">${saved ? "check" : "add"}</span>`;
    button.setAttribute("aria-label", saved ? "Remove from Library" : "Add to Library");
    button.title = saved ? "Remove from Library" : "Add to Library";
    button.disabled = false;
  };
  const bindActions = (node, item, token) => {
    node.querySelector("[data-hover-preview-details]")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const card = sourceNode;
      if (!card?.isConnected) return;
      openDetail?.(card);
    });
    node.querySelector("[data-hover-preview-trailer]")?.addEventListener("click", async (event) => {
      event.preventDefault(); event.stopPropagation();
      const button = event.currentTarget; button.disabled = true; button.textContent = "Loading trailer…";
      const key = `${item.type || "movie"}:${item.id}`;
      let source = trailerCache.get(key);
      if (!source) { source = await resolveTrailer?.(item); if (source) trailerCache.set(key, source); }
      if (token !== generation || previewNode !== node) return;
      if (!source?.ytId) { button.textContent = "Trailer unavailable"; return; }
      mountTrailerViewer(node, item, source);
    });
    node.querySelector("[data-hover-preview-library]")?.addEventListener("click", async (event) => {
      event.preventDefault(); event.stopPropagation();
      const button = event.currentTarget;
      if (suppressLibraryClick) { suppressLibraryClick = false; return; }
      if (!toggleLibrary || button.disabled) return;
      button.disabled = true;
      await toggleLibrary(item).catch(() => {});
      await refreshLibraryButton(node, item, token);
    });
    const libraryButton = node.querySelector("[data-hover-preview-library]");
    libraryButton?.addEventListener("pointerdown", (event) => {
      const isPrimaryMouse = event.pointerType === "mouse" && Number(event.button) === 0;
      const isTouch = event.pointerType === "touch";
      if (!isPrimaryMouse && !isTouch) return;
      libraryHold = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, triggered: false };
      libraryHoldTimer = setTimeout(() => {
        if (!libraryHold || libraryHold.pointerId !== event.pointerId) return;
        libraryHold.triggered = true; suppressLibraryClick = true;
        void openLibraryDestinationMenu?.(item, () => refreshLibraryButton(node, item, token));
      }, 550);
    });
    const stopHold = (event) => {
      if (!libraryHold || event.pointerId !== libraryHold.pointerId) return;
      clearTimeout(libraryHoldTimer); libraryHoldTimer = 0; libraryHold = null;
    };
    libraryButton?.addEventListener("pointerup", stopHold);
    libraryButton?.addEventListener("pointercancel", stopHold);
    libraryButton?.addEventListener("pointermove", (event) => {
      if (!libraryHold || event.pointerId !== libraryHold.pointerId || libraryHold.triggered) return;
      if (Math.hypot(event.clientX - libraryHold.x, event.clientY - libraryHold.y) > 10) stopHold(event);
    });
    void refreshLibraryButton(node, item, token);
  };
  const render = (card) => {
    const item = getItem?.(card);
    if (!item?.id || !card?.isConnected) return;
    close(); sourceNode = card;
    card.classList.add("desktop-hover-preview-active");
    const subtitle = card.querySelector(subtitleSelector)?.textContent?.trim() || "";
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
    bindActions(node, item, token);
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
          bindActions(node, enrichedItem, token);
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
    const card = event.target instanceof Element ? event.target.closest(cardSelector) : null;
    if (!isSourceCard(card) || card.contains(event.relatedTarget)) return;
    scheduleOpen(card);
  };
  const onPointerOut = (event) => {
    const card = event.target instanceof Element ? event.target.closest(cardSelector) : null;
    if (!isSourceCard(card) || card.contains(event.relatedTarget) || previewNode?.contains(event.relatedTarget)) return;
    cancelOpen(); if (sourceNode === card) scheduleClose();
  };
  const onPointerDown = (event) => {
    const card = event.target instanceof Element ? event.target.closest(cardSelector) : null;
    if (isSourceCard(card)) close();
  };
  const onKeyDown = (event) => { if (event.key === "Escape" && previewNode) { event.preventDefault(); event.stopPropagation(); close(); } };
  const onViewportChange = () => { if (previewNode && sourceNode) position(sourceNode); };
  const destroy = () => {
    homeContainer?.removeEventListener("pointerover", onPointerOver); homeContainer?.removeEventListener("pointerout", onPointerOut); homeContainer?.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("keydown", onKeyDown); window.removeEventListener("resize", onViewportChange); window.removeEventListener("scroll", onViewportChange, true);
    homeContainer = null; close();
    unsubscribeLibrarySource?.(); unsubscribeLibrarySource = null;
  };
  const bind = (container) => {
    if (!canUseHoverPreview() || homeContainer === container) return;
    destroy(); homeContainer = container;
    unsubscribeLibrarySource = subscribeLibrarySource?.(() => {
      if (previewNode && sourceNode) void refreshLibraryButton(previewNode, getItem?.(sourceNode), generation);
    }) || null;
    homeContainer.addEventListener("pointerover", onPointerOver); homeContainer.addEventListener("pointerout", onPointerOut); homeContainer.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown); window.addEventListener("resize", onViewportChange, { passive: true }); window.addEventListener("scroll", onViewportChange, true);
  };
  return { bind, destroy, cancelForDrag: close };
}
