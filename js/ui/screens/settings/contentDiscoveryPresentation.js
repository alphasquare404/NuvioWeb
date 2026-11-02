export const CONTENT_DISCOVERY_TOPICS = ["addons", "plugins", "collections"];

export function visibleContentDiscoveryTopics(essential = false) {
  return CONTENT_DISCOVERY_TOPICS.filter((id) => !essential || id !== "plugins");
}

export function activeContentDiscoveryTopic(selected, { wide = false, essential = false } = {}) {
  if (selected === null) return wide ? "addons" : null;
  return visibleContentDiscoveryTopics(essential).includes(selected) ? selected : "addons";
}
