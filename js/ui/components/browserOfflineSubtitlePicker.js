import { normalizeSubtitleForDisplay } from "./browserSubtitleDisplay.js";
import {
  createOfflineSubtitleFingerprint,
  isOfflineSubtitleFormatSupported
} from "../../core/offline/offlineSubtitleIdentity.js";

import { getSafeOfflineSubtitleDescriptors } from "../../core/offline/browserOfflineDownloads.js";

export function getPreferredOfflineDownloadSubtitles(subtitles, settings) {
  const normalize = (value) => String(value || "").trim().toLowerCase().replaceAll("_", "-");
  const preferred = [
    settings.subtitleStyle?.preferredLanguage || settings.subtitleLanguage,
    settings.subtitleStyle?.secondaryPreferredLanguage || settings.secondarySubtitleLanguage
  ].map(normalize).filter((language) => language && language !== "off" && language !== "none");
  return subtitles.filter((subtitle) => {
    const language = normalize(subtitle.lang || subtitle.language);
    return preferred.some((target) => language === target || language.startsWith(target + "-"));
  });
}

export function createBrowserOfflineSubtitleSelection(snapshot, selection) {
  const indexes = new Set(selection.selectedIndexes);
  const descriptors = getSafeOfflineSubtitleDescriptors(
    snapshot.filter((_, index) => indexes.has(index)).map((entry) => entry.descriptor)
  );
  const mode = descriptors.length ? selection.selectedMode : "none";
  return {
    offlineSubtitleMode: mode,
    offlineSubtitleDescriptors: descriptors,
    offlineSubtitle: mode === "specific" ? descriptors[0] || null : null,
    ...(mode === "language" ? { offlineSubtitleLanguage: selection.subtitleLanguage } : {})
  };
}

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
  preferred = [],
  loading = false,
  onSelect = () => {}
} = {}) {
  const selectedMode = selection.selectedMode || "none";
  const selectedIndexes = new Set(selection.selectedIndexes);
  const preferredTracks = new Set(preferred);
  const groups = new Map();
  snapshot.forEach((entry, index) => {
    if (!groups.has(entry.language)) groups.set(entry.language, []);
    groups.get(entry.language).push({ ...entry, index });
  });
  const selectedLanguage = selection.selectedLanguage || groups.keys().next().value || "";
  const selectedItems = groups.get(selectedLanguage) || [];
  const controls = document.createElement("div");
  controls.className = "stream-download-subtitle-controls download-options-modes";
  const select = (mode, indexes, subtitleLanguage = "") => onSelect({
    selectedLanguage,
    selectedMode: indexes.length ? mode : "none",
    selectedIndexes: indexes,
    subtitleLanguage
  });
  const toggle = (indexes, mode, subtitleLanguage = "") => {
    const next = new Set(selectedIndexes);
    const remove = indexes.every((index) => next.has(index));
    indexes.forEach((index) => remove ? next.delete(index) : next.add(index));
    select(remove || selectedIndexes.size ? "specific" : mode, [...next], subtitleLanguage);
  };
  const addOption = (mode, index = null, subtitle = null, label = "", container = controls) => {
    const display = subtitle ? normalizeSubtitleForDisplay(subtitle) : null;
    const selected = subtitle ? selectedIndexes.has(index) : selectedMode === mode;
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
    option.disabled = Boolean(loading) || (mode === "preferred" && !preferredTracks.size) ||
      (mode === "all" && !snapshot.length);
    option.addEventListener("click", () => {
      if (subtitle) {
        toggle([index], "specific");
        return;
      }
      const indexes = snapshot.flatMap((entry, entryIndex) =>
        mode === "all" || (mode === "preferred" && preferredTracks.has(entry.subtitle))
          ? [entryIndex]
          : []
      );
      select(mode, indexes);
    });
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
    box.addEventListener("click", () => onSelect({ selectedLanguage: language }));
    boxes.appendChild(box);
  });
  languageBar.append(languageTitle, boxes);

  const languageAction = document.createElement("div");
  languageAction.className = "download-options-language-action";
  if (selectedItems.length) {
    const allLanguage = document.createElement("button");
    allLanguage.type = "button";
    const indexes = selectedItems.map(({ index }) => index);
    const allSelected = indexes.every((index) => selectedIndexes.has(index));
    allLanguage.setAttribute("aria-pressed", String(allSelected));
    allLanguage.disabled = Boolean(loading);
    allLanguage.className = `stream-download-subtitle-option stream-download-subtitle-mode stream-download-subtitle-language-all${allSelected ? " selected" : ""}`;
    allLanguage.textContent = `Download all ${selectedLanguage} (${selectedItems.length})`;
    allLanguage.addEventListener("click", () => toggle(indexes, "language", selectedLanguage));
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
