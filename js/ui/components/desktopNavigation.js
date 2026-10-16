import { Router } from "../navigation/router.js";
import { I18n } from "../../i18n/index.js";

const NAVIGATION_ITEMS = [
  {
    route: "home",
    labelKey: "sidebar.home",
    fallback: "Home",
    icon: '<path d="M12 3.2 3.5 10v10.25c0 .69.56 1.25 1.25 1.25h5.5v-6.5h3.5v6.5h5.5c.69 0 1.25-.56 1.25-1.25V10L12 3.2Zm0 1.92 7 5.6v9.53h-4v-6.5H9v6.5H5v-9.53l7-5.6Z"/>'
  },
  {
    route: "search",
    labelKey: "sidebar.search",
    fallback: "Search",
    viewBox: "0 0 20 20",
    icon: '<path fill-rule="evenodd" d="M4 9a5 5 0 1110 0A5 5 0 014 9zm5-7a7 7 0 104.2 12.6.999.999 0 00.093.107l3 3a1 1 0 001.414-1.414l-3-3a.999.999 0 00-.107-.093A7 7 0 004 9z"/>'
  },
  {
    route: "library",
    labelKey: "sidebar.library",
    fallback: "Library",
    icon: '<path d="M8.5 2h7c.23 0 .41 0 .56.02 1.11.11 2.02.77 2.4 1.67H5.54c.38-.9 1.29-1.56 2.4-1.67C8.1 2 8.28 2 8.5 2Z"/><path d="M6.31 4.72A3.12 3.12 0 0 0 3.4 6.68c-.01.02-.02.05-.02.07.4-.12.81-.2 1.23-.25 1.08-.14 2.44-.14 4.03-.14h6.89c1.59 0 2.95 0 4.03.14.42.05.83.13 1.23.25 0-.02-.01-.05-.02-.07a3.12 3.12 0 0 0-2.91-1.96H6.31Z"/><path fill-rule="evenodd" d="M8.67 7.54h6.66c3.37 0 5.06 0 6.01.99.95.99.72 2.51.28 5.56l-.43 2.89c-.35 2.39-.52 3.59-1.42 4.3-.9.72-2.22.72-4.87.72H9.1c-2.65 0-3.97 0-4.87-.72-.9-.71-1.07-1.91-1.42-4.3l-.43-2.89c-.44-3.05-.67-4.57.28-5.56.95-.99 2.64-.99 6.01-.99ZM8 18c0-.41.37-.75.83-.75h6.34c.46 0 .83.34.83.75s-.37.75-.83.75H8.83c-.46 0-.83-.34-.83-.75Z"/>'
  },
  {
    route: "settings",
    labelKey: "sidebar.settings",
    fallback: "Settings",
    icon: '<path d="M19.43 12.98c.04-.32.07-.65.07-.98s-.03-.66-.08-.98l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.2 7.2 0 0 0-1.69-.98L14.5 2.42A.5.5 0 0 0 14 2h-4a.5.5 0 0 0-.49.42l-.37 2.65c-.6.25-1.17.57-1.69.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65c-.05.32-.08.65-.08.98s.03.66.08.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46a.5.5 0 0 0 .61.22l2.49-1c.52.41 1.09.73 1.69.98l.37 2.65A.5.5 0 0 0 10 22h4a.5.5 0 0 0 .49-.42l.37-2.65c.6-.25 1.17-.57 1.69-.98l2.49 1a.5.5 0 0 0 .61-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.1-1.65ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z"/>'
  }
];

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function t(key, fallback) {
  return I18n.t(key, {}, { fallback });
}

function renderIcon(item) {
  return `
    <svg class="desktop-navigation-icon" viewBox="${item.viewBox || "0 0 24 24"}" aria-hidden="true" focusable="false">
      ${item.icon}
    </svg>
  `;
}

function renderProfile(profile, selectedRoute) {
  const profileState = profile || {};
  const label = t("sidebar.profileFallback", "Profile");
  const name = String(profileState.activeProfileName || label).trim() || label;
  const initial = String(profileState.activeProfileInitial || name.charAt(0) || "P").charAt(0).toUpperCase();
  const color = String(profileState.activeProfileColorHex || "#1E88E5");
  const avatarUrl = String(profileState.activeProfileAvatarUrl || "").trim();
  const isActive = selectedRoute === "profileSelection";

  return `
    <button class="desktop-navigation-item desktop-navigation-profile${isActive ? " is-active" : ""}"
            type="button"
            data-desktop-route="profileSelection"
            aria-label="${escapeHtml(label)}"${isActive ? ' aria-current="page"' : ""}>
      <span class="desktop-navigation-avatar" style="background:${escapeHtml(color)}">
        ${avatarUrl ? `<img src="${escapeHtml(avatarUrl)}" alt="" />` : escapeHtml(initial)}
      </span>
      <span class="desktop-navigation-label">${escapeHtml(label)}</span>
    </button>
  `;
}

// The rail placement keeps the navigation off screen until it is asked for,
// which needs something to ask with. It is rendered beside the bar rather than
// by each screen because the bar is already rendered by all of them, and a
// screen that forgot the button would have no way back to anywhere.
// The other two placements keep the bar on screen, so CSS hides this.
// Both marks are drawn and CSS shows whichever one is true, so the button
// never has to be rebuilt to change what it says.
function renderNavigationRevealButton() {
  const label = t("nav_open_menu", "Open menu");
  return `
    <button class="desktop-navigation-reveal"
            type="button"
            data-desktop-navigation-reveal
            aria-label="${escapeHtml(label)}"
            aria-expanded="false">
      <svg class="desktop-navigation-reveal-open" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"></path>
      </svg>
      <svg class="desktop-navigation-reveal-close" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6z"></path>
      </svg>
    </button>
  `;
}

export function renderDesktopNavigation({ selectedRoute = "", profile = null } = {}) {
  const currentRoute = String(selectedRoute || "");
  return `
    <nav class="desktop-navigation" aria-label="Primary navigation">
      <div class="desktop-navigation-scroll">
        ${NAVIGATION_ITEMS.map((item) => {
          const label = t(item.labelKey, item.fallback);
          const isActive = item.route === currentRoute;
          return `
            <button class="desktop-navigation-item${isActive ? " is-active" : ""}"
                    type="button"
                    data-desktop-route="${item.route}"${isActive ? ' aria-current="page"' : ""}>
              ${renderIcon(item)}
              <span class="desktop-navigation-label">${escapeHtml(label)}</span>
            </button>
          `;
        }).join("")}
        ${renderProfile(profile, currentRoute)}
      </div>
    </nav>
    ${renderNavigationRevealButton()}
  `;
}

const NAVIGATION_OPEN_CLASS = "nav-rail-open";

function setNavigationRailOpen(open) {
  const root = globalThis?.document?.documentElement;
  if (!root) return;
  root.classList.toggle(NAVIGATION_OPEN_CLASS, Boolean(open));
  const label = open ? t("nav_close_menu", "Close menu") : t("nav_open_menu", "Open menu");
  document.querySelectorAll("[data-desktop-navigation-reveal]").forEach((button) => {
    button.setAttribute("aria-expanded", open ? "true" : "false");
    button.setAttribute("aria-label", label);
  });
}

export function closeNavigationRail() {
  setNavigationRailOpen(false);
}

// Bound once for the page rather than per render: these screens rebuild their
// markup often, and a listener added on each of those would stack up.
let dismissBound = false;

function bindNavigationRailDismiss() {
  if (dismissBound || typeof document === "undefined") return;
  dismissBound = true;
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!document.documentElement.classList.contains(NAVIGATION_OPEN_CLASS)) return;
      const target = event.target;
      if (typeof target?.closest !== "function") return;
      if (
        target.closest(".desktop-navigation") ||
        target.closest("[data-desktop-navigation-reveal]")
      ) {
        return;
      }
      setNavigationRailOpen(false);
    },
    true
  );
  // No Escape handler here on purpose. Escape is Back in this app: the key
  // is taken on window in the capture phase and ended with
  // stopImmediatePropagation, so nothing bound later can see it, and nothing
  // bound here ever would be. Closing the rail from Back would mean changing
  // what Back does, which is a bigger decision than this component.
  // Pressing elsewhere closes it, and so does going anywhere.
}

// --- The bottom bar, which gets out of the way while you read ---------------
//
// Labels while you arrive, icons once you are reading: scrolling down is the
// one moment the bar is certainly not what you are looking at, and scrolling
// back up is the usual way of reaching for it.
const BOTTOM_COLLAPSED_CLASS = "nav-bottom-collapsed";
const SCROLL_NOISE_PX = 6;
const NEAR_TOP_PX = 24;

// Per scroller, because a page has several: the row rails scroll sideways and
// the page scrolls down, and one shared number would read every switch
// between them as a jump.
const lastScrollTops = new WeakMap();
let bottomScrollBound = false;

function setBottomNavigationCollapsed(collapsed) {
  const root = globalThis?.document?.documentElement;
  if (!root) return;
  root.classList.toggle(BOTTOM_COLLAPSED_CLASS, Boolean(collapsed));
}

function resolveScrollTarget(eventTarget) {
  if (!eventTarget || eventTarget === globalThis || eventTarget === globalThis.document) {
    return globalThis?.document?.scrollingElement || globalThis?.document?.documentElement || null;
  }
  return eventTarget;
}

function handleBottomNavigationScroll(event) {
  const root = globalThis?.document?.documentElement;
  // Only the bottom bar hides; the other two placements are not in the way.
  if (!root || root.dataset.navPlacement !== "bottom") return;
  const target = resolveScrollTarget(event?.target);
  if (!target) return;
  const top = Math.max(0, Number(target.scrollTop || 0) || 0);
  const previous = lastScrollTops.get(target);
  lastScrollTops.set(target, top);
  // A sideways rail never changes scrollTop, so it never reaches further
  // than this.
  if (previous === undefined || top === previous) return;
  if (top <= NEAR_TOP_PX) {
    setBottomNavigationCollapsed(false);
    return;
  }
  const delta = top - previous;
  if (Math.abs(delta) < SCROLL_NOISE_PX) return;
  setBottomNavigationCollapsed(delta > 0);
}

// Capture, because scroll does not bubble: this is the only way to hear every
// scroller on the page from one listener, whichever screen built it.
function bindBottomNavigationScroll() {
  if (bottomScrollBound || typeof globalThis.addEventListener !== "function") return;
  bottomScrollBound = true;
  globalThis.addEventListener("scroll", handleBottomNavigationScroll, {
    capture: true,
    passive: true
  });
}

function navigateTo(route) {
  // Going somewhere is the end of asking where to go.
  setNavigationRailOpen(false);
  if (route === "home" && Router.getCurrent() === "home") {
    Router.getCurrentScreen()?.onSidebarReselect?.();
    return;
  }
  void Router.navigate(route);
}

export function bindDesktopNavigationEvents(container) {
  bindNavigationRailDismiss();
  bindBottomNavigationScroll();
  // Every screen opens with the bar at its full size, whatever the last one
  // was left at.
  setBottomNavigationCollapsed(false);
  container?.querySelectorAll("[data-desktop-navigation-reveal]").forEach((button) => {
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const root = globalThis?.document?.documentElement;
      setNavigationRailOpen(!root?.classList.contains(NAVIGATION_OPEN_CLASS));
    };
  });
  container?.querySelectorAll(".desktop-navigation [data-desktop-route]").forEach((button) => {
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      navigateTo(String(button.dataset.desktopRoute || ""));
    };
  });
}
