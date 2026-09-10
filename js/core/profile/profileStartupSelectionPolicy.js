export function shouldShowProfileSelectionAtStartup({
  profiles = [],
  activeProfileHasPin = false,
  hasSelectedProfileThisSession = false,
  rememberLastProfileEnabled = false,
  hasEverSelectedProfile = false
} = {}) {
  if (hasSelectedProfileThisSession) {
    return false;
  }

  if (rememberLastProfileEnabled && hasEverSelectedProfile && !activeProfileHasPin) {
    return false;
  }

  return !hasEverSelectedProfile || profiles.length > 1 || activeProfileHasPin;
}
