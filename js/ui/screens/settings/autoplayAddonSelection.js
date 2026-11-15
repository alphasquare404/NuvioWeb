export function listAutoplayStreamAddons(addons) {
  return addons
    .filter(
      (addon) =>
        !Array.isArray(addon.resources) ||
        addon.resources.some(
          (resource) =>
            String(resource.name || "")
              .trim()
              .toLowerCase() === "stream"
        )
    )
    .map((addon) => {
      const label = String(addon.displayName || addon.name || "").trim();
      return { id: label, label, unknown: !Array.isArray(addon.resources) };
    })
    .filter(({ id }) => id);
}
