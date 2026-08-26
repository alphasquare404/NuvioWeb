import { renderLoadingIndicator } from "./loadingIndicator.js";

let activeSession = null;

function modalEmbedUrl(source = {}) {
  const videoId = String(source?.ytId || "").trim();
  if (videoId) {
    const params = new URLSearchParams({
      autoplay: "1",
      mute: "1",
      controls: "1",
      fs: "1",
      playsinline: "1",
      enablejsapi: "1",
      rel: "0",
      cc_load_policy: "0",
      modestbranding: "1"
    });
    const origin = String(globalThis.location?.origin || "").trim();
    if (/^https?:\/\//i.test(origin)) params.set("origin", origin);
    return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`;
  }
  const raw = String(source?.embedUrl || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, globalThis.location?.href || undefined);
    // The resolver owns the endpoint (including a configured proxy). The modal
    // only changes presentation/player flags for this explicit viewer.
    url.searchParams.set("autoplay", "1");
    url.searchParams.set("mute", "1");
    url.searchParams.set("muted", "1");
    url.searchParams.set("controls", "1");
    url.searchParams.set("fs", "1");
    url.searchParams.set("loop", "0");
    url.searchParams.delete("playlist");
    return url.toString();
  } catch (_) {
    return raw;
  }
}

function destroySession(session, { notify = true } = {}) {
  if (!session || activeSession !== session) return false;
  activeSession = null;
  window.removeEventListener("keydown", session.keydownHandler, true);
  session.backdrop.removeEventListener("click", session.backdropHandler);
  session.closeButton.removeEventListener("click", session.closeHandler);
  const frame = session.modal.querySelector("iframe");
  if (frame) {
    try { frame.src = "about:blank"; } catch (_) {}
    frame.removeAttribute("src");
  }
  const video = session.modal.querySelector("video");
  if (video) {
    try { video.pause(); video.removeAttribute("src"); video.load(); } catch (_) {}
  }
  session.backdrop.remove();
  document.body?.classList?.remove("detail-trailer-modal-open");
  if (notify) session.onClose?.();
  return true;
}

export function closeDesktopTrailerModal({ notify = true } = {}) {
  return destroySession(activeSession, { notify });
}

export function openDesktopTrailerModal({ source, title = "Trailer", onClose } = {}) {
  if (!source || typeof document === "undefined") return null;
  closeDesktopTrailerModal({ notify: false });
  const backdrop = document.createElement("div");
  backdrop.className = "detail-trailer-modal-backdrop";
  const modal = document.createElement("section");
  modal.className = "detail-trailer-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "Play trailer");
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "detail-trailer-modal-close";
  closeButton.setAttribute("aria-label", "Close");
  closeButton.innerHTML = '<span aria-hidden="true">×</span>';
  const content = document.createElement("div");
  content.className = "detail-trailer-modal-content";
  content.innerHTML = `<div class="detail-trailer-modal-loading" role="status">${renderLoadingIndicator({ className: "player-loading-spinner-ring" })}<span>Loading trailer…</span></div>`;
  modal.append(closeButton, content);
  backdrop.append(modal);
  document.body.append(backdrop);
  document.body.classList.add("detail-trailer-modal-open");
  const session = { backdrop, modal, closeButton, onClose, keydownHandler: null, backdropHandler: null, closeHandler: null };
  activeSession = session;
  const close = () => destroySession(session);
  session.closeHandler = (event) => { event.preventDefault(); event.stopPropagation(); close(); };
  session.backdropHandler = (event) => { if (event.target === backdrop) close(); };
  session.keydownHandler = (event) => {
    if (event.key === "Escape" || Number(event.keyCode || 0) === 27) {
      event.preventDefault(); event.stopPropagation(); close();
    }
  };
  closeButton.addEventListener("click", session.closeHandler);
  backdrop.addEventListener("click", session.backdropHandler);
  window.addEventListener("keydown", session.keydownHandler, true);
  const fail = () => {
    if (activeSession !== session) return;
    content.innerHTML = '<div class="detail-trailer-modal-error" role="status">Trailer unavailable.</div>';
    setTimeout(() => destroySession(session), 1200);
  };
  if (source.kind === "youtube" && source.ytId) {
    const frameUrl = modalEmbedUrl(source);
    if (!frameUrl) { fail(); return session; }
    const frame = document.createElement("iframe");
    frame.className = "detail-trailer-modal-frame";
    frame.src = frameUrl;
    frame.title = `${title} trailer`;
    frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    frame.referrerPolicy = "origin-when-cross-origin";
    frame.allowFullscreen = true;
    frame.addEventListener("load", () => { if (activeSession === session) content.querySelector(".detail-trailer-modal-loading")?.remove(); });
    content.append(frame);
    return session;
  }
  if (source.kind === "video" && source.url) {
    const video = document.createElement("video");
    video.className = "detail-trailer-modal-video";
    video.src = source.url;
    video.autoplay = true; video.muted = true; video.controls = true; video.playsInline = true;
    video.addEventListener("canplay", () => { if (activeSession === session) content.querySelector(".detail-trailer-modal-loading")?.remove(); });
    video.addEventListener("error", fail, { once: true });
    content.append(video); video.play?.().catch(() => {});
    return session;
  }
  fail();
  return session;
}
