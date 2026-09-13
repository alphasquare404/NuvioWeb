export async function dispatchOutplayerExplicitFinish({ report, controller } = {}) {
  const provider = report?.handoff?.playerMode;
  const explicitFinish = provider === "outplayer" && (report?.outcome === "finished" || report?.sourceOutcome === "finished");
  if (!explicitFinish) return { handled: false, applied: false };

  const handoffFound = Boolean(report?.handoff?.progressContext?.itemId);
  if (!handoffFound || typeof controller?.completePlayback !== "function") {
    return { handled: true, applied: false };
  }

  try {
    const applied = await markBrowserExternalPlaybackFinished({ handoff: report.handoff, controller });
    return { handled: true, applied: applied === true };
  } catch (_) {
    return { handled: true, applied: false };
  }
}
import { markBrowserExternalPlaybackFinished } from "./browserExternalPlaybackFinish.js";
