import "./core/diagnostics/consoleDebugBuffer.js";
import { detailWatchedEnrichmentService } from "./data/repository/detailWatchedEnrichmentService.js";
import { Router } from "./ui/navigation/router.js";
import { FocusEngine } from "./ui/navigation/focusEngine.js";
import { PlayerController } from "./core/player/playerController.js";
import { AuthManager } from "./core/auth/authManager.js";
import { AuthState } from "./core/auth/authState.js";
import { DeviceSessionRegistration } from "./core/auth/deviceSessionRegistration.js";
import { ProfileManager } from "./core/profile/profileManager.js";
import { ProfileSyncService } from "./core/profile/profileSyncService.js";
import { StartupSyncService } from "./core/profile/startupSyncService.js";
import { ProviderCredentialSyncService } from "./core/profile/providerCredentialSyncService.js";
import { ThemeManager } from "./ui/theme/themeManager.js";
import { renderAppShell } from "./bootstrap/renderAppShell.js";
import { renderAddonRemotePage } from "./bootstrap/renderAddonRemotePage.js";
import { preloadStreamBadgeImages } from "./ui/screens/stream/streamScreen.js";
import { warmStreamingLibs } from "./runtime/loadStreamingLibs.js";
import { Platform } from "./platform/index.js";
import { LocalStore } from "./core/storage/localStore.js";
import { I18n } from "./i18n/index.js";
import { resolveExperienceRoute } from "./core/profile/experienceModeRouting.js";
import { initializeBrowserOfflineDownloadQueue } from "./core/offline/browserOfflineDownloadQueue.js";

(function applyLegacyPatches() {
  const originalGetElementById = document.getElementById;
  document.getElementById = function (id) {
    if (id === undefined || id === null || id === "") return null;
    return originalGetElementById.call(document, id);
  };

  if (typeof Node === "undefined") {
    globalThis.Node = { ELEMENT_NODE: 1 };
  }
})();

const GUEST_QR_BYPASS_KEY = "skipAuthQrGate";
const SIGNED_OUT_ALLOWED_ROUTES = new Set(["trakt"]);
let hasSelectedProfileThisSession = false;
let appShellRendered = false;
const STARTUP_PERF_DEBUG = Boolean(globalThis.__NUVIO_DEBUG_STARTUP_PERF__);

if (
  Platform.isBrowser() &&
  globalThis.navigator?.serviceWorker &&
  /^https?:$/.test(globalThis.location?.protocol || "") &&
  !["localhost", "127.0.0.1", "::1"].includes(globalThis.location?.hostname || "")
) {
  globalThis.navigator.serviceWorker.register("./sw.js").catch(() => {});
}

function markBootStage(stage) {
  const guard = globalThis.NuvioBootGuard;
  if (guard && typeof guard.stage === "function") {
    guard.stage(stage);
  }
}

function startupNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function logStartupTiming(stage, startedAt, extra = {}) {
  if (!STARTUP_PERF_DEBUG) return;
  console.info("[startup-perf]", stage, {
    ms: Number((startupNow() - startedAt).toFixed(2)),
    ...extra
  });
}

function isSignedOutRouteAllowed() {
  return SIGNED_OUT_ALLOWED_ROUTES.has(Router.getCurrent());
}

function formatErrorMessage(error) {
  if (!error) {
    return "Unknown error";
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error?.stack || error?.message || error);
}

function renderFatalError(error) {
  const message = formatErrorMessage(error);
  const guard = globalThis.NuvioBootGuard;
  if (guard && typeof guard.fail === "function" && guard.isActive?.()) {
    guard.fail(
      "Something went wrong while the application was starting.",
      message,
      "BOOT-APPLICATION"
    );
    return;
  }
  document.body.innerHTML = `
    <div style="min-height:100vh;background:#0f1115;color:#f4f7fb;padding:48px;font-family:Arial,sans-serif;">
      <div style="max-width:960px;margin:0 auto;">
        <h1 style="margin:0 0 16px;font-size:42px;">Nuvio failed to start</h1>
        <p style="margin:0 0 20px;font-size:20px;color:#c7d0dd;">Startup hit an error before the app UI rendered.</p>
        <pre style="white-space:pre-wrap;word-break:break-word;background:#171b22;border:1px solid #2b3340;border-radius:12px;padding:20px;font-size:18px;line-height:1.5;">${message}</pre>
      </div>
    </div>
  `;
}

function isLowEndDevice() {
  const hardware = Number(globalThis.navigator?.hardwareConcurrency || 0);
  const memory = Number(globalThis.navigator?.deviceMemory || 0);
  const lowCpu = Number.isFinite(hardware) && hardware > 0 && hardware <= 4;
  const lowMem = Number.isFinite(memory) && memory > 0 && memory <= 2;
  return lowCpu || lowMem;
}

function applyPerformanceMode() {
  const constrained = isLowEndDevice();
  const rootClasses = document.documentElement.classList;
  const modernSidebarBlurCapable = !rootClasses.contains("no-backdrop-filter") && !constrained;
  document.documentElement.classList.toggle("performance-constrained", constrained);
  document.body.classList.toggle("performance-constrained", constrained);
  document.documentElement.classList.toggle(
    "modern-sidebar-blur-capable",
    modernSidebarBlurCapable
  );
  document.body.classList.toggle("modern-sidebar-blur-capable", modernSidebarBlurCapable);
  ["no-flex-gap", "no-aspect-ratio", "no-css-math", "no-backdrop-filter"].forEach((className) => {
    document.body.classList.toggle(className, rootClasses.contains(className));
  });
}

function isAddonRemoteMode() {
  try {
    return new URLSearchParams(window.location.search).get("addonsRemote") === "1";
  } catch {
    return false;
  }
}

async function shouldShowProfileSelection() {
  const startedAt = startupNow();
  // Browser profile cards use locally cached metadata immediately. Remote
  // profile and PIN refreshes continue after the picker becomes visible.
  if (Platform.isBrowser()) {
    const profiles = await ProfileManager.getProfiles();
    const activeProfileId = ProfileManager.getActiveProfileId();
    void Promise.all([ProfileSyncService.pull(), ProfileSyncService.pullProfileLockStates()])
      .then(async ([remoteProfiles, pinStates]) => {
        if (Router.getCurrent() !== "profileSelection") return;
        const screen = Router.getCurrentScreen();
        if (!screen) return;
        screen.profiles = remoteProfiles?.length ? remoteProfiles : await ProfileManager.getProfiles();
        screen.profilePinEnabled = pinStates || {};
        screen.activeProfileId = String(ProfileManager.getActiveProfileId() || "1");
        screen.render?.();
      })
      .catch((error) => console.warn("Background profile picker refresh failed", error));
    logStartupTiming("profile-selection-local-ready", startedAt, { profiles: profiles.length });
    return { show: profiles.length > 1, pinStates: {} };
  }
  const [, pinStates] = await Promise.all([
    ProfileSyncService.pull(),
    ProfileSyncService.pullProfileLockStates()
  ]);
  const profiles = await ProfileManager.getProfiles();
  const activeProfileId = ProfileManager.getActiveProfileId();
  const activeProfileHasPin = Boolean(
    pinStates?.[String(activeProfileId)] || pinStates?.[Number(activeProfileId)]
  );

  if (hasSelectedProfileThisSession) {
    return { show: false, pinStates };
  }

  // Remember last profile: when enabled and the last used profile has no PIN,
  // skip the picker and go straight in, matching the Android TV app. A profile
  // with a PIN always shows the picker so the PIN can be entered.
  if (
    ProfileManager.isRememberLastProfileEnabled() &&
    ProfileManager.hasEverSelectedProfile() &&
    !activeProfileHasPin
  ) {
    return { show: false, pinStates };
  }

  const result = { show: profiles.length > 1 || activeProfileHasPin, pinStates };
  logStartupTiming("profile-selection-ready", startedAt, { profiles: profiles.length });
  return result;
}

async function enterWithLastProfile() {
  const startedAt = startupNow();
  hasSelectedProfileThisSession = true;
  const profiles = await ProfileManager.getProfiles();
  const activeProfileId = ProfileManager.getActiveProfileId();
  const activeProfile =
    profiles.find((profile) => String(profile.id) === String(activeProfileId)) ||
    profiles[0] ||
    null;
  if (activeProfile) {
    await ProfileManager.setActiveProfile(activeProfile.id);
    StartupSyncService.enableProfileScopedSync();
    detailWatchedEnrichmentService.invalidateAllCache();
    await I18n.init();
    ThemeManager.apply();
    I18n.apply();
    void preloadStreamBadgeImages().catch((error) => {
      console.warn("Stream badge image prerender failed", error);
    });
  }
  const experienceRoute = activeProfile
    ? await resolveExperienceRoute(activeProfile.id, {
        pullRemoteSettings: !Platform.isBrowser()
      })
    : "home";
  if (experienceRoute !== "home") {
    await Router.navigate(experienceRoute, {}, { replaceHistory: true, skipStackPush: true });
  } else {
    await Router.navigate("home");
  }
  void StartupSyncService.requestSyncNow().catch((error) => {
    console.warn("Profile background sync failed", error);
  });
  logStartupTiming("enter-last-profile-route-mounted", startedAt, { route: experienceRoute });
}

async function routeAfterAuthentication() {
  const startedAt = startupNow();
  const profileRoute = await shouldShowProfileSelection();
  if (profileRoute.show) {
    await Router.navigate("profileSelection", {
      skipInitialProfileSync: true,
      profilePinEnabled: profileRoute.pinStates
    });
    logStartupTiming("route-profile-selection-mounted", startedAt);
    return;
  }

  await enterWithLastProfile();
}

function setupProviderCredentialForegroundLifecycle() {
  let wasBackgrounded =
    document.visibilityState === "hidden" || document.webkitHidden === true;
  const requestAfterBackground = () => {
    if (!wasBackgrounded) return;
    wasBackgrounded = false;
    ProviderCredentialSyncService.requestForegroundPull();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      wasBackgrounded = true;
    } else if (document.visibilityState === "visible") {
      requestAfterBackground();
    }
  });
  document.addEventListener("webkitvisibilitychange", () => {
    if (document.webkitHidden === true) {
      wasBackgrounded = true;
    } else {
      requestAfterBackground();
    }
  });
  window.addEventListener("pagehide", () => {
    wasBackgrounded = true;
  });
  window.addEventListener("pageshow", (event) => {
    if (event?.persisted) requestAfterBackground();
  });
  window.addEventListener("blur", () => {
    wasBackgrounded = true;
  });
  window.addEventListener("focus", requestAfterBackground);
}

async function bootstrapApp() {
  const bootstrapStartedAt = startupNow();
  markBootStage("Rendering application shell");
  renderAppShell();
  appShellRendered = true;
  markBootStage("Initializing platform");
  Platform.init();
  const isDesktopBrowser = Platform.isBrowser();
  document.documentElement.classList.toggle("desktop-browser", isDesktopBrowser);
  document.body.classList.toggle("desktop-browser", isDesktopBrowser);
  applyPerformanceMode();
  markBootStage("Loading language resources");
  await I18n.init();

  markBootStage("Initializing navigation");
  Router.init();
  PlayerController.init();
  if (isDesktopBrowser) {
    void initializeBrowserOfflineDownloadQueue().catch(() => {});
  }

  FocusEngine.init();
  setupProviderCredentialForegroundLifecycle();

  ThemeManager.apply();
  I18n.apply();
  warmStreamingLibs({ delayMs: 1400 });

  markBootStage("Restoring session");
  DeviceSessionRegistration.start();
  AuthManager.subscribe((state) => {
    if (state === AuthState.LOADING) {
      StartupSyncService.stop();
      ProviderCredentialSyncService.cancelForegroundPull();
      return;
    }

    if (state === AuthState.SIGNED_OUT) {
      StartupSyncService.stop();
      ProviderCredentialSyncService.cancelForegroundPull();
      hasSelectedProfileThisSession = false;
      const shouldBypassQr = Boolean(LocalStore.get(GUEST_QR_BYPASS_KEY, false));
      if (isSignedOutRouteAllowed()) {
        return;
      }
      if (shouldBypassQr) {
        // Honor "remember last profile" for guests too: skip the picker and go
        // straight in with the last profile (guests have no PIN).
        if (
          ProfileManager.isRememberLastProfileEnabled() &&
          ProfileManager.hasEverSelectedProfile()
        ) {
          enterWithLastProfile().catch((error) => {
            console.warn("Failed to enter with last profile", error);
            ProfileManager.clearActiveProfile();
            if (Router.getCurrent() !== "profileSelection") {
              Router.navigate(
                "profileSelection",
                {},
                { replaceHistory: true, skipStackPush: true }
              );
            }
          });
          return;
        }
        ProfileManager.clearActiveProfile();
        if (Router.getCurrent() !== "profileSelection") {
          Router.navigate(
            "profileSelection",
            {},
            {
              replaceHistory: true,
              skipStackPush: true
            }
          );
        }
        return;
      }
      // Browser sign-in uses the existing Supabase email/password screen.
      if (Platform.isBrowser()) {
        Router.navigate("authSignIn");
        return;
      }
      const hasSeenQr = LocalStore.get("hasSeenAuthQrOnFirstLaunch");
      Router.navigate("authQrSignIn", {
        onboardingMode: !hasSeenQr
      });
    }

    if (state === AuthState.AUTHENTICATED) {
      markBootStage("Loading profiles");
      LocalStore.remove(GUEST_QR_BYPASS_KEY);
      StartupSyncService.start({ runInitialPull: false });
      routeAfterAuthentication().catch((error) => {
        console.warn("Failed to resolve authenticated route", error);
        Router.navigate("profileSelection");
      });
    }
  });

  markBootStage("Checking authentication");
  await AuthManager.bootstrap();
  logStartupTiming("auth-bootstrap-complete", bootstrapStartedAt);
}

async function bootstrapAddonRemoteMode() {
  await renderAddonRemotePage();
  appShellRendered = true;
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      const bootstrap = isAddonRemoteMode() ? bootstrapAddonRemoteMode : bootstrapApp;
      bootstrap().catch((error) => {
        console.error("App bootstrap failed", error);
        renderFatalError(error);
      });
    },
    { once: true }
  );
} else {
  const bootstrap = isAddonRemoteMode() ? bootstrapAddonRemoteMode : bootstrapApp;
  bootstrap().catch((error) => {
    console.error("App bootstrap failed", error);
    renderFatalError(error);
  });
}

window.addEventListener("error", (event) => {
  if (!event?.error) {
    return;
  }
  if (!appShellRendered) {
    renderFatalError(event.error);
    return;
  }
  console.warn("Unhandled runtime error", event.error);
});

window.addEventListener("unhandledrejection", (event) => {
  if (!appShellRendered) {
    renderFatalError(event?.reason);
    return;
  }
  console.warn("Unhandled promise rejection", event?.reason);
});
