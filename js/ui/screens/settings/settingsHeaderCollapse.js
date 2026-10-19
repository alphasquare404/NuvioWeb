import { resolveHeadingProgress } from "../../components/scrollHeadingProgress.js";

export const SETTINGS_HEADING_PROGRESS_RANGE = 96;

export function resolveSettingsHeadingProgress(scrollTop) {
  return resolveHeadingProgress(scrollTop, SETTINGS_HEADING_PROGRESS_RANGE);
}
