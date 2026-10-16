import { safeApiCall } from "../../core/network/safeApiCall.js";
import { CatalogApi } from "../remote/api/catalogApi.js";
import { addonRepository } from "./addonRepository.js";

const ADDON_POSTER_SHAPES = ["poster", "landscape", "square"];

/**
 * The shape an addon declares for a catalog entry, or "" when it declares
 * nothing.
 *
 * Empty is the useful answer for silence: most addons say nothing at all, and
 * a default invented here would be indistinguishable from an addon actually
 * asking for portrait. Whoever reads this needs to tell those apart.
 */
export function normalizeAddonPosterShape(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return ADDON_POSTER_SHAPES.includes(normalized) ? normalized : "";
}

class CatalogRepository {
  constructor() {
    this.catalogCache = new Map();
  }

  async getCatalog({
    addonBaseUrl,
    addonId,
    addonName,
    catalogId,
    catalogName,
    type,
    skip = 0,
    extraArgs = {},
    supportsSkip = true,
    signal = null
  }) {
    const cacheKey = this.buildCacheKey({
      addonId,
      type,
      catalogId,
      skip,
      extraArgs
    });

    const cached = this.catalogCache.get(cacheKey);
    if (cached) {
      return {
        status: "success",
        data: cached
      };
    }

    const url = this.buildCatalogUrl({
      baseUrl: addonBaseUrl,
      type,
      catalogId,
      skip,
      extraArgs
    });

    return safeApiCall(() =>
      CatalogApi.getCatalog(url, signal ? { signal } : {}).then((dto) => {
        const metas = Array.isArray(dto?.metas) ? dto.metas : [];
        const items = metas
          .filter(
            (meta) =>
              meta &&
              typeof meta === "object" &&
              String(meta.id || "").trim() &&
              String(meta.name || "").trim()
          )
          .map((meta) => ({
            ...this.mapMeta(meta),
            addonBaseUrl,
            addonId,
            addonName,
            catalogType: type
          }));

        const row = {
          addonId,
          addonName,
          addonBaseUrl,
          catalogId,
          catalogName,
          apiType: type,
          items,
          isLoading: false,
          hasMore: Boolean(supportsSkip && metas.length > 0),
          currentPage: Math.floor(skip / 100),
          supportsSkip
        };

        this.catalogCache.set(cacheKey, row);
        return row;
      })
    );
  }

  buildCatalogUrl({ baseUrl, type, catalogId, skip = 0, extraArgs = {} }) {
    const cleanBaseUrl = addonRepository.canonicalizeUrl(baseUrl);
    const queryStart = cleanBaseUrl.indexOf("?");
    const basePath =
      queryStart >= 0 ? cleanBaseUrl.slice(0, queryStart).replace(/\/+$/, "") : cleanBaseUrl;
    const baseQuery = queryStart >= 0 ? cleanBaseUrl.slice(queryStart) : "";
    const args = { ...extraArgs };

    if (Object.keys(args).length === 0) {
      return skip > 0
        ? `${basePath}/catalog/${type}/${catalogId}/skip=${skip}.json${baseQuery}`
        : `${basePath}/catalog/${type}/${catalogId}.json${baseQuery}`;
    }

    if (skip > 0 && !Object.prototype.hasOwnProperty.call(args, "skip")) {
      args.skip = String(skip);
    }

    const query = Object.entries(args)
      .map(([key, value]) => `${this.encodeArg(key)}=${this.encodeArg(String(value))}`)
      .join("&");

    return `${basePath}/catalog/${type}/${catalogId}/${query}.json${baseQuery}`;
  }

  buildCacheKey({ addonId, type, catalogId, skip = 0, extraArgs = {} }) {
    const normalizedArgs = Object.entries(extraArgs)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join("&");

    return `${addonId}_${type}_${catalogId}_${skip}_${normalizedArgs}`;
  }

  encodeArg(value) {
    return encodeURIComponent(value).replace(/\+/g, "%20");
  }

  mapMeta(meta = {}) {
    return {
      id: meta.id || "",
      name: meta.name || "Untitled",
      type: meta.type || "",
      poster: meta.poster || null,
      background: meta.background || null,
      logo: meta.logo || null,
      description: meta.description || "",
      releaseInfo: meta.releaseInfo || "",
      genres: Array.isArray(meta.genres) ? meta.genres : [],
      // The shape an addon says its artwork is. It is part of the meta object
      // every catalog returns, and this mapper used to drop it along with
      // everything else it did not name -- so an addon could ask for landscape
      // artwork all it liked and nothing downstream could ever have known.
      posterShape: normalizeAddonPosterShape(meta.posterShape)
    };
  }
}

export const catalogRepository = new CatalogRepository();
