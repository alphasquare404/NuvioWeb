import { TraktScrobbleService } from "./traktScrobbleService.js";
import { SimklScrobbleService } from "./simklScrobbleService.js";
import {
  shouldSendTerminalScrobbleReport,
  terminalScrobbleAction,
  terminalScrobbleReportKey
} from "./terminalScrobbleReport.js";

const providers = [TraktScrobbleService, SimklScrobbleService];
let lastTerminalReportKey = "";

function enabledProviders() {
  return providers.filter((provider) => provider.isEnabled());
}

export const TrackingScrobbleService = {
  isEnabled() {
    return enabledProviders().length > 0;
  },

  start(context) {
    enabledProviders().forEach((provider) => provider.start(context));
  },

  pause(context) {
    enabledProviders().forEach((provider) => provider.pause(context));
  },

  stop(context) {
    enabledProviders().forEach((provider) => provider.stop(context));
  },

  /**
   * Record where the user got to, for a playback that is over.
   *
   * This deliberately does not go through pause(). A pause is a session signal
   * and the providers only honour it once a debounced scrobble start has landed
   * -- a guard that is right for the high-frequency pause event, but wrong here:
   * a stuttering stream cycles playing/pause every couple of seconds, each cycle
   * restarts and then cancels the start timer, and the start never fires at all.
   * Every terminal report was then silently dropped, which is why syncing looked
   * random rather than broken. A stop carries the position on its own, with no
   * session required, and below the provider's watched threshold that is exactly
   * how a partial position is recorded.
   *
   */
  report(context) {
    if (!shouldSendTerminalScrobbleReport(context)) return false;
    const key = terminalScrobbleReportKey(context);
    if (!key || key === lastTerminalReportKey) return false;
    lastTerminalReportKey = key;
    const action = terminalScrobbleAction(context);
    const enabled = enabledProviders();
    enabled.forEach((provider) =>
      provider[action === "pause" ? "reportPosition" : "stop"](context)
    );
    return enabled.length > 0;
  },

  cancel() {
    lastTerminalReportKey = "";
    providers.forEach((provider) => provider.cancel());
  }
};
