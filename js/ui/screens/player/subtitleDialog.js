import { I18n } from "../../../i18n/index.js";

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

export const SubtitleDialog = {
  show(container, subtitles = []) {
    if (!container) return;
    this.hide(container);
    const node = document.createElement("div");
    node.id = "subtitleDialog";
    node.className = "card";
    node.style.position = "absolute";
    node.style.left = "50%";
    node.style.top = "50%";
    node.style.transform = "translate(-50%, -50%)";
    const rows = subtitles
      .slice(0, 16)
      .map(
        (subtitle) => `
      <div style="padding:4px 0;">
        <strong>${subtitle.active ? ">" : ""} ${subtitle.label || subtitle.lang || t("common.unknown", {}, "unknown")}</strong>
        <span style="opacity:0.75;"> - ${subtitle.source || subtitle.addonName || t("nav_addons", {}, "addon")}</span>
      </div>
    `
      )
      .join("");
    node.innerHTML = `
      <h3>${t("subtitle_dialog_title", {}, "Subtitles")}</h3>
      <p>${t("subtitle_dialog_options", [subtitles.length], `${subtitles.length} options`)}</p>
      ${rows || `<p>${t("subtitle_dialog_none", {}, "No subtitles found.")}</p>`}
      <p style="opacity:0.75;">${t("subtitle_dialog_close_hint", {}, "Press S to close")}</p>
    `;
    container.appendChild(node);
  },
  hide(container) {
    container?.querySelector("#subtitleDialog")?.remove();
  }
};
