export const LAYOUT_SETTINGS_GROUPS = [
  "navStyle",
  "homeContent",
  "continueWatching",
  "detailPage",
  "cardAppearance"
];

export function activeLayoutSettingsGroup(expanded = {}, wide = false) {
  return LAYOUT_SETTINGS_GROUPS.find((id) => expanded[id]) || (wide ? "navStyle" : null);
}

export function toggleLayoutSettingsGroup(expanded, id, wide = false) {
  if (!LAYOUT_SETTINGS_GROUPS.includes(id)) return { ...expanded };
  const current = activeLayoutSettingsGroup(expanded, wide);
  return {
    ...expanded,
    ...Object.fromEntries(
      LAYOUT_SETTINGS_GROUPS.map((key) => [key, key === id && (wide || current !== id)])
    )
  };
}

export const LAYOUT_DEPTH_FIELDS = {
  cardDepthEdgeStrength: {
    focusKey: "layout:cardDepthEdge",
    labelKey: "settings_card_depth_edge_value",
    fallback: 28
  },
  cardDepthSheenStrength: {
    focusKey: "layout:cardDepthSheen",
    labelKey: "settings_card_depth_sheen_value",
    fallback: 10
  },
  cardDepthEdgeCoverage: {
    focusKey: "layout:cardDepthCoverage",
    labelKey: "settings_card_depth_coverage_value",
    fallback: 0
  }
};

export function layoutDepthValue(field, value) {
  if (!Object.hasOwn(LAYOUT_DEPTH_FIELDS, field)) return null;
  const parsed = Number(value);
  return Math.min(
    100,
    Math.max(0, Number.isFinite(parsed) ? parsed : LAYOUT_DEPTH_FIELDS[field].fallback)
  );
}

export function layoutPreviewDepth(layout = {}) {
  return {
    enabled: Boolean(layout.cardDepthEnabled) && layout.cardDepthPostersEnabled !== false,
    edge: layoutDepthValue("cardDepthEdgeStrength", layout.cardDepthEdgeStrength) / 100,
    sheen: layoutDepthValue("cardDepthSheenStrength", layout.cardDepthSheenStrength) / 100,
    coverage:
      12 +
      Math.round(
        (18 * layoutDepthValue("cardDepthEdgeCoverage", layout.cardDepthEdgeCoverage)) / 100
      )
  };
}
