export const INTEGRATION_SERVICES = ["debrid", "tmdb", "mdblist", "animeskip"];

export function activeIntegrationService(value, wide = false) {
  return INTEGRATION_SERVICES.includes(value) ? value : wide ? "debrid" : null;
}

// Partition existing controls only. Unknown/new controls remain visible in an
// additional group rather than silently disappearing during presentation changes.
export function integrationControlGroups(keys, service) {
  const remaining = new Set(keys.filter((key) => key !== "integration:back"));
  const groups = [];
  const take = (id, match) => {
    const selected = [...remaining].filter(match);
    selected.forEach((key) => remaining.delete(key));
    if (selected.length) groups.push({ id, keys: selected });
  };
  const suffixes = (names) => (key) => names.includes(key.split(":").at(-1));
  if (service === "debrid") {
    take("accounts", (key) => key.startsWith("integration:debrid:key:"));
    take("playback", suffixes(["cloud", "enabled", "provider", "prepareToggle", "prepareCount"]));
    take(
      "preferences",
      (key) =>
        key.includes(":pref:") ||
        suffixes(["maxResults", "sort", "maxPerResolution", "maxPerQuality", "sizeRange"])(key)
    );
    take("formatting", suffixes(["nameTemplate", "descriptionTemplate", "resetTemplates"]));
  } else if (service === "tmdb") {
    take("connection", suffixes(["enabled", "key"]));
    take("usage", suffixes(["modernHome", "continueWatching", "language"]));
    take("information", suffixes(["artwork", "basic", "details", "releaseDates"]));
    take(
      "more",
      suffixes([
        "credits",
        "productions",
        "networks",
        "episodes",
        "trailers",
        "moreLikeThis",
        "collections"
      ])
    );
  } else if (service === "mdblist") {
    take("connection", suffixes(["enabled", "key"]));
    take("ratings", () => true);
  } else if (service === "animeskip") {
    take("planned", () => true);
  }
  take("additional", () => true);
  return groups;
}

export function debridRuleGroups(keys) {
  const groups = new Map();
  for (const key of keys) {
    const match = key.match(/:pref:(?:preferred|required|excluded)(.+)$/);
    const attribute = match ? match[1] : "Additional";
    if (!groups.has(attribute)) groups.set(attribute, []);
    groups.get(attribute).push(key);
  }
  return [...groups].map(([attribute, keys]) => ({ attribute, keys }));
}
