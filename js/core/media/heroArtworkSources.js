import { capTmdbImageSize } from "./tmdbImageSize.js";

function backdropSource(source) {
  return capTmdbImageSize(String(source || "").trim(), "heroBackdrop").replace(
    /(\/t\/p\/)w780\//i,
    "$1w1280/"
  );
}

// Home and Detail carry their own logo, so prefer artwork without printed text.
export function buildHeroBackdropSources(item = null) {
  return [
    ...new Set(
      [
        ...[
          item?.textlessBackdrop,
          item?.background,
          item?.backdrop,
          item?.backdropUrl,
          item?.landscapePoster
        ].map(backdropSource),
        item?.poster,
        item?.thumbnail,
        item?.episodeThumbnail
      ].filter(Boolean)
    )
  ];
}

export function heroImageFallbacks(display, activeSrc) {
  return [...new Set([display?.backdrop, ...(display?.backdropFallbacks || [])])].filter(
    (src) => src && src !== activeSrc
  );
}

export function heroTargetData(item) {
  return {
    itemId: item?.id || "",
    itemType: item?.type || item?.apiType || "movie",
    itemTitle: item?.name || "Untitled",
    posterSrc: item?.poster || "",
    backdropSrc: buildHeroBackdropSources(item)[0] || "",
    addonBaseUrl: item?.addonBaseUrl || "",
    addonId: item?.addonId || "",
    addonName: item?.addonName || "",
    catalogType: item?.catalogType || item?.type || item?.apiType || "movie"
  };
}

export function renderHeroTargetAttributes(item, escapeAttribute) {
  return Object.entries(heroTargetData(item))
    .map(
      ([key, value]) =>
        `data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}="${escapeAttribute(value)}"`
    )
    .join(" ");
}
