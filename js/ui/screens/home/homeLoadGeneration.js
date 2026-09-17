// Decides whether an in-flight Home loadData() call is still allowed to
// commit its results (rows/hasLoadedOnce/heroItem). Home's own cleanup() no
// longer bumps homeLoadToken merely because the user navigated away (see
// cleanup()'s comment in homeScreen.js) -- a load that was already in flight
// when that happened is allowed to keep resolving in the background and
// land its data once done, instead of being discarded just because Home
// wasn't the active route for a moment. mount() itself still bumps the
// token on every entry (warm or cold), which is the real generation
// boundary this guards against. The profile id check is what the token
// alone would miss: a profile switch while the old load is still in flight.
export function isHomeLoadGenerationCurrent({ token, currentToken, profileId, currentProfileId }) {
  return token === currentToken && String(profileId || "") === String(currentProfileId || "");
}
