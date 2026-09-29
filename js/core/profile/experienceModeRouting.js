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
    experience = ExperienceModeStore.setForProfile(
      profileId,
      { mode: "ADVANCED" },
      { syncSource: "bootstrap" }
    );
  }

  // New profiles enter the browser Home experience directly.
  if (!experience.mode) {
    experience = ExperienceModeStore.setForProfile(
      profileId,
      { mode: "ADVANCED" },
      { syncSource: "bootstrap" }
    );
  }

  // Every path above leaves a mode behind, so there is nothing left to ask:
  // the screen that used to ask has gone with the question.
  if (experience.mode === "ESSENTIAL" && !experience.addonSetupSkipped) {
    const addons = await addonRepository.getInstalledAddons().catch(() => []);
    if (!addons.length) return "essentialAddonSetup";
  }
  // Quick Setup asks about the external player and the notification that brings
  // you back from it, so it belongs where those exist: the browser and the PWA.
  // It runs once per profile, tracked by a version rather than a flag.
  if (Platform.isBrowser() && ExperienceModeStore.needsQuickSetup(profileId)) {
    return "quickSetup";
  }
  return "home";
}
