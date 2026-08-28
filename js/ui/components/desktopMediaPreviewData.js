import { metaRepository } from "../../data/repository/metaRepository.js";

function withTimeout(promise, ms, fallbackValue) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallbackValue), ms);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function resolveYoutubeId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  const match = raw.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/i);
  return match?.[1] || "";
}

export function resolveDesktopMediaTrailerSource(meta = {}) {
  const entries = [
    ...(Array.isArray(meta.trailers) ? meta.trailers : []),
    ...(Array.isArray(meta.videos) ? meta.videos : [])
  ];
  for (const entry of entries) {
    const ytId = resolveYoutubeId(
      entry?.ytId || entry?.youtubeId || entry?.source || entry?.url || entry?.link
    );
    if (ytId) return { kind: "youtube", ytId };
  }
  const ytId = resolveYoutubeId(Array.isArray(meta.trailerYtIds) ? meta.trailerYtIds[0] : "");
  return ytId ? { kind: "youtube", ytId } : null;
}

export async function resolveDesktopMediaPreviewMetadata(item) {
  const itemId = String(item?.id || "").trim();
  const itemType = String(item?.type || item?.apiType || "movie").trim() || "movie";
  if (!itemId) return null;
  const result = await withTimeout(
    metaRepository.getMetaFromAllAddons(itemType, itemId),
    4000,
    { status: "error", message: "timeout" }
  ).catch(() => ({ status: "error" }));
  if (result?.status !== "success" || !result.data) return null;
  const meta = result.data;
  return {
    ...meta,
    id: itemId,
    type: meta.type || itemType,
    name: meta.name || meta.title || item.name,
    description: meta.description || meta.overview || "",
    imdbRating: meta.imdbRating ?? meta.imdb_rating ?? meta.rating ?? null,
    genres: Array.isArray(meta.genres) ? meta.genres : []
  };
}
