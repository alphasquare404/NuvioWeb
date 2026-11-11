import { createProfileScopedStore } from "./profileScopedStore.js";
import { LocalStore } from "../../core/storage/localStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { normalizePluginState } from "../../core/player/pluginModels.js";

export function getEffectivePluginProfileId(profileId = ProfileManager.getActiveProfileId()) {
  const id = String(profileId || "1");
  const profiles = LocalStore.get("profiles", []);
  const profile = (Array.isArray(profiles) ? profiles : []).find(
    (entry) => String(entry.id ?? entry.profileIndex ?? "") === id
  );
  const shared = profile?.usesPrimaryPlugins ?? profile?.uses_primary_plugins;
  return shared === true || shared === 1 || shared === "true" || shared === "1" ? "1" : id;
}

const store = createProfileScopedStore({
  key: "pluginState",
  normalize: normalizePluginState,
  seedFromPrimary: false,
  legacyMigration: "primary"
});

export const PluginStore = {
  get(profileId) {
    const id = getEffectivePluginProfileId(profileId);
    const state = store.getForProfile(id);
    if (id !== "1" || LocalStore.get("pluginState:migrationComplete", false)) return state;
    const legacy = LocalStore.get("pluginSources", []);
    const enabled = LocalStore.get("pluginsEnabled", null);
    const next = store.replaceForProfile(
      id,
      {
        ...state,
        legacySources:
          state.legacySources.length || !Array.isArray(legacy) ? state.legacySources : legacy,
        settings: {
          ...state.settings,
          pluginsEnabled: enabled == null ? state.settings.pluginsEnabled : Boolean(enabled)
        }
      },
      { silentSync: true }
    );
    LocalStore.set("pluginState:migrationComplete", true);
    return next;
  },
  replace(state, profileId) {
    return store.replaceForProfile(getEffectivePluginProfileId(profileId), state, {
      silentSync: true
    });
  },
  canEdit(profileId = ProfileManager.getActiveProfileId()) {
    return String(profileId) === getEffectivePluginProfileId(profileId);
  }
};
