import { PluginStore } from "../../data/local/pluginStore.js";
import { PluginRuntime } from "./pluginRuntime.js";
import { PluginRepositoryManager } from "./pluginRepositoryManager.js";

export const PluginManager = {
  repositories: PluginRepositoryManager,
  get pluginsEnabled() {
    return PluginStore.get().settings.pluginsEnabled;
  },

  setPluginsEnabled(enabled) {
    if (!PluginStore.canEdit()) return;
    const state = PluginStore.get();
    PluginStore.replace({
      ...state,
      settings: { ...state.settings, pluginsEnabled: Boolean(enabled) }
    });
  },

  listPluginSources() {
    return PluginRuntime.listSources();
  },

  addPluginSource(source) {
    if (PluginStore.canEdit()) PluginRuntime.addSource(source);
  },

  removePluginSource(sourceId) {
    if (PluginStore.canEdit()) PluginRuntime.removeSource(sourceId);
  },

  setPluginSourceEnabled(sourceId, enabled) {
    if (PluginStore.canEdit()) PluginRuntime.setSourceEnabled(sourceId, enabled);
  },

  async executeScrapersStreaming(options = {}) {
    if (!this.pluginsEnabled || options.signal?.aborted) return [];
    const legacy = PluginRuntime.execute(options);
    for (const group of legacy) options.onGroup?.(group);
    return [...legacy, ...(await PluginRepositoryManager.search(options))];
  }
};
