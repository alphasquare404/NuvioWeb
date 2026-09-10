const REQUEST_TIMEOUT_MS = 15000;

function withTimeout(promise, timeoutMs) {
  let timeoutId = 0;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("webOS subtitle request timed out")), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

export const localMediaSubtitleRepository = {
  async getExternalSubtitleText(url) {
    const targetUrl = String(url || "").trim();
    if (!/^https?:\/\//i.test(targetUrl)) {
      throw new Error("Unsupported subtitle URL");
    }
    const response = await withTimeout(fetch(targetUrl), REQUEST_TIMEOUT_MS);
    if (!response.ok) {
      throw new Error(`Subtitle request failed with HTTP ${response.status}`);
    }
    const body = await response.text();
    if (!body.trim()) {
      throw new Error("Subtitle response is empty");
    }
    return {
      body,
      contentType: String(response.headers.get("content-type") || "text/vtt")
    };
  }
};
