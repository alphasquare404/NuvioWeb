import { normalizeAccentColor } from "../../core/theme/accentColor.js";
import { createProfileScopedStore } from "./profileScopedStore.js";

const KEY = "themeSettings";

const DEFAULT_THEME = {
  mode: "dark",
  themeName: "WHITE",
  accentColor: "#ffffff",
  customAccentColor: "#1e88e5",
  fontFamily: "INTER",
  language: null,
  amoledMode: false,
  amoledSurfacesMode: false,
  settingsUiStyle: "CLASSIC"
};

const THEME_BY_ACCENT = new Map([
  ["#ffffff", "WHITE"],
  ["#f5f5f5", "WHITE"],
  ["#f5f8fc", "WHITE"],
  ["#ff4d4f", "CRIMSON"],
  ["#ff5252", "CRIMSON"],
  ["#42a5f5", "OCEAN"],
  ["#ba68c8", "VIOLET"],
  ["#ab47bc", "VIOLET"],
  ["#66bb6a", "EMERALD"],
  ["#ffca28", "AMBER"],
  ["#ffa726", "AMBER"],
  ["#ec407a", "ROSE"]
]);

const ACCENT_BY_THEME = {
  WHITE: "#f5f5f5",
  CRIMSON: "#e53935",
  OCEAN: "#1e88e5",
  VIOLET: "#8e24aa",
  EMERALD: "#43a047",
  AMBER: "#fb8c00",
  ROSE: "#d81b60"
};

export function accentColorForTheme(themeName) {
  const normalizedThemeName = String(themeName || DEFAULT_THEME.themeName).toUpperCase();
  return String(ACCENT_BY_THEME[normalizedThemeName] || DEFAULT_THEME.accentColor).toLowerCase();
}

export function normalizeTheme(settings = {}) {
  const accent = String(settings?.accentColor || DEFAULT_THEME.accentColor).toLowerCase();
  const storedThemeName = String(settings?.themeName || DEFAULT_THEME.themeName).toUpperCase();
  const themeFromAccent = storedThemeName === "CUSTOM" ? null : THEME_BY_ACCENT.get(accent);
  const themeName = String(
    themeFromAccent && themeFromAccent !== storedThemeName
      ? themeFromAccent
      : storedThemeName || themeFromAccent || DEFAULT_THEME.themeName
  ).toUpperCase();
  const normalizedAccent = ACCENT_BY_THEME[themeName]
    ? accentColorForTheme(themeName)
    : String(accent || DEFAULT_THEME.accentColor).toLowerCase();

  return {
    ...DEFAULT_THEME,
    ...settings,
    themeName,
    accentColor:
      themeName === "CUSTOM"
        ? normalizeAccentColor(settings.accentColor) ||
          normalizeAccentColor(settings.customAccentColor) ||
          DEFAULT_THEME.customAccentColor
        : normalizedAccent,
    customAccentColor:
      normalizeAccentColor(settings.customAccentColor) ||
      (themeName === "CUSTOM" ? normalizeAccentColor(settings.accentColor) : null) ||
      DEFAULT_THEME.customAccentColor,
    settingsUiStyle: ["CLASSIC", "HORIZON", "ZEN"].includes(
      String(settings?.settingsUiStyle || "").toUpperCase()
    )
      ? String(settings.settingsUiStyle).toUpperCase()
      : "CLASSIC"
  };
}

const store = createProfileScopedStore({
  key: KEY,
  normalize: normalizeTheme
});

export const ThemeStore = {
  getForProfile(profileId) {
    return store.getForProfile(profileId);
  },

  get() {
    return store.get();
  },

  replaceForProfile(profileId, nextValue, options = {}) {
    return store.replaceForProfile(profileId, nextValue, options);
  },

  setForProfile(profileId, partial, options = {}) {
    return store.setForProfile(profileId, partial, options);
  },

  set(partial, options = {}) {
    return store.set(partial, options);
  }
};
