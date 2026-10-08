// Which questions Quick Setup is worth asking on this device.
//
// Kept apart from the screen because this is the whole policy of the flow and
// the screen cannot be imported on its own: it and the router refer to each
// other. Here it is plain data in, plain list out.

// A browser offers its notification permission once per origin, so "blocked"
// still belongs on the list: the card says where to undo it, which is the only
// useful thing left to say. "unavailable" and "server-not-configured" are not
// states the person can act on at all.
const PUSH_OFFERABLE_STATES = Object.freeze(["not-enabled", "enabled", "blocked"]);

export function selectReturnMethodsOffered({
  pushState = "",
  automationAvailability = "unsupported",
  progressMode = "automatic"
} = {}) {
  const offered = [];
  // Manual reporting strips the callbacks out of the launch, so the relay never
  // hears from the player and has nothing to send a notification about. The
  // Automation is unaffected: iOS fires it when the player closes, not when a
  // report arrives.
  if (progressMode !== "manual" && PUSH_OFFERABLE_STATES.includes(pushState)) {
    offered.push("notification");
  }
  // iOS without the install is still offered: the one thing in its way, Add to
  // Home Screen, is something the person can go and do.
  if (automationAvailability !== "unsupported") offered.push("automation");
  return offered;
}

export function selectQuickSetupSteps({
  callbackMode = "none",
  automaticProgress = false,
  pushState = "",
  automationAvailability = "unsupported",
  progressMode = "automatic"
} = {}) {
  const steps = ["player"];
  if (automaticProgress) steps.push("progress");
  // Nothing to come back from when playback never leaves. The internal player
  // is the one choice with no callback mode at all.
  if (
    callbackMode !== "none" &&
    selectReturnMethodsOffered({ pushState, automationAvailability, progressMode }).length
  ) {
    steps.push("return");
  }
  steps.push("offlineSync");
  return steps;
}
