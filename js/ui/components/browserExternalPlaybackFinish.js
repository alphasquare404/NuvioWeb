// The explicit completion action shared by the manual dialog and verified
// external-player finished callbacks. It deliberately needs no media timing.
export async function markBrowserExternalPlaybackFinished({ handoff, controller } = {}) {
  const context = handoff?.progressContext;
  if (!context?.itemId || typeof controller?.completePlayback !== "function") return false;
  return controller.completePlayback(context, { externalAuthoritative: true });
}
