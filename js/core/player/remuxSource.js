// URL construction only. The playback verdict decides whether remux is needed.

export function buildRemuxUrl(url, endpoint = "", { audioIndex = 0 } = {}) {
  const base = String(endpoint || "").trim();
  if (!base) return "";
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}u=${encodeURIComponent(String(url || ""))}${audioIndex > 0 ? `&ai=${Number(audioIndex)}` : ""}`;
}
