export function getProfileStartupAction({
  profiles = [],
  activeProfileHasPin = false,
  hasSelectedProfileThisSession = false,
  rememberLastProfileEnabled = false,
  hasEverSelectedProfile = false
} = {}) {
  if (hasSelectedProfileThisSession) return "enter";
  if (rememberLastProfileEnabled && hasEverSelectedProfile) {
    return activeProfileHasPin ? "unlock" : "enter";
  }
  return !hasEverSelectedProfile || profiles.length > 1 || activeProfileHasPin ? "select" : "enter";
}
