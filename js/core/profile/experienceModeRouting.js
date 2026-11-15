import { ExperienceModeStore } from "../../data/local/experienceModeStore.js";
import { ProfileSettingsSyncService } from "./profileSettingsSyncService.js";

export async function resolveExperienceRoute(profileId, { pullRemoteSettings = true } = {}) {
  // Browser profile activation must be able to choose its route from the local
  // profile cache. The normal background startup sync refreshes remote settings
  // immediately after navigation and store notifications update affected UI.
  if (pullRemoteSettings) {
    await ProfileSettingsSyncService.pull(profileId);
  }

  const experience = ExperienceModeStore.getForProfile(profileId);
  if (!experience.mode) {
    ExperienceModeStore.setForProfile(profileId, { mode: "ADVANCED" }, { syncSource: "bootstrap" });
  }

  return "home";
}
