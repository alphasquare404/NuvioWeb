// Reading counts never rewrites the saved autoplay scope. Editing only keeps
// choices the person can actually see in the installed-addon dialog.
export function visibleAutoplayAddonSelection(selected = [], addons = []) {
  const names = new Set(
    addons
      .map((addon) => String(addon?.displayName || addon?.name || addon?.id || "").trim())
      .filter(Boolean)
  );
  return [...new Set(selected.filter((name) => names.has(name)))];
}
