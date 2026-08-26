import { AuthManager } from "../../core/auth/authManager.js";
import { PluginManager } from "../../core/player/pluginManager.js";
import { PluginSyncService } from "../../core/profile/pluginSyncService.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function createSourceId() {
  return `plugin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createDesktopPluginManager({ requestRender } = {}) {
  const state = {
    isLoading: false,
    pluginsEnabled: false,
    sources: [],
    sourceName: "",
    sourceUrlTemplate: "",
    addError: "",
    removeTarget: null,
    statusMessage: "",
    statusTone: "",
    syncInFlight: null,
    syncPending: false
  };

  const rerender = async () => {
    await requestRender?.();
  };

  const setStatus = (message = "", tone = "") => {
    state.statusMessage = message;
    state.statusTone = tone;
  };

  const loadSources = () => {
    state.pluginsEnabled = PluginManager.pluginsEnabled;
    state.sources = PluginManager.listPluginSources();
  };

  const syncSources = async (before = []) => {
    if (!AuthManager.isAuthenticated) {
      setStatus("Saved locally", "warning");
      await rerender();
      return false;
    }

    if (state.syncInFlight) {
      state.syncPending = true;
      return state.syncInFlight;
    }

    setStatus("Syncing…");
    await rerender();
    const run = async () => {
      let synced = true;
      do {
        state.syncPending = false;
        synced =
          (await PluginSyncService.push({ automatic: true })) && synced;
      } while (state.syncPending);
      return synced;
    };
    state.syncInFlight = run();
    try {
      const synced = await state.syncInFlight;
      setStatus(
        synced
          ? "Synced"
          : PluginSyncService.hasPendingLocalMutation()
            ? "Saved locally — sync will resume after profile hydration."
            : "Sync failed — changes are still saved locally.",
        synced ? "success" : PluginSyncService.hasPendingLocalMutation() ? "warning" : "error"
      );
      await rerender();
      return synced;
    } finally {
      state.syncInFlight = null;
    }
  };

  const addSource = async () => {
    const name = String(state.sourceName || "").trim();
    const urlTemplate = String(state.sourceUrlTemplate || "").trim();
    if (!name || !urlTemplate) {
      state.addError = !name ? "Enter a source name." : "Enter a URL template.";
      await rerender();
      return;
    }

    state.addError = "";
    try {
      const before = PluginManager.listPluginSources();
      PluginManager.addPluginSource({
        id: createSourceId(),
        name,
        urlTemplate,
        enabled: true
      });
      state.sourceName = "";
      state.sourceUrlTemplate = "";
      loadSources();
      setStatus(`${name} saved locally.`);
      await rerender();
      PluginSyncService.recordLocalMutation(null, before, PluginManager.listPluginSources());
      await syncSources(before);
    } catch (error) {
      console.warn("Desktop plugin source add failed", error);
      state.addError = String(error?.message || "Unable to add that plugin source.");
      setStatus("The plugin source was not added.", "error");
      await rerender();
    }
  };

  const setPluginsEnabled = async (enabled) => {
    PluginManager.setPluginsEnabled(enabled);
    state.pluginsEnabled = PluginManager.pluginsEnabled;
    setStatus("Saved on this device.", "warning");
    await rerender();
  };

  const setSourceEnabled = async (source) => {
    const sourceId = String(source?.id || "");
    if (!sourceId) return;
    const before = PluginManager.listPluginSources();
    PluginManager.setPluginSourceEnabled(sourceId, source.enabled === false);
    loadSources();
    setStatus(`${source.name || "Plugin source"} ${source.enabled === false ? "enabled" : "disabled"} locally.`);
    await rerender();
    PluginSyncService.recordLocalMutation(null, before, PluginManager.listPluginSources());
    await syncSources(before);
  };

  const confirmRemove = async () => {
    const source = state.removeTarget;
    const sourceId = String(source?.id || "");
    if (!sourceId) return;
    state.removeTarget = null;
    try {
      const before = PluginManager.listPluginSources();
      PluginManager.removePluginSource(sourceId);
      loadSources();
      setStatus(`${source.name || "Plugin source"} removed locally.`);
      await rerender();
      PluginSyncService.recordLocalMutation(null, before, PluginManager.listPluginSources());
      await syncSources(before);
    } catch (error) {
      console.warn("Desktop plugin source removal failed", error);
      setStatus(String(error?.message || "Unable to remove that plugin source."), "error");
      await rerender();
    }
  };

  const renderSource = (source, index) => {
    const name = String(source?.name || "Custom Source").trim() || "Custom Source";
    const urlTemplate = String(source?.urlTemplate || "").trim();
    const enabled = source?.enabled !== false;
    return `
      <article class="desktop-plugin-source${enabled ? "" : " is-disabled"}">
        <div class="desktop-plugin-source-copy">
          <h3>${escapeHtml(name)}</h3>
          <p title="${escapeHtml(urlTemplate)}">${escapeHtml(urlTemplate)}</p>
        </div>
        <div class="desktop-plugin-source-actions" aria-label="${escapeHtml(name)} actions">
          <label class="desktop-plugin-toggle">
            <input type="checkbox" data-plugin-source-toggle="${index}" ${enabled ? "checked" : ""} />
            <span class="desktop-plugin-toggle-track" aria-hidden="true"><span></span></span>
            <span class="desktop-plugin-toggle-label">${enabled ? "Enabled" : "Disabled"}</span>
          </label>
          <button class="desktop-plugin-action desktop-plugin-action-danger" type="button" data-plugin-source-remove="${index}">Remove</button>
        </div>
      </article>
    `;
  };

  const renderConfirmation = () => {
    if (!state.removeTarget) return "";
    const name = state.removeTarget.name || "this plugin source";
    return `
      <div class="desktop-plugin-dialog-backdrop" data-plugin-dialog-backdrop>
        <section class="desktop-plugin-dialog" role="dialog" aria-modal="true" aria-labelledby="desktop-plugin-remove-title">
          <h2 id="desktop-plugin-remove-title">Remove ${escapeHtml(name)}?</h2>
          <p>This removes the custom stream source from this profile.</p>
          <div class="desktop-plugin-dialog-actions">
            <button class="desktop-plugin-action" type="button" data-plugin-remove-cancel>Cancel</button>
            <button class="desktop-plugin-action desktop-plugin-action-danger" type="button" data-plugin-remove-confirm>Remove</button>
          </div>
        </section>
      </div>
    `;
  };

  return {
    async load() {
      state.isLoading = true;
      await rerender();
      try {
        loadSources();
      } catch (error) {
        console.warn("Desktop plugin source load failed", error);
        state.sources = [];
        setStatus("Couldn’t load plugin sources.", "error");
      } finally {
        state.isLoading = false;
        await rerender();
      }
    },

    render() {
      const statusClass = state.statusTone ? ` is-${state.statusTone}` : "";
      const sources = state.isLoading
        ? '<p class="desktop-plugin-empty">Loading plugin sources…</p>'
        : state.sources.length
          ? state.sources.map(renderSource).join("")
          : '<p class="desktop-plugin-empty">No custom stream sources are configured yet.</p>';
      return `
        <div class="desktop-plugin-manager">
          <section class="desktop-plugin-master">
            <div>
              <h2>Enable Plugins</h2>
              <p>Controls custom stream sources on this device.</p>
            </div>
            <label class="desktop-plugin-toggle desktop-plugin-master-toggle">
              <input type="checkbox" data-plugins-enabled ${state.pluginsEnabled ? "checked" : ""} />
              <span class="desktop-plugin-toggle-track" aria-hidden="true"><span></span></span>
              <span class="desktop-plugin-toggle-label">${state.pluginsEnabled ? "Enabled" : "Disabled"}</span>
            </label>
          </section>
          <section class="desktop-plugin-section" aria-labelledby="desktop-plugin-sources-title">
            <div class="desktop-plugin-section-heading">
              <div>
                <h2 id="desktop-plugin-sources-title">Plugin Sources</h2>
                <p>Add custom stream source URL templates for this profile.</p>
              </div>
              <span class="desktop-plugin-count">${state.sources.length} sources</span>
            </div>
            ${state.statusMessage ? `<p class="desktop-plugin-status${statusClass}" role="status">${escapeHtml(state.statusMessage)}</p>` : ""}
            <form class="desktop-plugin-form" data-plugin-form>
              <div class="desktop-plugin-form-fields">
                <div class="desktop-plugin-field">
                  <label class="desktop-plugin-input-label" for="desktop-plugin-name">Source Name</label>
                  <input id="desktop-plugin-name" class="desktop-plugin-input" type="text" autocomplete="off" value="${escapeHtml(state.sourceName)}" data-plugin-name />
                </div>
                <div class="desktop-plugin-field">
                  <label class="desktop-plugin-input-label" for="desktop-plugin-url">URL Template</label>
                  <div class="desktop-plugin-input-row">
                    <input id="desktop-plugin-url" class="desktop-plugin-input" type="text" autocomplete="off" placeholder="https://example.com/stream/{tmdbId}" value="${escapeHtml(state.sourceUrlTemplate)}" data-plugin-url />
                    <button class="desktop-plugin-primary-action" type="submit">Add Source</button>
                  </div>
                </div>
              </div>
              <p class="desktop-plugin-template-help">Available variables: <code>{tmdbId}</code>, <code>{mediaType}</code>, <code>{season}</code>, <code>{episode}</code></p>
              ${state.addError ? `<p class="desktop-plugin-form-message is-error" role="alert">${escapeHtml(state.addError)}</p>` : ""}
            </form>
            <div class="desktop-plugin-source-list">${sources}</div>
          </section>
          ${renderConfirmation()}
        </div>
      `;
    },

    bind(container) {
      container.querySelector("[data-plugin-name]")?.addEventListener("input", (event) => {
        state.sourceName = String(event.target?.value || "");
        state.addError = "";
      });
      container.querySelector("[data-plugin-url]")?.addEventListener("input", (event) => {
        state.sourceUrlTemplate = String(event.target?.value || "");
        state.addError = "";
      });
      container.querySelector("[data-plugin-form]")?.addEventListener("submit", (event) => {
        event.preventDefault();
        void addSource();
      });
      container.querySelector("[data-plugins-enabled]")?.addEventListener("change", (event) => {
        void setPluginsEnabled(Boolean(event.target?.checked));
      });
      container.querySelectorAll("[data-plugin-source-toggle]").forEach((node) => {
        node.addEventListener("change", () => void setSourceEnabled(state.sources[Number(node.dataset.pluginSourceToggle || -1)]));
      });
      container.querySelectorAll("[data-plugin-source-remove]").forEach((node) => {
        node.addEventListener("click", () => {
          state.removeTarget = state.sources[Number(node.dataset.pluginSourceRemove || -1)] || null;
          void rerender();
        });
      });
      container.querySelector("[data-plugin-remove-cancel]")?.addEventListener("click", () => {
        state.removeTarget = null;
        void rerender();
      });
      container.querySelector("[data-plugin-remove-confirm]")?.addEventListener("click", () => void confirmRemove());
      container.querySelector("[data-plugin-dialog-backdrop]")?.addEventListener("click", (event) => {
        if (event.target === event.currentTarget) {
          state.removeTarget = null;
          void rerender();
        }
      });
    },

    async handleKeyDown(event) {
      if (event?.key === "Escape" && state.removeTarget) {
        event.preventDefault();
        state.removeTarget = null;
        await rerender();
        return true;
      }
      return false;
    }
  };
}
