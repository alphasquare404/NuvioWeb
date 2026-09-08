function keyFor(downloadId, kind) {
  return `${String(downloadId || "").trim()}:${String(kind || "poster").trim()}`;
}

export function createOfflineArtworkUrlPool({ getArtwork } = {}) {
  const urls = new Map();
  return {
    async resolve(downloadId, kind = "poster") {
      const key = keyFor(downloadId, kind);
      if (!getArtwork || !key || key.startsWith(":")) return "";
      if (urls.has(key)) return urls.get(key);
      const entry = await getArtwork(downloadId, kind).catch(() => null);
      if (!entry?.file || typeof globalThis.URL?.createObjectURL !== "function") return "";
      const url = globalThis.URL.createObjectURL(entry.file);
      urls.set(key, url);
      return url;
    },
    releaseExcept(keys = []) {
      const retained = new Set(keys);
      urls.forEach((url, key) => {
        if (retained.has(key)) return;
        try { globalThis.URL?.revokeObjectURL?.(url); } catch (_) {}
        urls.delete(key);
      });
    },
    releaseAll() { this.releaseExcept([]); },
    keyFor
  };
}
