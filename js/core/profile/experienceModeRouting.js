import { addonRepository } from "../../data/repository/addonRepository.js";
import { ExperienceModeStore } from "../../data/local/experienceModeStore.js";
import { LayoutPreferences } from "../../data/local/layoutPreferences.js";
import { ProfileSettingsSyncService } from "./profileSettingsSyncService.js";
import { Platform } from "../../platform/index.js";

export async function resolveExperienceRoute(profileId, { pullRemoteSettings = true } = {}) {
  // Browser profile activation must be able to choose its route from the local
  // profile cache. The normal background startup sync refreshes remote settings
  // immediately after navigation and store notifications update affected UI.
  if (pullRemoteSettings) {
    await ProfileSettingsSyncService.pull(profileId);
  }

  let experience = ExperienceModeStore.getForProfile(profileId);
  const layout = LayoutPreferences.getForProfile(profileId);
  if (!experience.mode && layout.hasChosenLayout) {
    experience = ExperienceModeStore.setForProfile(profileId, { mode: "ADVANCED" });
    await ProfileSettingsSyncService.push(profileId);
  }

  // The desktop browser has one supported Home experience. New browser profiles
  // should enter it directly; TV platforms retain the existing layout chooser.
  if (!experience.mode && Platform.isBrowser()) {
    experience = ExperienceModeStore.setForProfile(profileId, { mode: "ADVANCED" });
  }

  if (!experience.mode) {
    return "experienceModeSelection";
  }
  if (experience.mode === "ESSENTIAL" && !experience.addonSetupSkipped) {
    const addons = await addonRepository.getInstalledAddons().catch(() => []);
    if (!addons.length) return "essentialAddonSetup";
  }
  return "home";
}
