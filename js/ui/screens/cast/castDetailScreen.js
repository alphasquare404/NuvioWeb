import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { setBrowserDocumentTitle } from "../../navigation/browserDocumentTitle.js";
import { getEffectiveTmdbApiKey, TmdbSettingsStore } from "../../../data/local/tmdbSettingsStore.js";
import { Environment } from "../../../platform/environment.js";
import { Platform } from "../../../platform/index.js";
import { I18n } from "../../../i18n/index.js";
import { TmdbPersonService, calculatePersonAge, sortPersonCreditsByLatest, sortPersonCreditsByPopularity } from "../../../core/tmdb/tmdbPersonService.js";
import { bindDesktopNavigationEvents, renderDesktopNavigation } from "../../components/desktopNavigation.js";
import {
  posterItemFromNode,
  PosterOptionsDialogController
} from "../../components/posterOptionsMenu.js";
import { renderLoadingIndicator } from "../../components/loadingIndicator.js";
import { bindBrowserCardTouchIntent } from "../../components/browserCardTouchIntent.js";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w780";
const POSTER_HOLD_DELAY_MS = 650;

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function escapeHtml(value = "") {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value = "") {
  return escapeHtml(value);
}

function toImage(path) {
  const value = String(path || "").trim();
  if (!value) {
    return "";
  }
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }
  if (value.startsWith("/")) {
    return `${IMAGE_BASE_URL}${value}`;
  }
  return value;
}

function isBackEvent(event) {
  return Environment.isBackEvent(event);
}

function toType(mediaType) {
  const value = String(mediaType || "").toLowerCase();
  if (value === "tv" || value === "series" || value === "show") {
    return "series";
  }
  return "movie";
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function uniqueCredits(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const key = String(item?.itemId || item?.id || "").trim();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export const CastDetailScreen = {
  async mount(params = {}) {
    this.container = document.getElementById("castDetail");
    ScreenUtils.show(this.container);
    this.params = params || {};
    this.loadToken = (this.loadToken || 0) + 1;
    this.person = null;
    this.credits = [];
    this.posterOptionsController = null;
    this.posterOptionsFocusRestore = null;
    this.pendingPosterHoldTarget = null;
    this.pendingPosterHoldTimer = null;

    this.renderLoading();
    await this.loadCastDetails();
  },

  async getPersonIdFromName(name) {
    const settings = TmdbSettingsStore.get();
    const apiKey = getEffectiveTmdbApiKey();
    if (!apiKey || !name) {
      return null;
    }
    const language = settings.language || "en-US";
    const url = `${TMDB_BASE_URL}/search/person?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(language)}&query=${encodeURIComponent(name)}`;
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    const first = Array.isArray(data?.results) ? data.results[0] : null;
    return first?.id ? String(first.id) : null;
  },

  async loadCastDetails() {
    const token = this.loadToken;
    try {
      if (Platform.isBrowser()) {
        const personId = String(this.params?.castId || this.params?.personId || "").trim();
        if (!TmdbPersonService.isAvailable() || !/^\d+$/.test(personId)) {
          this.renderError("Person details are unavailable.");
          return;
        }
        const person = await TmdbPersonService.fetchPerson({ personId });
        if (token !== this.loadToken) return;
        if (!person?.id) {
          this.renderError("Person profile not found.");
          return;
        }
        this.person = person;
        this.credits = person.credits || [];
        setBrowserDocumentTitle(person.name || "Person");
        this.render();
        return;
      }
      const settings = TmdbSettingsStore.get();
      const apiKey = getEffectiveTmdbApiKey();
      if (!apiKey) {
        this.renderError("TMDB API key not configured.");
        return;
      }
      let personId = String(this.params?.castId || "").trim();
      if (!personId || !/^\d+$/.test(personId)) {
        personId = await this.getPersonIdFromName(this.params?.castName || "");
      }
      if (!personId) {
        this.renderError("Cast profile not found.");
        return;
      }

      const language = settings.language || "en-US";
      const url = `${TMDB_BASE_URL}/person/${encodeURIComponent(personId)}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(language)}&append_to_response=combined_credits,images`;
      const response = await fetch(url);
      if (!response.ok) {
        this.renderError("Failed to load cast details.");
        return;
      }
      const person = await response.json();
      if (token !== this.loadToken) {
        return;
      }
      this.person = {
        id: String(person?.id || personId),
        name: person?.name || this.params?.castName || "Unknown",
        biography: person?.biography || "",
        birthday: person?.birthday || "",
        placeOfBirth: person?.place_of_birth || "",
        knownForDepartment: person?.known_for_department || "",
        profile: toImage(person?.profile_path || this.params?.castPhoto || "")
      };
      const credits = Array.isArray(person?.combined_credits?.cast)
        ? person.combined_credits.cast
        : [];
      this.credits = credits
        .map((item) => ({
          id: item?.id ? String(item.id) : "",
          itemId: item?.imdb_id || item?.id ? String(item.imdb_id || item.id) : "",
          type: toType(item?.media_type),
          name: item?.title || item?.name || "Untitled",
          subtitle: item?.character || "",
          poster: toImage(item?.poster_path || item?.backdrop_path || ""),
          popularity: Number(item?.popularity || 0),
          releaseDate: String(item?.release_date || item?.first_air_date || "")
        }))
        .filter((item) => Boolean(item.itemId))
        .sort((left, right) => right.popularity - left.popularity);

      this.render();
    } catch (error) {
      console.warn("Cast detail load failed", error);
      this.renderError("Failed to load cast details.");
    }
  },

  renderLoading() {
    if (Platform.isBrowser()) {
      this.container.innerHTML = `
        <div class="browser-person-detail-shell">
          ${renderDesktopNavigation({ selectedRoute: "" })}
          <div class="browser-person-detail-status">${renderLoadingIndicator()}<span>Loading person details…</span></div>
        </div>
      `;
      bindDesktopNavigationEvents(this.container);
      return;
    }
    this.container.innerHTML = `
      <div class="cast-detail-shell">
        <div class="cast-detail-loading">
          ${renderLoadingIndicator()}
          <span>Loading cast profile...</span>
        </div>
      </div>
    `;
  },

  renderError(message) {
    if (Platform.isBrowser()) {
      this.container.innerHTML = `
        <div class="browser-person-detail-shell">
          ${renderDesktopNavigation({ selectedRoute: "" })}
          <div class="browser-person-detail-status is-error"><p>${escapeHtml(message)}</p><button class="detail-desktop-back-button focusable" type="button" data-action="back" aria-label="${escapeAttribute(t("common.back", {}, "Back"))}"><span class="material-icons" aria-hidden="true">chevron_left</span></button></div>
        </div>
      `;
      ScreenUtils.indexFocusables(this.container);
      this.bindBrowserPersonActions();
      bindDesktopNavigationEvents(this.container);
      return;
    }
    this.container.innerHTML = `
      <div class="cast-detail-shell">
        <div class="cast-detail-error">${message}</div>
        <button class="cast-detail-back focusable" data-action="back">Back</button>
      </div>
    `;
    ScreenUtils.indexFocusables(this.container);
    ScreenUtils.setInitialFocus(this.container);
  },

  getCreditSections() {
    const allCredits = uniqueCredits(this.credits);
    if (Platform.isBrowser()) {
      return [
        { key: "popular", title: t("person_popular", {}, "Popular"), items: sortPersonCreditsByPopularity(allCredits) },
        { key: "latest", title: t("person_latest", {}, "Latest"), items: sortPersonCreditsByLatest(allCredits) }
      ].filter((section) => section.items.length);
    }
    const today = todayIsoDate();
    const popular = [...allCredits].sort((left, right) => right.popularity - left.popularity);
    const latest = allCredits
      .filter((item) => item.releaseDate && item.releaseDate <= today)
      .sort((left, right) =>
        String(right.releaseDate || "").localeCompare(String(left.releaseDate || ""))
      );
    const upcoming = allCredits
      .filter((item) => item.releaseDate && item.releaseDate > today)
      .sort((left, right) =>
        String(left.releaseDate || "").localeCompare(String(right.releaseDate || ""))
      );

    return [
      { key: "popular", title: t("person_popular", {}, "Popular"), items: popular },
      { key: "latest", title: t("person_latest", {}, "Latest"), items: latest },
      { key: "upcoming", title: t("person_upcoming", {}, "Upcoming"), items: upcoming }
    ].filter((section) => section.items.length);
  },

  renderCreditCard(item) {
    const title = item.title || item.name || "Untitled";
    return `
      <article class="cast-credit-card focusable"
               data-action="openDetail"
               data-item-id="${escapeAttribute(item.itemId)}"
               data-item-type="${escapeAttribute(item.type)}"
               data-item-title="${escapeAttribute(title)}"
               data-poster-src="${escapeAttribute(item.poster || "")}"
               data-backdrop-src="${escapeAttribute(item.poster || "")}">
        <div class="cast-credit-poster"${item.poster ? ` style="background-image:url('${escapeAttribute(item.poster)}')"` : ""}></div>
        <div class="cast-credit-title">${escapeHtml(title)}</div>
        <div class="cast-credit-subtitle">${escapeHtml(item.role || item.subtitle || item.type)}</div>
      </article>
    `;
  },

  renderCreditSections() {
    const sections = this.getCreditSections();
    if (!sections.length) {
      return `<div class="cast-credit-empty">${escapeHtml(t("cast_detail_empty", {}, "No titles found for this cast member."))}</div>`;
    }
    return sections
      .map(
        (section) => `
          <section class="cast-credit-section" data-credit-section="${escapeAttribute(section.key)}">
            <h3 class="cast-detail-section-title">${escapeHtml(section.title)}</h3>
            <div class="cast-credit-track">${section.items.map((item) => this.renderCreditCard(item)).join("")}</div>
          </section>
        `
      )
      .join("");
  },

  render() {
    if (Platform.isBrowser()) {
      this.renderBrowserPersonDetail();
      return;
    }
    const person = this.person || {};
    const creditsHtml = this.renderCreditSections();

    this.container.innerHTML = `
      <div class="cast-detail-shell">
        <button class="cast-detail-back focusable" data-action="back" aria-label="${escapeAttribute(t("common.back", {}, "Back"))}">
          <span class="material-icons" aria-hidden="true">arrow_back</span>
        </button>
        <section class="cast-detail-hero">
          <div class="cast-detail-hero-content">
            <div class="cast-detail-avatar"${person.profile ? ` style="background-image:url('${escapeAttribute(person.profile)}')"` : ""}></div>
            <div class="cast-detail-meta">
              <h2 class="cast-detail-name">${escapeHtml(person.name || "Unknown")}</h2>
              <div class="cast-detail-facts">
                ${person.knownForDepartment ? `<span>${escapeHtml(person.knownForDepartment)}</span>` : ""}
                ${person.birthday ? `<span>${escapeHtml(person.birthday)}</span>` : ""}
                ${person.placeOfBirth ? `<span>${escapeHtml(person.placeOfBirth)}</span>` : ""}
              </div>
              <p class="cast-detail-bio">${escapeHtml(person.biography || "No biography available.")}</p>
            </div>
          </div>
        </section>
        <section class="cast-detail-credits">
          ${creditsHtml}
        </section>
      </div>
    `;

    ScreenUtils.indexFocusables(this.container);
    ScreenUtils.setInitialFocus(this.container, ".cast-credit-card.focusable");
    this.syncFocusedCardScroll({ instant: true });
  },

  renderBrowserPersonDetail() {
    const person = this.person || {};
    const age = calculatePersonAge(person.birthday, person.deathday);
    const birth = person.birthday
      ? `Born ${escapeHtml(person.birthday)}${age != null ? ` (${age})` : ""}`
      : "";
    const avatar = person.profile
      ? `<img src="${escapeAttribute(person.profile)}" alt="" loading="eager" decoding="async" onerror="this.hidden=true" />`
      : `<span aria-hidden="true">${escapeHtml(String(person.name || "?").slice(0, 1).toUpperCase())}</span>`;
    this.container.innerHTML = `
      <div class="browser-person-detail-shell">
        ${renderDesktopNavigation({ selectedRoute: "" })}
        <button class="detail-desktop-back-button focusable" type="button" data-action="back" aria-label="${escapeAttribute(t("common.back", {}, "Back"))}">
          <span class="material-icons" aria-hidden="true">chevron_left</span>
        </button>
        <div class="browser-person-detail-layout">
          <aside class="browser-person-detail-profile">
            <div class="browser-person-detail-avatar">${avatar}</div>
            <h1>${escapeHtml(person.name || "Unknown")}</h1>
            <dl class="browser-person-detail-facts">
              ${birth ? `<div><dt>Born</dt><dd>${birth}</dd></div>` : ""}
              ${person.placeOfBirth ? `<div><dt>Place of birth</dt><dd>${escapeHtml(person.placeOfBirth)}</dd></div>` : ""}
              <div><dt>Credits</dt><dd>${Number(this.credits?.length || 0)}</dd></div>
            </dl>
            <section class="browser-person-detail-biography"><h2>Biography</h2><p>${escapeHtml(person.biography || "No biography available.")}</p></section>
          </aside>
          <main class="browser-person-detail-credits">${this.renderCreditSections()}</main>
        </div>
      </div>
    `;
    ScreenUtils.indexFocusables(this.container);
    this.bindBrowserPersonActions();
    if (Platform.isBrowser()) {
      this.browserCardTouchIntentCleanup?.();
      this.browserCardTouchIntentCleanup = bindBrowserCardTouchIntent(this.container, {
        cardSelector: ".cast-credit-card[data-action='openDetail']"
      });
    }
    bindDesktopNavigationEvents(this.container);
  },

  bindBrowserPersonActions() {
    if (this.boundBrowserPersonActionHandler || !this.container) return;
    this.boundBrowserPersonActionHandler = (event) => {
      const target = event.target instanceof Element ? event.target.closest("[data-action]") : null;
      if (!(target instanceof HTMLElement) || !this.container.contains(target)) return;
      if (target.dataset.action === "back") {
        Router.back();
      } else if (target.dataset.action === "openDetail") {
        this.openDetailFromNode(target);
      } else {
        return;
      }
      event.preventDefault();
    };
    this.container.addEventListener("click", this.boundBrowserPersonActionHandler);
  },

  syncFocusedCardScroll({ instant = false } = {}) {
    const shell = this.container?.querySelector(".cast-detail-shell");
    const focused = this.container?.querySelector(".cast-credit-card.focusable.focused");
    if (!(shell instanceof HTMLElement) || !(focused instanceof HTMLElement)) {
      return;
    }
    const track = focused.closest(".cast-credit-track");
    if (track instanceof HTMLElement) {
      const trackRect = track.getBoundingClientRect();
      const focusRect = focused.getBoundingClientRect();
      const padSide = 28;
      let nextScrollLeft = track.scrollLeft;
      if (focusRect.left < trackRect.left + padSide) {
        nextScrollLeft -= trackRect.left + padSide - focusRect.left;
      } else if (focusRect.right > trackRect.right - padSide) {
        nextScrollLeft += focusRect.right - (trackRect.right - padSide);
      }
      nextScrollLeft = Math.max(0, Math.min(track.scrollWidth - track.clientWidth, nextScrollLeft));
      if (Math.abs(nextScrollLeft - track.scrollLeft) >= 1) {
        if (!instant && typeof track.scrollTo === "function") {
          track.scrollTo({ left: nextScrollLeft, behavior: "smooth" });
        } else {
          track.scrollLeft = nextScrollLeft;
        }
      }
    }

    const shellRect = shell.getBoundingClientRect();
    const focusRect = focused.getBoundingClientRect();
    const padTop = 40;
    const padBottom = 58;
    let nextScrollTop = shell.scrollTop;
    if (focusRect.top < shellRect.top + padTop) {
      nextScrollTop -= shellRect.top + padTop - focusRect.top;
    } else if (focusRect.bottom > shellRect.bottom - padBottom) {
      nextScrollTop += focusRect.bottom - (shellRect.bottom - padBottom);
    }
    nextScrollTop = Math.max(0, Math.min(shell.scrollHeight - shell.clientHeight, nextScrollTop));
    if (Math.abs(nextScrollTop - shell.scrollTop) < 1) {
      return;
    }
    if (!instant && typeof shell.scrollTo === "function") {
      shell.scrollTo({ top: nextScrollTop, behavior: "smooth" });
    } else {
      shell.scrollTop = nextScrollTop;
    }
  },

  isPosterHoldTarget(node) {
    return (
      node instanceof HTMLElement &&
      node.classList.contains("cast-credit-card") &&
      String(node.dataset.action || "") === "openDetail"
    );
  },

  cancelPendingPosterHold() {
    if (this.pendingPosterHoldTimer) {
      clearTimeout(this.pendingPosterHoldTimer);
      this.pendingPosterHoldTimer = null;
    }
    this.pendingPosterHoldTarget = null;
  },

  hasPendingPosterHold(node) {
    return this.pendingPosterHoldTarget === node && Boolean(this.pendingPosterHoldTimer);
  },

  startPendingPosterHold(node) {
    this.cancelPendingPosterHold();
    if (!this.isPosterHoldTarget(node)) {
      return;
    }
    this.pendingPosterHoldTarget = node;
    this.pendingPosterHoldTimer = setTimeout(() => {
      this.pendingPosterHoldTimer = null;
      const target = this.pendingPosterHoldTarget;
      this.pendingPosterHoldTarget = null;
      if (target?.isConnected && target.classList.contains("focused")) {
        void this.openPosterOptionsMenu(target);
      }
    }, POSTER_HOLD_DELAY_MS);
  },

  completePendingPosterHold(node, event = null) {
    if (!this.pendingPosterHoldTarget) {
      return false;
    }
    const target = this.pendingPosterHoldTarget;
    const hadTimer = Boolean(this.pendingPosterHoldTimer);
    const heldLongEnough = Number(event?.keyDownDurationMs || 0) >= POSTER_HOLD_DELAY_MS;
    this.cancelPendingPosterHold();
    if (hadTimer && target === node) {
      if (heldLongEnough) {
        void this.openPosterOptionsMenu(target);
      } else {
        this.openDetailFromNode(target);
      }
    }
    return true;
  },

  async openPosterOptionsMenu(node) {
    const item = posterItemFromNode(node);
    if (!item?.id) {
      return false;
    }
    this.posterOptionsFocusRestore = String(item.id || "").trim();
    if (!this.posterOptionsController) {
      this.posterOptionsController = new PosterOptionsDialogController({
        onDetails: (target) => {
          Router.navigate("detail", {
            itemId: target.id,
            itemType: target.type || "movie",
            fallbackTitle: target.title || "Untitled",
            fallbackPoster: target.poster || "",
            fallbackBackground: target.background || "",
            addonBaseUrl: target.addonBaseUrl || "",
            addonId: target.addonId || "",
            addonName: target.addonName || "",
            catalogType: target.catalogType || target.type || "movie"
          });
        },
        onDismiss: () => {
          const itemId = this.posterOptionsFocusRestore;
          this.posterOptionsFocusRestore = null;
          const target = itemId
            ? this.container?.querySelector(
                `.cast-credit-card.focusable[data-item-id="${String(itemId).replace(/["\\]/g, "\\$&")}"]`
              )
            : null;
          if (!target) {
            return;
          }
          this.container.querySelectorAll(".focusable.focused").forEach((current) => {
            if (current !== target) current.classList.remove("focused");
          });
          target.classList.add("focused");
          target.focus?.({ preventScroll: true });
          this.syncFocusedCardScroll({ instant: true });
        }
      });
    }
    return this.posterOptionsController.open(item);
  },

  closePosterOptionsMenu() {
    if (!this.posterOptionsController?.dialog) {
      return false;
    }
    this.posterOptionsController.destroy();
    this.posterOptionsFocusRestore = null;
    return true;
  },

  openDetailFromNode(node) {
    Router.navigate("detail", {
      itemId: node.dataset.itemId,
      itemType: node.dataset.itemType || "movie",
      fallbackTitle: node.dataset.itemTitle || "Untitled"
    });
  },

  async onKeyDown(event) {
    const code = Number(event?.keyCode || 0);
    const current = this.container?.querySelector(".focusable.focused") || null;
    const isPosterHoldTarget = this.isPosterHoldTarget(current);
    if (!isPosterHoldTarget || code !== 13) {
      this.cancelPendingPosterHold();
    }

    if (isBackEvent(event)) {
      event?.preventDefault?.();
      Router.back();
      return;
    }
    if (ScreenUtils.handleDpadNavigation(event, this.container)) {
      this.syncFocusedCardScroll();
      return;
    }
    if (code !== 13) {
      return;
    }
    if (!current) {
      return;
    }
    if (code === 13 && isPosterHoldTarget) {
      event?.preventDefault?.();
      if (!event?.repeat && !this.hasPendingPosterHold(current)) {
        this.startPendingPosterHold(current);
      }
      return;
    }
    const action = String(current.dataset.action || "");
    if (action === "back") {
      Router.back();
      return;
    }
    if (action === "openDetail") {
      this.openDetailFromNode(current);
    }
  },

  onKeyUp(event) {
    if (Number(event?.keyCode || 0) !== 13) {
      return;
    }
    const current = this.container?.querySelector(".cast-credit-card.focusable.focused") || null;
    if (this.completePendingPosterHold(current, event)) {
      event?.preventDefault?.();
    }
  },

  consumeBackRequest() {
    return this.closePosterOptionsMenu();
  },

  cleanup() {
    this.browserCardTouchIntentCleanup?.();
    this.browserCardTouchIntentCleanup = null;
    this.loadToken = (this.loadToken || 0) + 1;
    this.cancelPendingPosterHold();
    this.posterOptionsController?.destroy?.({ restoreFocus: false });
    this.posterOptionsController = null;
    this.posterOptionsFocusRestore = null;
    if (this.boundBrowserPersonActionHandler && this.container) {
      this.container.removeEventListener("click", this.boundBrowserPersonActionHandler);
      this.boundBrowserPersonActionHandler = null;
    }
    ScreenUtils.hide(this.container);
  }
};
