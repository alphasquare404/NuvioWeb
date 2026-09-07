function text(value) {
  return String(value || "").trim();
}

function languageLabel(value) {
  const language = text(value).replace(/_/g, "-");
  if (!language || language.toLowerCase() === "unknown") return "Unknown";
  try {
    const label = new Intl.DisplayNames(undefined, { type: "language" }).of(language);
    return label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : language;
  } catch (_) {
    return language.length <= 3 ? language.toUpperCase() : language;
  }
}

export function normalizeSubtitleForDisplay(subtitle = {}) {
  const release = text(subtitle.fileName || subtitle.filename || subtitle.name || subtitle.id);
  const scoreValue = Number(subtitle.match || subtitle.score || subtitle.matchScore);
  const scoreMatch = release.match(/\[(\d{1,3})%\]/);
  const score = Number.isFinite(scoreValue) && scoreValue >= 0
    ? `${Math.round(scoreValue > 1 ? scoreValue : scoreValue * 100)}%`
    : scoreMatch
      ? `${scoreMatch[1]}%`
      : "";
  const flags = [subtitle.forced === true || subtitle.isForced === true ? "Forced" : "", subtitle.sdh === true || subtitle.hearingImpaired === true ? "SDH" : ""].filter(Boolean);
  return {
    language: languageLabel(subtitle.lang || subtitle.language),
    provider: text(subtitle.addonName || subtitle.provider) || "Subtitle addon",
    score,
    release,
    flags,
    meta: [score ? `[${score}]` : "", release, ...flags].filter(Boolean).join(" ")
  };
}
