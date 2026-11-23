import { AuthManager } from "./authManager.js";
import { ProfileManager } from "../profile/profileManager.js";

// The owner marker is written when a session is established for an account and
// cleared on sign-out or account reset. Reading it directly avoids a cycle:
// authManager already imports accountLocalDataReset, so this helper must not be
// imported by authManager.
const ACCOUNT_OWNER_MARKER_KEY = "nuvioAccountOwnerMarker";

function readOwnerMarker() {
  try {
    return String(globalThis.localStorage?.getItem(ACCOUNT_OWNER_MARKER_KEY) || "").trim();
  } catch (_) {
    return "";
  }
}

/**
 * Capture the account/profile boundary a request started under.
 *
 * A network response can land after the user signed out, signed into another
 * account, or switched profiles. Callers capture this before the await and
 * check it before saving anything.
 */
export function captureAccountScope(profileId = null) {
  return {
    sessionGeneration: AuthManager.getSessionGeneration(),
    ownerMarker: readOwnerMarker(),
    profileId: String(profileId ?? ProfileManager.getActiveProfileId() ?? "1")
  };
}

export function isAccountScopeCurrent(scope) {
  if (!scope) return false;
  return (
    AuthManager.getSessionGeneration() === scope.sessionGeneration &&
    readOwnerMarker() === scope.ownerMarker
  );
}

export function isProfileScopeCurrent(scope) {
  if (!scope) return false;
  return String(ProfileManager.getActiveProfileId() ?? "1") === String(scope.profileId);
}
