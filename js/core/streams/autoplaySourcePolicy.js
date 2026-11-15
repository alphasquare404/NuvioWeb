export const AUTOPLAY_SOURCE_GROUPS = ["addons", "plugins", "servers"];

export function normalizeAutoplaySourcePriority(value) {
  if (typeof value === "string") value = value.split(",");
  if (!Array.isArray(value)) return [];
  const groups = [...new Set(value.filter((group) => AUTOPLAY_SOURCE_GROUPS.includes(group)))];
  return groups.length ? [...new Set([...groups, ...AUTOPLAY_SOURCE_GROUPS])] : [];
}

export function hasAutoplaySourcePriority(settings) {
  return (
    settings.streamAutoPlaySource === "ALL_SOURCES" &&
    normalizeAutoplaySourcePriority(settings.streamAutoPlaySourcePriority).length > 0
  );
}

export function autoplaySourceOptions(settings = {}) {
  return {
    selectedAddons: settings.streamAutoPlaySelectedAddons,
    selectedPlugins: settings.streamAutoPlaySelectedPlugins,
    selectedServers: settings.streamAutoPlaySelectedServers,
    addonsDisabled: settings.streamAutoPlayAddonsDisabled === true,
    pluginsDisabled: settings.streamAutoPlayPluginsDisabled === true,
    sourcePriority: settings.streamAutoPlaySourcePriority
  };
}

export function autoplaySourceIdentity(stream, installedAddonNames) {
  const server = stream?.clientResolve?.mediaServer || stream?.raw?.clientResolve?.mediaServer;
  if (server?.connectionId) return { group: "servers", id: String(server.connectionId) };
  const id = String(stream?.addonName || "");
  return { group: installedAddonNames.has(id) ? "addons" : "plugins", id };
}

const settingsFields = {
  addons: ["streamAutoPlaySelectedAddons", "streamAutoPlayAddonsDisabled"],
  plugins: ["streamAutoPlaySelectedPlugins", "streamAutoPlayPluginsDisabled"],
  servers: ["streamAutoPlaySelectedServers"]
};

export function isAutoplaySourceEnabled(settings, group, id) {
  const [selectionKey, disabledKey] = settingsFields[group];
  const selection = settings[selectionKey] || [];
  return selection.length ? selection.includes(id) : group !== "servers" && !settings[disabledKey];
}

export function toggleAutoplaySource(settings, group, id, visibleIds) {
  const [selectionKey, disabledKey] = settingsFields[group];
  const current = settings[selectionKey] || [];
  // Keep saved names that are temporarily absent. An empty legacy list means all.
  const enabled = new Set([
    ...current,
    ...visibleIds.filter((name) => isAutoplaySourceEnabled(settings, group, name))
  ]);
  if (enabled.has(id)) enabled.delete(id);
  else enabled.add(id);
  return {
    [selectionKey]: [...enabled],
    ...(disabledKey ? { [disabledKey]: enabled.size === 0 } : {})
  };
}
