import { ScreenUtils } from "../../navigation/screen.js";
import { Router } from "../../navigation/router.js";
import { Platform } from "../../../platform/index.js";
import { TraktAuthService } from "../../../data/repository/traktAuthService.js";
import { SimklAuthService } from "../../../data/repository/simklAuthService.js";
import { SimklSyncService } from "../../../data/repository/simklSyncService.js";
import {
  SimklAnimeIdPreference,
  MoreLikeThisSourcePreference,
  TraktLibrarySourceMode,
  TraktSettingsStore,
  WatchProgressSource,
  normalizeTraktContinueWatchingDaysCap
} from "../../../data/local/traktSettingsStore.js";
import { I18n } from "../../../i18n/index.js";
import {
  SettingsScreen,
  bindSettingsScrollIndicators,
  scrollSettingsContentItem
} from "../settings/settingsScreen.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function focusNode(node) {
  if (!node || typeof node.focus !== "function") {
    return;
  }
  try {
    node.focus({ preventScroll: true });
  } catch (_) {
    node.focus();
  }
}

function captureTraktScrollState(container) {
  const scrollArea = container?.querySelector?.(".settings-trakt-scroll-area");
  return {
    traktScrollTop: Number(scrollArea?.scrollTop || 0)
  };
}

function restoreTraktScrollState(container, scrollState) {
  const scrollArea = container?.querySelector?.(".settings-trakt-scroll-area");
  if (scrollArea && scrollState) {
    scrollArea.scrollTop = Number(scrollState.traktScrollTop || 0);
  }
}

function formatCountdown(valueMs) {
  const totalSeconds = Math.max(0, Math.floor(Number(valueMs || 0) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor(totalSeconds / 3600) % 24;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

const TRAKT_ROUTE_ENTER_DURATION_MS = 350;

export const TraktScreen = Object.assign(Object.create(SettingsScreen), {
  async mount() {
    this.container = document.getElementById("trakt");
    ScreenUtils.show(this.container);
    this.activeSection = "trakt";
    this.focusZone = "content";
    this.contentFocusKey = this.contentFocusKey || null;
    this.optionDialog = this.optionDialog || null;
    this.dialogFocusIndex = Number.isFinite(this.dialogFocusIndex) ? this.dialogFocusIndex : 0;
    this.traktRouteEnterPending = true;
    this.traktRouteAutoWorkDeferred = true;
    this.expandedProvider = this.expandedProvider || null;
    if (!this.handleClickBound) {
      this.handleClickBound = this.handleClickEvent.bind(this);
      this.container.addEventListener("click", this.handleClickBound);
    }
    await this.render();
    this.deferTraktAutoWork("clock");
    if (TraktAuthService.isAuthenticated()) {
      this.deferTraktAutoWork("stats");
    }
  },

  deferTraktAutoWork(kind) {
    const key = String(kind || "");
    if (!key || Router.getCurrent() !== "trakt" || !this.traktRouteAutoWorkDeferred) {
      return false;
    }
    this.pendingTraktAutoWork = {
      ...(this.pendingTraktAutoWork || {}),
      [key]: true
    };
    this.scheduleTraktRouteAutoWork();
    return true;
  },

  scheduleTraktRouteAutoWork() {
    if (this.traktRouteAutoWorkTimer) {
      return;
    }
    this.traktRouteAutoWorkTimer = setTimeout(() => {
      this.traktRouteAutoWorkTimer = null;
      this.runTraktRouteAutoWork();
    }, TRAKT_ROUTE_ENTER_DURATION_MS + 80);
  },

  runTraktRouteAutoWork() {
    const pending = this.pendingTraktAutoWork || {};
    this.pendingTraktAutoWork = null;
    this.traktRouteAutoWorkDeferred = false;
    if (Router.getCurrent() !== "trakt") {
      return;
    }
    if (pending.clock) {
      this.startTraktClock();
    }
    if (pending.polling) {
      this.startTraktPolling();
    }
    if (pending.stats && !this.traktStats && !this.traktStatsLoading) {
      void this.loadTraktStats(false).then(() => {
        if (Router.getCurrent() === "trakt" && this.container && this.activeSection === "trakt") {
          void this.render();
        }
      });
    }
    if (SimklAuthService.getCurrentAuthState().userCode) {
      this.startSimklPolling();
    }
  },

  async render({ refreshModel = true } = {}) {
    const previousScrollState = captureTraktScrollState(this.container);
    if (refreshModel || !this.model) this.model = {};
    this.actionMap = new Map();
    const rawPanelHtml = this.renderTrackingSection();
    const panelHtml = this.traktRouteEnterPending
      ? rawPanelHtml
      : rawPanelHtml.replace("settings-slide-panel ", "");
    this.actionMap.set("trakt:back", () => Router.back());
    this.container.innerHTML = `
      <div class="trakt-route-shell${this.traktRouteEnterPending ? " trakt-route-enter" : ""}">
        <div class="trakt-route-content">
          ${panelHtml}
        </div>
        <div data-trakt-dialog>${this.renderOptionDialog()}</div>
      </div>
    `;
    restoreTraktScrollState(this.container, previousScrollState);
    ScreenUtils.indexFocusables(this.container);
    bindSettingsScrollIndicators(this.container);
    this.traktRouteEnterPending = false;
    this.suppressNextContentFocusScroll = true;
    this.applyFocus();
    restoreTraktScrollState(this.container, previousScrollState);
    this.updateTraktCountdowns();
  },

  startTraktClock() {
    if (this.traktClockTimer) {
      return;
    }
    this.updateTraktCountdowns();
    this.traktClockTimer = setInterval(() => {
      if (Router.getCurrent() !== "trakt") {
        this.stopTraktClock();
        return;
      }
      this.updateTraktCountdowns();
    }, 1000);
  },

  stopTraktClock() {
    if (!this.traktClockTimer) {
      return;
    }
    clearInterval(this.traktClockTimer);
    this.traktClockTimer = null;
  },

  updateTraktCountdowns() {
    if (!this.container) {
      return;
    }
    const auth = TraktAuthService.getCurrentAuthState();
    const deviceCountdown = this.container.querySelector("[data-trakt-device-countdown]");
    if (deviceCountdown && auth.expiresAt) {
      deviceCountdown.textContent = formatCountdown(Number(auth.expiresAt) - Date.now());
    }

    const tokenCountdown = this.container.querySelector("[data-trakt-token-countdown]");
    if (tokenCountdown && auth.createdAt && auth.expiresIn) {
      const expiresAtMs = (Number(auth.createdAt) + Number(auth.expiresIn)) * 1000;
      tokenCountdown.textContent = formatCountdown(expiresAtMs - Date.now());
    }
    const simklAuth = SimklAuthService.getCurrentAuthState();
    const simklCountdown = this.container.querySelector("[data-simkl-device-countdown]");
    if (simklCountdown && simklAuth.expiresAt) {
      simklCountdown.textContent = formatCountdown(Number(simklAuth.expiresAt) - Date.now());
    }
  },

  openTrackingChoice({ title, options, selectedId, returnFocusKey, onSelect }) {
    this.openOptionDialog({
      title,
      options: options.map((option) => ({ ...option, label: option.label || option.id })),
      selectedId,
      returnFocusKey,
      onSelect
    });
  },

  renderTrackingSection() {
    const trakt = TraktAuthService.getCurrentAuthState();
    const simkl = SimklAuthService.getCurrentAuthState();
    const settings = TraktSettingsStore.get();
    const traktConnected = TraktAuthService.isAuthenticated();
    const simklConnected = SimklAuthService.isAuthenticated();
    const traktWaiting = Boolean(trakt.deviceCode && trakt.expiresAt > Date.now());
    const simklWaiting = Boolean(simkl.userCode && simkl.expiresAt > Date.now());
    const connectedWatchSources = [
      { id: WatchProgressSource.NUVIO_SYNC, label: "Nuvio Sync" },
      ...(traktConnected ? [{ id: WatchProgressSource.TRAKT, label: "Trakt" }] : []),
      ...(simklConnected ? [{ id: WatchProgressSource.SIMKL, label: "Simkl" }] : [])
    ];
    const connectedLibrarySources = [
      { id: TraktLibrarySourceMode.LOCAL, label: "Nuvio" },
      ...(traktConnected ? [{ id: TraktLibrarySourceMode.TRAKT, label: "Trakt" }] : []),
      ...(simklConnected ? [{ id: TraktLibrarySourceMode.SIMKL, label: "Simkl" }] : [])
    ];

    this.actionMap.set("tracking:trakt", () => {
      this.expandedProvider = this.expandedProvider === "trakt" ? null : "trakt";
    });
    this.actionMap.set("tracking:simkl", () => {
      this.expandedProvider = this.expandedProvider === "simkl" ? null : "simkl";
    });
    this.actionMap.set("tracking:traktConnect", async () => {
      await this.startTraktDeviceAuth();
      this.expandedProvider = "trakt";
    });
    this.actionMap.set("tracking:simklConnect", async () => {
      this.simklErrorMessage = null;
      try {
        await SimklAuthService.startPinAuth();
        this.simklStatusMessage = t("simkl_status_enter_code", {}, "Enter the code on Simkl to finish connecting.");
        this.startSimklPolling();
      } catch (error) {
        this.simklErrorMessage = String(
          error?.message || error || t("simkl_error_network", {}, "Unable to reach Simkl. Try again.")
        );
      }
      this.expandedProvider = "simkl";
    });
    this.actionMap.set("tracking:traktDisconnect", () => {
      this.openOptionDialog({
        title: t("trakt_disconnect_title", {}, "Disconnect Trakt?"),
        options: [
          { id: "disconnect", label: t("trakt_disconnect", {}, "Disconnect") },
          { id: "cancel", label: t("action_cancel", {}, "Cancel") }
        ],
        selectedId: "cancel",
        returnFocusKey: "tracking:trakt",
        onSelect: async (option) => {
          if (option.id !== "disconnect") return;
          await TraktAuthService.disconnect();
          if (settings.watchProgressSource === WatchProgressSource.TRAKT) {
            TraktSettingsStore.setWatchProgressSource(WatchProgressSource.NUVIO_SYNC);
          }
          if (settings.librarySourceMode === TraktLibrarySourceMode.TRAKT) {
            TraktSettingsStore.setLibrarySourceMode(TraktLibrarySourceMode.LOCAL);
          }
        }
      });
    });
    this.actionMap.set("tracking:simklDisconnect", () => {
      this.openOptionDialog({
        title: t("simkl_disconnect_title", {}, "Disconnect Simkl?"),
        options: [
          { id: "disconnect", label: t("simkl_disconnect", {}, "Disconnect") },
          { id: "cancel", label: t("action_cancel", {}, "Cancel") }
        ],
        selectedId: "cancel",
        returnFocusKey: "tracking:simkl",
        onSelect: async (option) => {
          if (option.id !== "disconnect") return;
          await SimklAuthService.disconnect();
          SimklSyncService.clearCurrentProfile();
          if (settings.watchProgressSource === WatchProgressSource.SIMKL) {
            TraktSettingsStore.setWatchProgressSource(WatchProgressSource.NUVIO_SYNC);
          }
          if (settings.librarySourceMode === TraktLibrarySourceMode.SIMKL) {
            TraktSettingsStore.setLibrarySourceMode(TraktLibrarySourceMode.LOCAL);
          }
        }
      });
    });
    this.actionMap.set("tracking:simklSync", async () => {
      this.simklStatusMessage = t("simkl_status_syncing", {}, "Syncing Simkl…");
      this.simklErrorMessage = null;
      try {
        await SimklSyncService.refresh({ force: true });
        this.simklStatusMessage = t("simkl_status_synced", {}, "Simkl sync completed.");
      } catch (error) {
        this.simklStatusMessage = null;
        this.simklErrorMessage = String(
          error?.message || error || t("simkl_error_network", {}, "Unable to reach Simkl. Try again.")
        );
      }
    });
    this.actionMap.set("tracking:simklInfo", () => {
      this.showSimklInfo = !this.showSimklInfo;
    });
    this.actionMap.set("tracking:simklVisit", () => window.open?.("https://simkl.com", "_blank"));
    this.actionMap.set("tracking:simklDocs", () => window.open?.("https://api.simkl.org/guides/sync", "_blank"));
    this.actionMap.set("tracking:librarySource", () =>
      this.openTrackingChoice({
        title: t("trakt_library_source_title", {}, "Library source"),
        options: connectedLibrarySources,
        selectedId: settings.librarySourceMode,
        returnFocusKey: "tracking:librarySource",
        onSelect: (option) => TraktSettingsStore.setLibrarySourceMode(option.id)
      })
    );
    this.actionMap.set("tracking:progressSource", () =>
      this.openTrackingChoice({
        title: t("trakt_watch_progress_source_title", {}, "Watch progress source"),
        options: connectedWatchSources,
        selectedId: settings.watchProgressSource,
        returnFocusKey: "tracking:progressSource",
        onSelect: (option) => TraktSettingsStore.setWatchProgressSource(option.id)
      })
    );
    this.actionMap.set("tracking:cwWindow", () => {
      const values = [14, 30, 60, 90, 180, 365, 0];
      this.openTrackingChoice({
        title: t("trakt_continue_watching_window", {}, "Continue Watching window"),
        options: values.map((days) => ({
          id: String(days),
          label:
            days === 0
              ? t("trakt_all_history", {}, "All history")
              : t("trakt_days_format", [days], `${days} days`)
        })),
        selectedId: String(settings.continueWatchingDaysCap),
        returnFocusKey: "tracking:cwWindow",
        onSelect: (option) =>
          TraktSettingsStore.setContinueWatchingDaysCap(
            normalizeTraktContinueWatchingDaysCap(Number(option.id))
          )
      });
    });
    this.actionMap.set("tracking:comments", () => {
      TraktSettingsStore.setShowMetaComments(!settings.showMetaComments);
    });
    this.actionMap.set("tracking:moreLikeThis", () =>
      this.openTrackingChoice({
        title: t("tracking_more_like_this_source", {}, "More Like This source"),
        options: [
          { id: MoreLikeThisSourcePreference.TRAKT, label: "Trakt" },
          { id: MoreLikeThisSourcePreference.TMDB, label: "TMDB" }
        ],
        selectedId: settings.moreLikeThisSource,
        returnFocusKey: "tracking:moreLikeThis",
        onSelect: (option) => TraktSettingsStore.setMoreLikeThisSource(option.id)
      })
    );
    this.actionMap.set("tracking:animeId", () =>
      this.openTrackingChoice({
        title: t("tracking_simkl_anime_id_title", {}, "Simkl anime ID"),
        options: [
          { id: SimklAnimeIdPreference.IMDB, label: "IMDb / TMDB" },
          { id: SimklAnimeIdPreference.MAL, label: "MyAnimeList" },
          { id: SimklAnimeIdPreference.KITSU, label: "Kitsu" }
        ],
        selectedId: settings.simklAnimeIdPreference,
        returnFocusKey: "tracking:animeId",
        onSelect: (option) => {
          TraktSettingsStore.setSimklAnimeIdPreference(option.id);
          SimklSyncService.clearCurrentProfile();
          void SimklSyncService.refresh({ force: true });
        }
      })
    );

    const providerRow = ({ id, title, connected, waiting, username }) =>
      this.renderActionRow({
        focusKey: `tracking:${id}`,
        leadingIconSrc:
          id === "simkl"
            ? "assets/icons/simkl_tv_glyph.svg"
            : "assets/icons/trakt_tv_glyph.svg",
        title,
        subtitle: connected
          ? t(id === "simkl" ? "simkl_connected_as" : "trakt_connected_as", [username || `${title} user`], `Connected as ${username || `${title} user`}`)
          : waiting
            ? t("tracking_status_waiting", {}, "Waiting for approval")
            : t(id === "simkl" ? "simkl_connect" : "trakt_connect", {}, `Connect ${title}`),
        value: connected ? t("tracking_status_connected", {}, "Connected") : waiting ? t("tracking_status_waiting", {}, "Waiting") : t("tracking_status_disconnected", {}, "Not connected")
      });

    return `
      <section class="settings-slide-panel settings-trakt-panel settings-tracking-panel">
        <div class="settings-trakt-hero settings-tracking-hero">
          <div>
            <div class="settings-trakt-title">${escapeHtml(t("settings_tracking_title", {}, "Tracking"))}</div>
            <p class="settings-trakt-description">${escapeHtml(t("settings_tracking_description", {}, "Connect tracking providers and choose which one powers your Library and Continue Watching."))}</p>
          </div>
        </div>
        <div class="settings-trakt-scroll-area">
          <div class="settings-trakt-card">
            <h3 class="settings-trakt-card-title">${escapeHtml(t("tracking_accounts_title", {}, "Accounts"))}</h3>
            <div class="settings-trakt-options-stack">
              ${providerRow({ id: "trakt", title: "Trakt", connected: traktConnected, waiting: traktWaiting, username: trakt.username })}
              ${providerRow({ id: "simkl", title: "Simkl", connected: simklConnected, waiting: simklWaiting, username: simkl.username })}
            </div>
          </div>
          ${this.expandedProvider === "trakt" ? this.renderTrackingTraktAccount(trakt, traktConnected, traktWaiting) : ""}
          ${this.expandedProvider === "simkl" ? this.renderTrackingSimklAccount(simkl, simklConnected, simklWaiting) : ""}
          <div class="settings-trakt-card">
            <h3 class="settings-trakt-card-title">${escapeHtml(t("tracking_sources_title", {}, "Sources"))}</h3>
            <div class="settings-trakt-options-stack">
              ${this.renderActionRow({ focusKey: "tracking:librarySource", title: t("trakt_library_source_title", {}, "Library source"), subtitle: t("tracking_library_source_dialog_subtitle", {}, "Choose the service Nuvio reads for your Library."), value: connectedLibrarySources.find((item) => item.id === settings.librarySourceMode)?.label || "Nuvio" })}
              ${this.renderActionRow({ focusKey: "tracking:progressSource", title: t("trakt_watch_progress_source_title", {}, "Watch progress source"), subtitle: t("tracking_watch_progress_dialog_subtitle", {}, "Choose the service Nuvio reads for resume and Continue Watching."), value: connectedWatchSources.find((item) => item.id === settings.watchProgressSource)?.label || "Nuvio Sync" })}
            </div>
          </div>
          <div class="settings-trakt-card">
            <h3 class="settings-trakt-card-title">${escapeHtml(t("tracking_trakt_features_title", {}, "Tracking behavior"))}</h3>
            <div class="settings-trakt-options-stack">
              ${traktConnected ? this.renderActionRow({ focusKey: "tracking:cwWindow", title: t("trakt_continue_watching_window", {}, "Continue Watching window"), subtitle: t("trakt_continue_watching_subtitle", {}, "Trakt history considered for Continue Watching"), value: settings.continueWatchingDaysCap === 0 ? t("trakt_all_history", {}, "All history") : t("trakt_days", [settings.continueWatchingDaysCap], `${settings.continueWatchingDaysCap} days`) }) : ""}
              ${traktConnected ? this.renderToggleRow({ focusKey: "tracking:comments", title: t("trakt_comments_title", {}, "Trakt comments"), subtitle: t("trakt_comments_subtitle", {}, "Show Trakt reviews on metadata pages"), checked: Boolean(settings.showMetaComments) }) : ""}
              ${traktConnected ? this.renderActionRow({ focusKey: "tracking:moreLikeThis", title: t("tracking_more_like_this_source", {}, "More Like This source"), subtitle: t("tracking_more_like_this_source_subtitle", {}, "Choose related titles from Trakt or TMDB"), value: settings.moreLikeThisSource === MoreLikeThisSourcePreference.TMDB ? "TMDB" : "Trakt" }) : ""}
              ${simklConnected ? this.renderActionRow({ focusKey: "tracking:animeId", title: t("tracking_simkl_anime_id_title", {}, "Simkl anime ID"), subtitle: t("tracking_simkl_anime_id_subtitle", {}, "Preferred catalog identity for anime matching"), value: settings.simklAnimeIdPreference === "mal" ? "MyAnimeList" : settings.simklAnimeIdPreference === "kitsu" ? "Kitsu" : "IMDb / TMDB" }) : ""}
            </div>
          </div>
          ${simklConnected ? `<p class="settings-trakt-meta-copy settings-tracking-attribution">${escapeHtml(t("licenses_attributions_simkl_body", {}, "Library and tracking data provided by Simkl."))}</p>` : ""}
        </div>
      </section>
    `;
  },

  renderTrackingTraktAccount(auth, connected, waiting) {
    if (connected) {
      const tokenRemainingMs = auth.createdAt && auth.expiresIn ? Math.max(0, (Number(auth.createdAt) + Number(auth.expiresIn)) * 1000 - Date.now()) : 0;
      return `<div class="settings-trakt-card settings-tracking-account-card"><h3 class="settings-trakt-card-title">${escapeHtml(t("trakt_account_login", {}, "Trakt account"))}</h3><p class="settings-trakt-body-copy">${escapeHtml(t("trakt_connected_as", [auth.username || "Trakt user"], `Connected as ${auth.username || "Trakt user"}`))}</p>${tokenRemainingMs ? `<p class="settings-trakt-meta-copy">${escapeHtml(t("trakt_token_refreshes", [formatCountdown(tokenRemainingMs)], `Token refreshes in ${formatCountdown(tokenRemainingMs)}`))}</p>` : ""}${this.renderTraktStatsStrip(this.traktStats, this.traktStatsLoading)}${this.renderActionRow({ focusKey: "tracking:traktDisconnect", title: t("trakt_disconnect", {}, "Disconnect Trakt"), subtitle: t("trakt_disconnect_subtitle", {}, "Remove this profile's Trakt connection") })}</div>`;
    }
    return `<div class="settings-trakt-card settings-tracking-account-card"><h3 class="settings-trakt-card-title">${escapeHtml(t("trakt_connect", {}, "Connect Trakt"))}</h3>${waiting ? `<p class="settings-trakt-body-copy">${escapeHtml(t("trakt_awaiting_instruction", {}, "Open the Trakt activation page on another device and enter this code."))}</p><strong>${escapeHtml(auth.verificationUrl || "https://trakt.tv/activate")}</strong><div class="settings-trakt-code">${escapeHtml(auth.userCode || "-")}</div><p class="settings-trakt-meta-copy">${escapeHtml(t("trakt_code_expires", [formatCountdown(Number(auth.expiresAt) - Date.now())], `Code expires in ${formatCountdown(Number(auth.expiresAt) - Date.now())}`))}</p>` : `<p class="settings-trakt-body-copy">${escapeHtml(t("trakt_manual_code_description", {}, "A manual activation code will be shown here. No QR code is required."))}</p>${this.renderActionRow({ focusKey: "tracking:traktConnect", title: t("trakt_connect", {}, "Connect Trakt"), subtitle: TraktAuthService.hasRequiredCredentials() ? t("trakt_generate_code", {}, "Generate activation code") : t("trakt_missing_credentials", {}, "Missing Trakt client credentials") })}`}${this.traktStatusMessage ? `<p class="settings-trakt-message">${escapeHtml(this.traktStatusMessage)}</p>` : ""}${this.traktErrorMessage ? `<p class="settings-trakt-error">${escapeHtml(this.traktErrorMessage)}</p>` : ""}</div>`;
  },

  renderTrackingSimklAccount(auth, connected, waiting) {
    if (connected) {
      return `<div class="settings-trakt-card settings-tracking-account-card"><h3 class="settings-trakt-card-title">${escapeHtml(t("simkl_account_title", {}, "Simkl account"))}</h3><p class="settings-trakt-body-copy">${escapeHtml(t("simkl_connected_as", [auth.username || "Simkl user"], `Connected as ${auth.username || "Simkl user"}`))}</p>${this.renderActionRow({ focusKey: "tracking:simklSync", title: t("simkl_sync_now", {}, "Sync now"), subtitle: t("simkl_status_syncing", {}, "Check Simkl immediately for remote changes") })}${this.renderActionRow({ focusKey: "tracking:simklVisit", title: t("simkl_visit", {}, "Visit Simkl") })}${this.renderActionRow({ focusKey: "tracking:simklInfo", title: t("simkl_sync_info_action", {}, "How syncing works"), subtitle: t("simkl_sync_info_title", {}, "Automatic refresh and Continue Watching rules") })}${this.showSimklInfo ? `<div class="settings-tracking-sync-info"><p>${escapeHtml(t("simkl_sync_info_description", [15], "Nuvio checks Simkl automatically at most once every 15 minutes."))}</p><p>${escapeHtml(t("simkl_sync_info_activity", {}, "Each refresh downloads only changes."))}</p><p>${escapeHtml(t("simkl_sync_info_manual", {}, "Changes made in Nuvio are sent immediately."))}</p><p>${escapeHtml(t("simkl_sync_info_library_statuses", {}, "On Hold and Dropped shows stay hidden from Continue Watching."))}</p>${this.renderActionRow({ focusKey: "tracking:simklDocs", title: t("simkl_sync_info_docs", {}, "Read the Simkl sync guide") })}</div>` : ""}${this.renderActionRow({ focusKey: "tracking:simklDisconnect", title: t("simkl_disconnect", {}, "Disconnect Simkl"), subtitle: t("simkl_disconnect_subtitle", {}, "Remove this profile's Simkl connection") })}${this.simklStatusMessage ? `<p class="settings-trakt-message">${escapeHtml(this.simklStatusMessage)}</p>` : ""}${this.simklErrorMessage ? `<p class="settings-trakt-error">${escapeHtml(this.simklErrorMessage)}</p>` : ""}</div>`;
    }
    return `<div class="settings-trakt-card settings-tracking-account-card"><h3 class="settings-trakt-card-title">${escapeHtml(t("simkl_connect", {}, "Connect Simkl"))}</h3>${waiting ? `<p class="settings-trakt-body-copy">${escapeHtml(t("simkl_awaiting_instruction", {}, "Open the Simkl verification page and enter this code."))}</p><strong>${escapeHtml(auth.verificationUrl || "https://simkl.com/pin")}</strong><div class="settings-trakt-code">${escapeHtml(auth.userCode || "-")}</div><p class="settings-trakt-meta-copy">${escapeHtml(t("simkl_code_expires", [formatCountdown(Number(auth.expiresAt) - Date.now())], `Code expires in ${formatCountdown(Number(auth.expiresAt) - Date.now())}`))}</p>` : `<p class="settings-trakt-body-copy">${escapeHtml(t("simkl_description", {}, "A manual PIN will be shown here. Enter it on Simkl from a phone or computer."))}</p>${this.renderActionRow({ focusKey: "tracking:simklConnect", title: t("simkl_connect", {}, "Connect Simkl"), subtitle: SimklAuthService.hasRequiredCredentials() ? t("simkl_status_enter_code", {}, "Generate manual PIN") : t("simkl_missing_credentials", {}, "Missing SIMKL_CLIENT_ID") })}`}${this.simklStatusMessage ? `<p class="settings-trakt-message">${escapeHtml(this.simklStatusMessage)}</p>` : ""}${this.simklErrorMessage ? `<p class="settings-trakt-error">${escapeHtml(this.simklErrorMessage)}</p>` : ""}</div>`;
  },

  startSimklPolling(force = false) {
    if (this.simklPollTimer && !force) return;
    if (this.simklPollTimer) clearTimeout(this.simklPollTimer);
    const poll = async () => {
      const state = SimklAuthService.getCurrentAuthState();
      if (!state.userCode || Router.getCurrent() !== "trakt") {
        this.simklPollTimer = null;
        return;
      }
      const result = await SimklAuthService.pollPin().catch((error) => ({
        type: "failed",
        message: String(
          error?.message ||
            error ||
            t("simkl_error_network", {}, "Unable to reach Simkl. Try again.")
        )
      }));
      if (result.type === "approved") {
        this.simklPollTimer = null;
        this.simklStatusMessage = t(
          "simkl_connected_as",
          [result.username || "Simkl"],
          `Connected as ${result.username || "Simkl"}`
        );
        await SimklSyncService.refresh({ force: true }).catch(() => false);
        await this.render();
        return;
      }
      if (result.type === "pending") {
        this.simklStatusMessage = t(
          "simkl_status_waiting",
          {},
          "Waiting for Simkl approval…"
        );
      } else if (result.type === "expired" || result.type === "invalidated") {
        this.simklErrorMessage = t(
          "simkl_error_code_expired",
          {},
          "Simkl code expired. Start again."
        );
        this.simklPollTimer = null;
        await this.render();
        return;
      } else if (result.type === "failed") {
        this.simklErrorMessage = result.message;
        this.simklPollTimer = null;
        await this.render();
        return;
      }
      await this.render();
      const next = SimklAuthService.getCurrentAuthState();
      this.simklPollTimer = setTimeout(
        () => {
          this.simklPollTimer = null;
          void poll();
        },
        Math.max(1, Number(next.pollInterval || 5)) * 1000
      );
    };
    void poll();
  },

  applyFocus() {
    this.container
      ?.querySelectorAll?.(".focusable.focused")
      .forEach((node) => node.classList.remove("focused"));
    if (this.optionDialog) {
      const dialogNode =
        this.container.querySelector(
          `.settings-dialog-option[data-dialog-index="${this.dialogFocusIndex}"]`
        ) || this.container.querySelector(".settings-dialog-option");
      if (dialogNode) {
        dialogNode.classList.add("focused");
        focusNode(dialogNode);
        scrollSettingsContentItem(dialogNode);
      }
      return;
    }

    const selector = this.contentFocusKey
      ? `.settings-content-focusable[data-focus-key="${String(this.contentFocusKey).replace(/["\\]/g, "\\$&")}"]`
      : null;
    const target = selector ? this.container.querySelector(selector) : null;
    const fallback = target || this.container.querySelector(".settings-content-focusable");
    if (!fallback) {
      return;
    }
    fallback.classList.add("focused");
    focusNode(fallback);
    if (this.suppressNextContentFocusScroll) {
      this.suppressNextContentFocusScroll = false;
    } else {
      scrollSettingsContentItem(fallback);
    }
    this.contentFocusKey = String(fallback.dataset.focusKey || "");
  },

  async handleClickEvent(event) {
    const target = event?.target?.closest?.(".settings-content-focusable, .settings-dialog-option");
    if (!target || !this.container?.contains?.(target)) {
      return;
    }
    event?.preventDefault?.();
    this.container
      .querySelectorAll(".focusable.focused")
      .forEach((node) => node.classList.remove("focused"));
    target.classList.add("focused");
    focusNode(target);
    if (target.classList.contains("settings-dialog-option")) {
      const dialogIndex = Number(target.dataset.dialogIndex);
      if (Number.isFinite(dialogIndex)) {
        this.dialogFocusIndex = dialogIndex;
      }
    } else {
      this.focusZone = "content";
      this.contentFocusKey = String(target.dataset.focusKey || this.contentFocusKey || "");
    }
    await this.activateFocused();
  },

  async activateFocused() {
    if (this.optionDialog) {
      const option = this.optionDialog.options[this.dialogFocusIndex];
      if (!option) {
        return;
      }
      if (typeof this.optionDialog.onSelect === "function") {
        await this.optionDialog.onSelect(option);
      }
      this.closeOptionDialog();
      await this.render();
      return;
    }

    const current = this.container.querySelector(".focusable.focused");
    const focusKey = String(current?.dataset?.focusKey || "");
    const action = this.actionMap.get(focusKey);
    if (!action) {
      return;
    }
    this.contentFocusKey = focusKey;
    await action();
    if (Router.getCurrent() === "trakt") {
      await this.render();
    }
  },

  focusContentByKey(focusKey) {
    const target = this.container?.querySelector(
      `.settings-content-focusable[data-focus-key="${String(focusKey || "").replace(/["\\]/g, "\\$&")}"]`
    );
    if (!target) {
      return false;
    }
    this.container
      ?.querySelectorAll?.(".focusable.focused")
      ?.forEach((node) => node.classList.remove("focused"));
    target.classList.add("focused");
    focusNode(target);
    scrollSettingsContentItem(target);
    this.contentFocusKey = String(target.dataset.focusKey || focusKey || "");
    return true;
  },

  moveFocus(direction) {
    const selector = this.optionDialog ? ".settings-dialog-option" : ".settings-content-focusable";
    const before = this.container.querySelector(`${selector}.focused`);
    const beforeFocusKey = String(before?.dataset?.focusKey || "");

    if (!this.optionDialog) {
      if (
        direction === "up" &&
        beforeFocusKey === "trakt:librarySource" &&
        this.focusContentByKey("trakt:disconnect")
      ) {
        return;
      }
      if (
        direction === "down" &&
        beforeFocusKey === "trakt:disconnect" &&
        this.focusContentByKey("trakt:librarySource")
      ) {
        return;
      }
    }

    ScreenUtils.moveFocusDirectional(this.container, direction, selector);
    const after = this.container.querySelector(`${selector}.focused`);
    if (after && after !== before) {
      if (this.optionDialog) {
        const dialogIndex = Number(after.dataset.dialogIndex);
        if (Number.isFinite(dialogIndex)) {
          this.dialogFocusIndex = dialogIndex;
        }
      } else {
        this.contentFocusKey = String(after.dataset.focusKey || "");
      }
      scrollSettingsContentItem(after);
    }
  },

  async onKeyDown(event) {
    if (Platform.isBackEvent(event)) {
      event?.preventDefault?.();
      if (this.optionDialog) {
        this.closeOptionDialog();
        await this.render({ refreshModel: false });
        return;
      }
      await Router.back();
      return;
    }

    const code = Number(event?.keyCode || 0);
    if (code === 38 || code === 40 || code === 37 || code === 39) {
      event?.preventDefault?.();
      if (this.optionDialog && (code === 37 || code === 39)) {
        return;
      }
      const direction = code === 38 ? "up" : code === 40 ? "down" : code === 37 ? "left" : "right";
      this.moveFocus(direction);
      return;
    }

    if (code === 13) {
      event?.preventDefault?.();
      await this.activateFocused();
    }
  },

  startTraktPolling(force = false) {
    if (this.traktPollTimer && !force) {
      return;
    }
    this.stopTraktPolling();
    const poll = async () => {
      const state = TraktAuthService.getCurrentAuthState();
      if (!state.deviceCode || Router.getCurrent() !== "trakt") {
        this.stopTraktPolling();
        return;
      }
      const result = await TraktAuthService.pollDeviceToken().catch((error) => ({
        type: "failed",
        message: String(
          error?.message ||
            error ||
            t("trakt_error_network_will_retry", {}, "Network error, will retry")
        )
      }));
      if (result.type === "approved") {
        this.stopTraktPolling();
        this.traktStatusMessage = t(
          "trakt_connected_as",
          [result.username || "Trakt"],
          `Connected as ${result.username || "Trakt"}`
        );
        this.traktErrorMessage = null;
        await this.loadTraktStats(true);
        await this.render();
        return;
      }
      if (result.type === "pending") {
        this.traktStatusMessage = t(
          "tracking_status_waiting",
          {},
          "Waiting for approval"
        );
        this.traktErrorMessage = null;
      } else if (result.type === "slow_down") {
        this.traktStatusMessage = t(
          "trakt_status_rate_limited_slowing_polling",
          {},
          "Rate limited, slowing down polling..."
        );
        this.traktErrorMessage = null;
      } else if (result.type === "expired") {
        this.stopTraktPolling();
        this.traktStatusMessage = null;
        this.traktErrorMessage = t(
          "trakt_error_code_expired",
          {},
          "Device code expired. Start again."
        );
      } else if (result.type === "denied") {
        this.stopTraktPolling();
        this.traktStatusMessage = null;
        this.traktErrorMessage = t(
          "trakt_error_denied",
          {},
          "Authorization denied on Trakt."
        );
      } else if (result.type === "already_used") {
        this.stopTraktPolling();
        this.traktStatusMessage = null;
        this.traktErrorMessage = t(
          "trakt_error_code_used",
          {},
          "Device code already used. Start again."
        );
      } else if (result.type === "failed") {
        this.traktStatusMessage = null;
        this.traktErrorMessage =
          result.message ||
          t("trakt_error_network_retry", {}, "Network error, please try again");
      }
      await this.render();
      const nextState = TraktAuthService.getCurrentAuthState();
      if (nextState.deviceCode && !this.traktPollTimer) {
        this.traktPollTimer = setTimeout(
          () => {
            this.traktPollTimer = null;
            void poll();
          },
          Math.max(1, Number(nextState.pollInterval || 5)) * 1000
        );
      }
    };
    void poll();
  },

  consumeBackRequest() {
    if (!this.optionDialog) {
      return false;
    }
    this.closeOptionDialog();
    void this.render({ refreshModel: false });
    return true;
  },

  cleanup() {
    if (this.traktRouteAutoWorkTimer) {
      clearTimeout(this.traktRouteAutoWorkTimer);
      this.traktRouteAutoWorkTimer = null;
    }
    this.pendingTraktAutoWork = null;
    this.traktRouteAutoWorkDeferred = false;
    if (this.simklPollTimer) {
      clearTimeout(this.simklPollTimer);
      this.simklPollTimer = null;
    }
    this.stopTraktPolling?.();
    this.stopTraktClock();
    if (this.container && this.handleClickBound) {
      this.container.removeEventListener("click", this.handleClickBound);
    }
    this.handleClickBound = null;
    this.activeSection = "trakt";
    this.focusZone = "content";
    this.contentFocusKey = null;
    this.optionDialog = null;
    this.dialogFocusIndex = 0;
    this.model = null;
    ScreenUtils.hide(this.container);
  }
});
