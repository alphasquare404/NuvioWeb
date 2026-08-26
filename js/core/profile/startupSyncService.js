import { AuthManager } from "../auth/authManager.js";
import { addonRepository } from "../../data/repository/addonRepository.js";
import { ProfileManager } from "./profileManager.js";
import { ProfileSyncService } from "./profileSyncService.js";
import { LibrarySyncService } from "./librarySyncService.js";
import { WatchProgressSyncService } from "./watchProgressSyncService.js";
import { SavedLibrarySyncService } from "./savedLibrarySyncService.js";
import { WatchedItemsSyncService } from "./watchedItemsSyncService.js";
import { PluginSyncService } from "./pluginSyncService.js";
import { ProfileSettingsSyncService } from "./profileSettingsSyncService.js";
import { TraktCredentialSyncService } from "./traktCredentialSyncService.js";
import { SimklCredentialSyncService } from "./simklCredentialSyncService.js";
import { ProviderCredentialSyncService } from "./providerCredentialSyncService.js";
import { SimklSyncService } from "../../data/repository/simklSyncService.js";
import { CollectionSyncService } from "./collectionSyncService.js";
import { HomeCatalogSettingsSyncService } from "./homeCatalogSettingsSyncService.js";
import { ThemeManager } from "../../ui/theme/themeManager.js";
import { I18n } from "../../i18n/index.js";
import { SyncHydrationState, SyncPullResult } from "./syncHydrationState.js";

const SYNC_INTERVAL_MS = 120000;
const ADDON_PUSH_DEBOUNCE_MS = 1000;
const MAX_PULL_ATTEMPTS = 3;
const STARTUP_SYNC_PERF_DEBUG = Boolean(globalThis.__NUVIO_DEBUG_STARTUP_PERF__);

function syncNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function logSyncTiming(stage, startedAt) {
  if (!STARTUP_SYNC_PERF_DEBUG) return;
  console.info("[startup-perf]", stage, { ms: Number((syncNow() - startedAt).toFixed(2)) });
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeProfileId(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

async function collectKnownProfileIds(profiles = []) {
  const ids = [
    normalizeProfileId(ProfileManager.getActiveProfileId()),
    ...(Array.isArray(profiles) ? profiles : []).map((profile) =>
      normalizeProfileId(profile?.id ?? profile?.profileIndex)
    )
  ].filter(Boolean);

  if (ids.length <= 1) {
    const storedProfiles = await ProfileManager.getProfiles().catch(() => []);
    ids.push(
      ...storedProfiles
        .map((profile) => normalizeProfileId(profile?.id ?? profile?.profileIndex))
        .filter(Boolean)
    );
  }

  return Array.from(new Set(ids));
}

export const StartupSyncService = {
  started: false,
  intervalId: null,
  inFlight: false,
  syncRequestedWhileInFlight: false,
  profileScopedSyncEnabled: false,
  addonPushTimer: null,
  addonSyncInFlight: null,
  addonSyncWaiters: [],
  addonSyncPending: false,
  unsubscribeAddonChanges: null,

  async start({ profileScopedSyncEnabled = false, runInitialPull = true } = {}) {
    if (this.started) {
      if (profileScopedSyncEnabled) {
        this.profileScopedSyncEnabled = true;
      }
      return;
    }
    this.started = true;
    SyncHydrationState.invalidate();
    this.profileScopedSyncEnabled = Boolean(profileScopedSyncEnabled);

    this.unsubscribeAddonChanges = addonRepository.onInstalledAddonsChanged((reason, mutation) => {
      // A completed remote pull updates mounted UI but is not a user mutation.
      // Scheduling a push here could make temporary defaults authoritative.
      if (reason === "remote-pull") {
        return;
      }
      LibrarySyncService.markLocalMutation(null, mutation);
      this.scheduleAddonPush();
    });

    if (runInitialPull) {
      await this.syncPull({ includeProfileScoped: this.profileScopedSyncEnabled });
    }

    this.intervalId = setInterval(() => {
      this.syncCycle();
    }, SYNC_INTERVAL_MS);
  },

  stop() {
    this.started = false;
    SyncHydrationState.invalidate();
    this.profileScopedSyncEnabled = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.addonPushTimer) {
      clearTimeout(this.addonPushTimer);
      this.addonPushTimer = null;
    }
    this.addonSyncWaiters.splice(0).forEach((resolve) => resolve(false));
    this.addonSyncPending = false;
    if (this.unsubscribeAddonChanges) {
      this.unsubscribeAddonChanges();
      this.unsubscribeAddonChanges = null;
    }
  },

  enableProfileScopedSync() {
    this.profileScopedSyncEnabled = true;
    SyncHydrationState.invalidate();
  },

  async requestSyncNow({ pushAfterPull = false } = {}) {
    if (!this.started || this.inFlight) {
      if (this.started && this.inFlight) this.syncRequestedWhileInFlight = true;
      return false;
    }
    this.inFlight = true;
    try {
      const includeProfileScoped = this.profileScopedSyncEnabled;
      const pullResults = await this.syncPull({ includeProfileScoped });
      if (pushAfterPull && includeProfileScoped) {
        await this.syncPush(pullResults);
      }
      return true;
    } finally {
      this.inFlight = false;
      if (this.syncRequestedWhileInFlight && this.started) {
        this.syncRequestedWhileInFlight = false;
        void this.requestSyncNow({ pushAfterPull: false });
      }
    }
  },

  async syncPull({ includeProfileScoped = this.profileScopedSyncEnabled } = {}) {
    if (!AuthManager.isAuthenticated) {
      return {};
    }
    let didApplyProfileSettings = false;
    const pullResults = {};
    const syncStartedAt = syncNow();
    const activeProfileId = ProfileManager.getActiveProfileId();
    for (let attempt = 1; attempt <= MAX_PULL_ATTEMPTS; attempt += 1) {
      try {
        const profiles = await ProfileSyncService.pull();
        logSyncTiming("background-profile-pull", syncStartedAt);
        const profileIds = await collectKnownProfileIds(profiles);
        for (const profileId of profileIds) {
          didApplyProfileSettings =
            (await ProfileSettingsSyncService.pull(profileId)) || didApplyProfileSettings;
        }
        logSyncTiming("background-profile-settings-pull", syncStartedAt);
        if (didApplyProfileSettings) {
          await I18n.init();
          ThemeManager.apply();
          I18n.apply();
        }
        await TraktCredentialSyncService.pullFromRemote(ProfileManager.getActiveProfileId());
        await SimklCredentialSyncService.pullFromRemote(ProfileManager.getActiveProfileId());
        await ProviderCredentialSyncService.syncFromRemote(ProfileManager.getActiveProfileId());
        logSyncTiming("background-credentials-pull", syncStartedAt);
        await SimklSyncService.refresh().catch((error) => {
          console.warn("Simkl automatic refresh failed", error);
        });
        logSyncTiming("background-simkl-refresh", syncStartedAt);
        if (!includeProfileScoped) {
          return pullResults;
        }
        pullResults.collections = await CollectionSyncService.pull(activeProfileId);
        await HomeCatalogSettingsSyncService.pull();
        pullResults.plugins = await PluginSyncService.pull();
        pullResults.addons = await LibrarySyncService.pull();
        await SavedLibrarySyncService.pull();
        await WatchedItemsSyncService.pull();
        await WatchProgressSyncService.pull();
        const succeeded = (result) =>
          result?.result === SyncPullResult.SUCCESS_WITH_DATA ||
          result?.result === SyncPullResult.SUCCESS_EMPTY;
        if (succeeded(pullResults.addons) && LibrarySyncService.hasPendingLocalMutation()) {
          this.scheduleAddonPush();
        }
        if (
          succeeded(pullResults.collections) &&
          CollectionSyncService.hasPendingLocalMutation(activeProfileId)
        ) {
          CollectionSyncService.triggerPush(activeProfileId);
        }
        if (succeeded(pullResults.plugins) && PluginSyncService.hasPendingLocalMutation()) {
          void PluginSyncService.push({ automatic: true });
        }
        logSyncTiming("background-profile-scoped-pull", syncStartedAt);
        return pullResults;
      } catch (error) {
        console.warn(`Startup sync pull failed (attempt ${attempt}/${MAX_PULL_ATTEMPTS})`, error);
        if (attempt < MAX_PULL_ATTEMPTS) {
          await sleep(3000);
        }
      }
    }
    return pullResults;
  },

  async syncPush(pullResults = {}) {
    if (!AuthManager.isAuthenticated) {
      return;
    }
    try {
      const allow = (result) =>
        result?.result === SyncPullResult.SUCCESS_WITH_DATA ||
        result?.result === SyncPullResult.SUCCESS_EMPTY;
      if (allow(pullResults.collections)) {
        await CollectionSyncService.push(null, { automatic: true });
      }
      if (allow(pullResults.plugins)) {
        await PluginSyncService.push({ automatic: true });
      }
      if (allow(pullResults.addons)) {
        await LibrarySyncService.push({ automatic: true });
      }
    } catch (error) {
      console.warn("Startup sync push failed", error);
    }
  },

  async syncCycle() {
    return this.requestSyncNow({ pushAfterPull: true });
  },

  scheduleAddonPush() {
    void this.requestAddonSync();
  },

  requestAddonSync() {
    if (!this.started || !this.profileScopedSyncEnabled || !AuthManager.isAuthenticated) {
      return Promise.resolve(false);
    }

    return new Promise((resolve) => {
      this.addonSyncWaiters.push(resolve);
      if (this.addonSyncInFlight) {
        this.addonSyncPending = true;
        return;
      }
      if (this.addonPushTimer) {
        clearTimeout(this.addonPushTimer);
      }
      this.addonPushTimer = setTimeout(() => {
        this.addonPushTimer = null;
        void this.flushAddonSync();
      }, ADDON_PUSH_DEBOUNCE_MS);
    });
  },

  async flushAddonSync() {
    if (this.addonSyncInFlight) {
      this.addonSyncPending = true;
      return this.addonSyncInFlight;
    }
    if (!this.started || !this.profileScopedSyncEnabled) {
      return false;
    }
    const run = async () => {
      let synced = true;
      do {
        this.addonSyncPending = false;
        try {
          synced = (await LibrarySyncService.push()) && synced;
        } catch (error) {
          console.warn("Addon auto push failed", error);
          synced = false;
        }
      } while (this.addonSyncPending);

      this.addonSyncWaiters.splice(0).forEach((resolve) => resolve(synced));
      return synced;
    };
    this.addonSyncInFlight = run();
    try {
      return await this.addonSyncInFlight;
    } finally {
      this.addonSyncInFlight = null;
      if (this.addonSyncPending) {
        void this.flushAddonSync();
      }
    }
  }
};
