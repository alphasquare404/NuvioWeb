// URL construction only. The playback verdict decides whether remux is needed.
import { isPrivateMediaUrl } from "../streams/privateMediaSource.js";

export function buildRemuxUrl(url, endpoint = "", { audioIndex = 0 } = {}) {
  const base = String(endpoint || "").trim();
  if (!base || isPrivateMediaUrl(url)) return "";
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}u=${encodeURIComponent(String(url || ""))}${audioIndex > 0 ? `&ai=${Number(audioIndex)}` : ""}`;
}
