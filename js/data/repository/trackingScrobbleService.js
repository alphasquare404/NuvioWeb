import { TraktScrobbleService } from "./traktScrobbleService.js";
import { SimklScrobbleService } from "./simklScrobbleService.js";
import { MdbListScrobbleService } from "./mdbListScrobbleService.js";
import {
  shouldSendTerminalScrobbleReport,
  terminalScrobbleAction,
  terminalScrobbleReportKey
} from "./terminalScrobbleReport.js";

const DEFAULT_PROVIDERS = [TraktScrobbleService, SimklScrobbleService, MdbListScrobbleService];

/**
 * Fan-out to whichever tracking providers currently own playback.
 *
 * A factory because the terminal-report de-duplication is per-session state: a
 * test needs its own copy, and the providers it forwards to have to be fakes.
 */
export function createTrackingScrobbleService(providers = DEFAULT_PROVIDERS) {
  let lastTerminalReportKey = "";

  function enabledProviders() {
    return providers.filter((provider) => provider.isEnabled());
  }

  return {
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
      const enabled = enabledProviders();
      enabled.forEach((provider) => provider.stop(context));
      return enabled.length > 0;
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

    /**
     * Close a playback the app has already recorded as finished.
     *
     * A history write marks the title watched but cannot end the provider's
     * scrobble session -- only a stop can -- so leaving during the last minutes,
     * before the video's own `ended` event, used to leave the title
     * "scrobbling" on the provider until the session expired. Completion is
     * reported at the full duration because that is what the app has already
     * decided, and once per position so the player's lifecycle cannot post the
     * same finish repeatedly.
     */
    complete(context) {
      if (!context) return false;
      const key = terminalScrobbleReportKey(context);
      if (!key || key === lastTerminalReportKey) return false;
      const enabled = enabledProviders();
      if (!enabled.length) return false;
      lastTerminalReportKey = key;
      enabled.forEach((provider) => provider.stop(context));
      return true;
    },

    cancel() {
      lastTerminalReportKey = "";
      providers.forEach((provider) => provider.cancel());
    }
  };
}

export const TrackingScrobbleService = createTrackingScrobbleService();
