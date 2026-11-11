import { ScreenUtils } from "../../navigation/screen.js";
import { Router } from "../../navigation/router.js";
import { Platform } from "../../../platform/index.js";
import { I18n } from "../../../i18n/index.js";
import { createDesktopPluginManager } from "../../components/desktopPluginManager.js";

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const PluginsScreen = {
  async mount() {
    this.container = document.getElementById("plugins");
    ScreenUtils.show(this.container);
    this.routeEnterPending = true;
    this.manager = createDesktopPluginManager({
      requestRender: () => {
        if (Router.getCurrent() === "plugins") return this.render();
      }
    });
    await this.manager.load();
  },

  async render() {
    const enterClass = this.routeEnterPending ? " nuvio-route-slide-enter" : "";
    this.container.innerHTML = `
      <div class="plugins-route-shell">
        <div class="plugins-route-content${enterClass}">
          <header class="settings-content-header">
            <h1 class="settings-title">${escapeHtml(t("plugin_title", {}, "Plugins"))}</h1>
            <p class="settings-subtitle">${escapeHtml(t("settings.sections.plugins.subtitle", {}, "Manage repositories, providers, and plugin states"))}</p>
          </header>
          ${this.manager.render()}
        </div>
      </div>
    `;
    this.routeEnterPending = false;
    this.manager.bind(this.container);
    ScreenUtils.indexFocusables(this.container);
  },

  async onKeyDown(event) {
    if (await this.manager?.handleKeyDown(event)) return;
    if (Platform.isBackEvent(event)) {
      event?.preventDefault?.();
      await Router.back();
    }
  },

  consumeBackRequest() {
    return false;
  },

  cleanup() {
    this.routeEnterPending = false;
    ScreenUtils.hide(this.container);
  }
};
