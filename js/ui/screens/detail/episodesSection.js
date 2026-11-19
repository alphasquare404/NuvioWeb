import { I18n } from "../../../i18n/index.js";

function t(key, fallback) {
  return I18n.t(key, {}, { fallback });
}

export function renderEpisodesSection(meta) {
  const videos = Array.isArray(meta?.videos) ? meta.videos : [];
  if (!videos.length) {
    return `<div class="row"><p>${t("episodes_panel_no_episodes", "No episodes available.")}</p></div>`;
  }

  const rows = videos
    .slice(0, 20)
    .map(
      (video) => `
    <div class="card">
      <div style="font-weight:700;">${video.title || video.id || t("episodes_episode", "Episode")}</div>
      <div style="opacity:0.8;">${video.released || ""}</div>
    </div>
  `
    )
    .join("");

  return `<div class="row"><h3>${t("episodes_panel_title", "Episodes")}</h3>${rows}</div>`;
}
