// The pure list half of the stream screen: how a stream result is flattened,
// how two sightings of one stream are merged, and what makes them the same
// stream. No screen state, no rendering, no router -- which is what lets the
// background resolver build the same list the screen would have built, without
// a screen.

import { DirectDebridResolver } from "../debrid/directDebridResolver.js";

function isMagnetUrl(value = "") {
  return String(value || "")
    .trim()

    .toLowerCase()

    .startsWith("magnet:");
}

function streamDebridIdentity(item = {}) {
  const resolve = item.clientResolve || item.raw?.clientResolve || {};

  const behaviorHints = item.behaviorHints || item.raw?.behaviorHints || {};

  const infoHash = item.infoHash || item.raw?.infoHash || resolve.infoHash || "";

  const magnetUri =
    resolve.magnetUri ||
    (isMagnetUrl(item.url) ? item.url : "") ||
    (isMagnetUrl(item.externalUrl) ? item.externalUrl : "");

  const hasDebridMarker = Boolean(
    item.clientResolve ||
    item.raw?.clientResolve ||
    item.debridCacheStatus ||
    item.raw?.debridCacheStatus ||
    infoHash ||
    magnetUri
  );

  if (!hasDebridMarker) {
    return "";
  }

  const locator = infoHash || magnetUri || item.url || item.externalUrl || item.ytId || "";

  if (!locator) {
    return "";
  }

  return [
    String(item.addonName || "Addon"),

    String(
      resolve.service ||
        item.debridCacheStatus?.providerId ||
        item.raw?.debridCacheStatus?.providerId ||
        ""
    ),

    String(locator),

    String(resolve.fileIdx ?? item.fileIdx ?? item.raw?.fileIdx ?? ""),

    String(behaviorHints.filename || resolve.filename || ""),

    String(resolve.torrentName || "")
  ].join("::");
}

export function streamMergeKey(item = {}) {
  const debridIdentity = streamDebridIdentity(item);

  if (debridIdentity) {
    return `debrid::${debridIdentity}`;
  }

  const locator = item.url || item.externalUrl || item.ytId || "";

  if (!locator) {
    return "";
  }

  return [
    String(item.addonName || "Addon"),

    String(locator),

    String(item.sourceType || ""),

    String(item.fileIdx ?? ""),

    String(item.behaviorHints?.filename || "")
  ].join("::");
}

function mergeStreamItem(previous = {}, next = {}) {
  const behaviorHints = {
    ...(previous.behaviorHints || {}),

    ...(next.behaviorHints || {})
  };

  return {
    ...previous,

    ...next,

    id: previous.id || next.id,

    url: next.url || previous.url || null,

    externalUrl: next.externalUrl || previous.externalUrl || null,

    ytId: next.ytId || previous.ytId || null,

    behaviorHints: Object.keys(behaviorHints).length ? behaviorHints : null,

    subtitles:
      Array.isArray(next.subtitles) && next.subtitles.length ? next.subtitles : previous.subtitles,

    sources: Array.isArray(next.sources) && next.sources.length ? next.sources : previous.sources,

    streamPresentation: next.streamPresentation || previous.streamPresentation || null
  };
}

export function flattenStreams(streamResult) {
  if (!streamResult || streamResult.status !== "success") {
    return [];
  }

  const flattened = [];

  (streamResult.data || []).forEach((group) => {
    const groupName = group.addonName || "Addon";

    (group.streams || []).forEach((stream, index) => {
      const streamOrigin = {
        ...(group.streamOrigin || {}),

        ...(stream.streamOrigin || {}),

        addonId:
          stream.addonId ||
          group.addonId ||
          group.streamOrigin?.addonId ||
          stream.streamOrigin?.addonId ||
          null,

        addonBaseUrl:
          stream.addonBaseUrl ||
          group.addonBaseUrl ||
          group.streamOrigin?.addonBaseUrl ||
          stream.streamOrigin?.addonBaseUrl ||
          null,

        addonName:
          stream.addonName ||
          group.addonName ||
          group.streamOrigin?.addonName ||
          stream.streamOrigin?.addonName ||
          groupName,

        sourceProviderId:
          stream.sourceProviderId ||
          group.sourceProviderId ||
          stream.streamOrigin?.sourceProviderId ||
          group.streamOrigin?.sourceProviderId ||
          null
      };

      const entry = {
        id:
          stream.id ||
          `${groupName}-${index}-${stream.url || stream.externalUrl || stream.ytId || ""}`,

        name: stream.name || null,

        title: stream.title || null,

        description: stream.description || null,

        url: stream.url || null,

        ytId: stream.ytId || null,

        infoHash: stream.infoHash || null,

        fileIdx: stream.fileIdx ?? null,

        externalUrl: stream.externalUrl || null,

        behaviorHints: stream.behaviorHints || null,

        sources: Array.isArray(stream.sources) ? stream.sources : [],

        quality: stream.quality || null,

        qualityValue: Number.isFinite(Number(stream.qualityValue))
          ? Number(stream.qualityValue)
          : -1,

        clientResolve: stream.clientResolve || null,

        debridCacheStatus: stream.debridCacheStatus || null,

        streamPresentation: stream.streamPresentation || null,

        subtitles: Array.isArray(stream.subtitles) ? stream.subtitles : [],

        addonId: stream.addonId || group.addonId || null,

        addonBaseUrl: stream.addonBaseUrl || group.addonBaseUrl || null,

        addonName: stream.addonName || groupName,

        addonLogo: stream.addonLogo || group.addonLogo || null,

        sourceProviderId:
          stream.sourceProviderId ||
          group.sourceProviderId ||
          stream.streamOrigin?.sourceProviderId ||
          group.streamOrigin?.sourceProviderId ||
          null,

        streamOrigin,

        addonOrderIndex: Number.isFinite(Number(stream.addonOrderIndex))
          ? Number(stream.addonOrderIndex)
          : Number(group.addonOrderIndex ?? Number.MAX_SAFE_INTEGER),

        mimeType: stream.mimeType || stream.raw?.mimeType || stream.type || stream.source || null,

        sourceType: stream.sourceType || stream.mimeType || stream.type || stream.source || "",

        raw: stream
      };

      if (DirectDebridResolver.shouldListStream(entry)) {
        flattened.push(entry);
      }
    });
  });

  return flattened;
}

export function mergeStreamItems(existing = [], incoming = []) {
  const order = [];

  const byKey = new Map();

  const push = (item) => {
    if (!item) {
      return;
    }

    const key = streamMergeKey(item);

    if (!key) {
      return;
    }

    if (!byKey.has(key)) {
      order.push(key);

      byKey.set(key, item);

      return;
    }

    byKey.set(key, mergeStreamItem(byKey.get(key), item));
  };

  (existing || []).forEach(push);

  (incoming || []).forEach(push);

  return order.map((key) => byKey.get(key));
}
