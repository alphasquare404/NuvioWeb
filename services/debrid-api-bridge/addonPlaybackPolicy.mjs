export function parseHttpsPlaybackUrl(value) {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.hash &&
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(url.hostname) &&
      !/^[\d.]+$|\.(?:localhost|local|internal)$/i.test(url.hostname)
      ? url
      : null;
  } catch {
    return null;
  }
}
