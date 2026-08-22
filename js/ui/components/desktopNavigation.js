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
    icon: '<path fill-rule="evenodd" d="M10.8 2.27a1.25 1.25 0 0 1 2.4 0l.3 1.2c.18.08.36.18.53.3l1.17-.35a1.25 1.25 0 0 1 1.7.98l.18 1.2c.14.16.27.34.38.53l1.2.3a1.25 1.25 0 0 1 .98 1.7l-.35 1.17c.12.17.22.35.3.53l1.2.3a1.25 1.25 0 0 1 0 2.4l-1.2.3c-.08.18-.18.36-.3.53l.35 1.17a1.25 1.25 0 0 1-.98 1.7l-1.2.18c-.16.14-.34.27-.53.38l-.3 1.2a1.25 1.25 0 0 1-1.7.98l-1.17-.35c-.17.12-.35.22-.53.3l-.3 1.2a1.25 1.25 0 0 1-2.4 0l-.3-1.2a5.1 5.1 0 0 1-.53-.3l-1.17.35a1.25 1.25 0 0 1-1.7-.98l-.18-1.2a5.1 5.1 0 0 1-.38-.53l-1.2-.3a1.25 1.25 0 0 1-.98-1.7l.35-1.17a5.1 5.1 0 0 1-.3-.53l-1.2-.3a1.25 1.25 0 0 1 0-2.4l1.2-.3c.08-.18.18-.36.3-.53l-.35-1.17a1.25 1.25 0 0 1 .98-1.7l1.2-.18c.16-.14.34-.27.53-.38l.3-1.2a1.25 1.25 0 0 1 1.7-.98l1.17.35c.17-.12.35-.22.53-.3l.3-1.2ZM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"/>'
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
  `;
}

function navigateTo(route) {
  if (route === "home" && Router.getCurrent() === "home") {
    Router.getCurrentScreen()?.onSidebarReselect?.();
    return;
  }
  void Router.navigate(route);
}

export function bindDesktopNavigationEvents(container) {
  container?.querySelectorAll(".desktop-navigation [data-desktop-route]").forEach((button) => {
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      navigateTo(String(button.dataset.desktopRoute || ""));
    };
  });
}
