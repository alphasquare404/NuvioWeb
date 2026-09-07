import { normalizeSubtitleForDisplay } from "./browserSubtitleDisplay.js";
import {
  createOfflineSubtitleFingerprint,
  isOfflineSubtitleFormatSupported
} from "../../core/offline/offlineSubtitleIdentity.js";

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function createBrowserOfflineSubtitleSnapshot(subtitles = [], createDescriptor = null) {
  const seen = new Set();
  return (subtitles || []).reduce((snapshot, subtitle) => {
    if (!isOfflineSubtitleFormatSupported(subtitle)) return snapshot;
    const descriptor = createDescriptor?.(subtitle) || { fingerprint: createOfflineSubtitleFingerprint(subtitle) };
    if (!descriptor?.fingerprint || seen.has(descriptor.fingerprint)) return snapshot;
    seen.add(descriptor.fingerprint);
    snapshot.push({ subtitle, descriptor, language: normalizeSubtitleForDisplay(subtitle).language || "Unknown" });
    return snapshot;
  }, []);
}

export function createBrowserOfflineSubtitlePicker({
  snapshot = [],
  selection = {},
  preferredLabel = "",
  loading = false,
  onSelect = () => {}
} = {}) {
  const selectedMode = selection.selectedMode || "none";
  const selectedIndex = Number.isInteger(selection.selectedIndex) ? selection.selectedIndex : null;
  const groups = new Map();
  snapshot.forEach((entry, index) => {
    if (!groups.has(entry.language)) groups.set(entry.language, []);
    groups.get(entry.language).push({ ...entry, index });
  });
  const selectedLanguage = selection.selectedLanguage || groups.keys().next().value || "";
  const selectedItems = groups.get(selectedLanguage) || [];
  const controls = document.createElement("div");
  controls.className = "stream-download-subtitle-controls download-options-modes";
  const select = (next) => onSelect({ selectedLanguage, ...next });
  const addOption = (mode, index = null, subtitle = null, label = "", container = controls) => {
    const display = subtitle ? normalizeSubtitleForDisplay(subtitle) : null;
    const selected = selectedMode === mode && selectedIndex === index;
    const option = document.createElement("button");
    option.type = "button";
    option.className = `stream-download-subtitle-option${subtitle ? "" : " stream-download-subtitle-mode"}${selected ? " selected" : ""}`;
    option.setAttribute("aria-pressed", String(selected));
    if (!subtitle) {
      const accessible = { none: "No subtitle", preferred: "Preferred subtitle", all: `All subtitles (${snapshot.length})` }[mode] || label;
      option.setAttribute("aria-label", accessible);
      option.title = accessible;
    }
    option.innerHTML = subtitle
      ? `<span class="stream-download-subtitle-provider">${escapeHtml(display.provider)}</span><strong>${escapeHtml(display.language)}</strong><span class="stream-download-subtitle-meta" title="${escapeHtml(display.meta)}">${escapeHtml(display.meta)}</span><span class="stream-download-subtitle-check">${selected ? "&#10003;" : ""}</span>`
      : `<strong>${escapeHtml(label)}</strong><span class="stream-download-subtitle-check">${selected ? "&#10003;" : ""}</span>`;
    option.disabled = Boolean(loading);
    option.addEventListener("click", () => select({ selectedMode: mode, selectedIndex: index }));
    container.appendChild(option);
  };
  addOption("none", null, null, "None");
  addOption("preferred", null, null, "Preferred");
  addOption("all", null, null, `All${snapshot.length ? ` (${snapshot.length})` : ""}`);

  const languageBar = document.createElement("div");
  languageBar.className = "download-options-language-bar";
  const languageTitle = document.createElement("div");
  languageTitle.className = "stream-download-subtitle-language-heading";
  languageTitle.textContent = "Languages";
  const boxes = document.createElement("div");
  boxes.className = "stream-download-subtitle-language-boxes";
  groups.forEach((items, language) => {
    const box = document.createElement("button");
    box.type = "button";
    box.className = `stream-download-subtitle-language-box${language === selectedLanguage ? " selected" : ""}`;
    box.textContent = `${language} ${items.length}`;
    box.addEventListener("click", () => onSelect({ selectedMode, selectedIndex, selectedLanguage: language }));
    boxes.appendChild(box);
  });
  languageBar.append(languageTitle, boxes);

  const languageAction = document.createElement("div");
  languageAction.className = "download-options-language-action";
  if (selectedItems.length) {
    const allLanguage = document.createElement("button");
    allLanguage.type = "button";
    allLanguage.className = `stream-download-subtitle-option stream-download-subtitle-mode stream-download-subtitle-language-all${selectedMode === "language" ? " selected" : ""}`;
    allLanguage.textContent = `Download all ${selectedLanguage} (${selectedItems.length})`;
    allLanguage.addEventListener("click", () => select({ selectedMode: "language", selectedIndex: null }));
    languageAction.appendChild(allLanguage);
  }

  const trackList = document.createElement("div");
  trackList.className = "stream-download-subtitle-list download-options-track-list";
  selectedItems.forEach(({ subtitle, index }) => addOption("specific", index, subtitle, "", trackList));
  const root = document.createElement("div");
  root.className = "browser-offline-subtitle-picker";
  root.append(controls, languageBar, languageAction, trackList);
  return root;
}
