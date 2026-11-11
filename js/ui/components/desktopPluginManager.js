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
    formOpen: false,
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
    syncPending: false,
    repositoryDraft: "",
    repositoryBusy: false,
    scraperTest: null
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

  const syncSources = async (_before = []) => {
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
        synced = (await PluginSyncService.push({ automatic: true })) && synced;
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
      state.formOpen = false;
      state.sourceUrlTemplate = "";
      loadSources();
      setStatus(`${name} saved locally.`);
      PluginSyncService.recordLocalMutation(null, before, PluginManager.listPluginSources());
      await rerender();
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
    setStatus(
      `${source.name || "Plugin source"} ${source.enabled === false ? "enabled" : "disabled"} locally.`
    );
    await rerender();
    PluginSyncService.recordLocalMutation(null, before, PluginManager.listPluginSources());
    await syncSources(before);
  };

  const confirmRemove = async () => {
    const source = state.removeTarget;
    const sourceId = String(source?.id || "");
    if (!sourceId) return;
    state.removeTarget = null;
    if (source.repository) {
      await editRepository(
        async () => {
          await repositories.removeRepository(sourceId);
          return "Repository removed.";
        },
        { sync: true }
      );
      return;
    }
    try {
      const before = PluginManager.listPluginSources();
      PluginManager.removePluginSource(sourceId);
      loadSources();
      setStatus(`${source.name || "Plugin source"} removed locally.`);
      PluginSyncService.recordLocalMutation(null, before, PluginManager.listPluginSources());
      await rerender();
      await syncSources(before);
    } catch (error) {
      console.warn("Desktop plugin source removal failed", error);
      setStatus(String(error?.message || "Unable to remove that plugin source."), "error");
      await rerender();
    }
  };

  const repositories = PluginManager.repositories;

  const editRepository = async (action, { sync = false } = {}) => {
    if (state.repositoryBusy) return;
    const before = PluginSyncService.snapshot();
    state.repositoryBusy = true;
    setStatus("");
    await rerender();
    try {
      const message = await action();
      if (sync) {
        const after = PluginSyncService.snapshot();
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          PluginSyncService.recordLocalMutation(null, before, after);
          if (AuthManager.isAuthenticated) void PluginSyncService.push({ automatic: true });
        }
      }
      setStatus(message, "success");
    } catch (error) {
      setStatus(error?.message || "Plugin operation failed.", "error");
    } finally {
      state.repositoryBusy = false;
      await rerender();
    }
  };

  const renderRepository = (repository) => {
    const id = escapeHtml(repository.id);
    const editable = repositories.canEdit() && !state.repositoryBusy;
    const scrapers = repositories.listScrapers(repository.id);
    const external = repository.type === "EXTERNAL_DEX";
    const providers =
      external && Array.isArray(repository.metadata?.plugins) ? repository.metadata.plugins : [];
    const enableAll = !scrapers.some((scraper) => scraper.enabled);
    return `
      <article class="desktop-plugin-source">
        <div class="desktop-plugin-source-copy">
          <h3>${escapeHtml(repository.name)}</h3>
          <p>${escapeHtml(repository.description || repository.url)}</p>
          ${external ? "<p>CloudStream metadata</p>" : ""}
          ${providers.length ? `<ul>${providers.map((provider) => `<li>${escapeHtml(provider.name || provider.internalName || "Provider")}</li>`).join("")}</ul>` : ""}
          <div class="desktop-plugin-source-list">
            ${scrapers
              .map(
                (scraper) => `
              <div class="desktop-plugin-source">
                <div class="desktop-plugin-source-copy">
                  <strong>${escapeHtml(scraper.name)}</strong>
                  <p>${escapeHtml(scraper.supportedTypes.join(", "))}</p>
                  ${
                    state.scraperTest?.id === scraper.id
                      ? `
                    <p>${escapeHtml(state.scraperTest.media)} · ${state.scraperTest.count} streams found</p>
                    ${
                      state.scraperTest.failures.length
                        ? `
                      <details open>
                        <summary>Request failures</summary>
                        <ul>${state.scraperTest.failures.map((failure) => `<li>${escapeHtml(failure)}</li>`).join("")}</ul>
                      </details>
                    `
                        : ""
                    }
                    <ul>${state.scraperTest.titles.map((title) => `<li>${escapeHtml(title)}</li>`).join("")}</ul>
                  `
                      : ""
                  }
                  ${
                    scraper.settings
                      ? `
                    <details>
                      <summary>Scraper settings</summary>
                      <form data-plugin-scraper-settings="${escapeHtml(scraper.id)}">
                        <label>Settings JSON <textarea name="settings" class="desktop-plugin-input">${escapeHtml(JSON.stringify(repositories.getScraperSettings(scraper.id), null, 2))}</textarea></label>
                        <button type="submit" class="desktop-plugin-action"${editable ? "" : " disabled"}>Save</button>
                      </form>
                    </details>
                  `
                      : ""
                  }
                </div>
                <div class="desktop-plugin-source-actions">
                  <label><input type="checkbox" data-plugin-scraper-enabled="${escapeHtml(scraper.id)}"${scraper.enabled ? " checked" : ""}${editable ? "" : " disabled"}> Enabled</label>
                  <button type="button" class="desktop-plugin-action" data-plugin-scraper-test="${escapeHtml(scraper.id)}"${state.repositoryBusy || !repository.enabled || !scraper.enabled ? " disabled" : ""}>Test</button>
                </div>
              </div>
            `
              )
              .join("")}
          </div>
        </div>
        <div class="desktop-plugin-source-actions">
          <label><input type="checkbox" data-plugin-repository-enabled="${id}"${repository.enabled ? " checked" : ""}${editable ? "" : " disabled"}> Enabled</label>
          ${scrapers.length ? `<button type="button" class="desktop-plugin-action" data-plugin-scrapers-toggle-all="${id}" data-enabled="${enableAll}"${editable ? "" : " disabled"}>${enableAll ? "Enable all" : "Disable all"}</button>` : ""}
          <button type="button" class="desktop-plugin-action" data-plugin-repository-refresh="${id}"${editable ? "" : " disabled"}>Refresh</button>
          <button type="button" class="desktop-plugin-action desktop-plugin-action-danger" data-plugin-repository-remove="${id}"${editable ? "" : " disabled"}>Remove</button>
        </div>
      </article>`;
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
    get count() {
      return PluginManager.listPluginSources().length + repositories.listRepositories().length;
    },

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
              <p>Controls plugin scraper and custom stream discovery.</p>
            </div>
            <label class="desktop-plugin-toggle desktop-plugin-master-toggle">
              <input type="checkbox" data-plugins-enabled ${state.pluginsEnabled ? "checked" : ""} />
              <span class="desktop-plugin-toggle-track" aria-hidden="true"><span></span></span>
              <span class="desktop-plugin-toggle-label">${state.pluginsEnabled ? "Enabled" : "Disabled"}</span>
            </label>
          </section>
            ${state.statusMessage ? `<p class="desktop-plugin-status${statusClass}" role="status">${escapeHtml(state.statusMessage)}</p>` : ""}
          <section class="desktop-plugin-section" aria-labelledby="desktop-plugin-repositories-title">
            <div class="desktop-plugin-section-heading">
              <h2 id="desktop-plugin-repositories-title">Plugin Repositories</h2>
              <label><input type="checkbox" data-plugin-group-repositories${repositories.groupStreamsByRepository ? " checked" : ""}${repositories.canEdit() ? "" : " disabled"}> Group streams by repository</label>
            </div>
            <form class="desktop-plugin-form" data-plugin-repository-form>
              <div class="desktop-plugin-field">
                <label class="desktop-plugin-input-label" for="desktop-plugin-repository-url">Repository URL or short code</label>
                <div class="desktop-plugin-input-row">
                  <input id="desktop-plugin-repository-url" class="desktop-plugin-input" data-plugin-repository-url type="text" required autocomplete="off" value="${escapeHtml(state.repositoryDraft)}">
                  <button class="desktop-plugin-primary-action" type="submit"${repositories.canEdit() && !state.repositoryBusy ? "" : " disabled"}>Add Repository</button>
                </div>
              </div>
            </form>
            ${state.repositoryBusy ? '<p class="desktop-plugin-status" role="status">Working…</p>' : ""}
            <div class="desktop-plugin-source-list">${repositories.listRepositories().map(renderRepository).join("")}</div>
          </section>
          <section class="desktop-plugin-section" aria-labelledby="desktop-plugin-sources-title">
            <div class="desktop-plugin-section-heading">
              <div>
                <h2 id="desktop-plugin-sources-title">Plugin Sources</h2>
                <p>Add custom stream source URL templates for this profile.</p>
              </div>
              <span class="desktop-plugin-count">${state.sources.length} sources</span>
            </div>
            <details class="settings-manager-add" data-plugin-add-disclosure ${state.formOpen || state.addError ? "open" : ""}>
            <summary class="settings-manager-add-trigger">+ Add Source</summary>
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
            </details>
            <div class="desktop-plugin-source-list">${sources}</div>
          </section>
          ${renderConfirmation()}
        </div>
      `;
    },

    bind(container) {
      container
        .querySelector("[data-plugin-repository-url]")
        ?.addEventListener("input", (event) => {
          state.repositoryDraft = event.target.value;
        });
      container
        .querySelector("[data-plugin-repository-form]")
        ?.addEventListener("submit", (event) => {
          event.preventDefault();
          void editRepository(
            async () => {
              const repository = await repositories.addRepository(state.repositoryDraft);
              state.repositoryDraft = "";
              return repository.name + " added.";
            },
            { sync: true }
          );
        });
      container
        .querySelector("[data-plugin-group-repositories]")
        ?.addEventListener("change", (event) => {
          repositories.setGroupStreamsByRepository(event.target.checked);
        });
      container.querySelectorAll("[data-plugin-repository-enabled]").forEach((node) => {
        node.addEventListener(
          "change",
          () =>
            void editRepository(
              () => {
                repositories.setRepositoryEnabled(
                  node.dataset.pluginRepositoryEnabled,
                  node.checked
                );
                return "Repository updated.";
              },
              { sync: true }
            )
        );
      });
      container.querySelectorAll("[data-plugin-repository-refresh]").forEach((node) => {
        node.addEventListener(
          "click",
          () =>
            void editRepository(async () => {
              await repositories.refreshRepository(node.dataset.pluginRepositoryRefresh);
              return "Repository refreshed.";
            })
        );
      });
      container.querySelectorAll("[data-plugin-repository-remove]").forEach((node) => {
        node.addEventListener("click", () => {
          const repository = repositories
            .listRepositories()
            .find((entry) => entry.id === node.dataset.pluginRepositoryRemove);
          if (!repository) return;
          state.removeTarget = { ...repository, repository: true };
          void rerender();
        });
      });
      container.querySelectorAll("[data-plugin-scrapers-toggle-all]").forEach((node) => {
        node.addEventListener(
          "click",
          () =>
            void editRepository(() => {
              repositories.setRepositoryScrapersEnabled(
                node.dataset.pluginScrapersToggleAll,
                node.dataset.enabled === "true"
              );
              return "Scrapers updated.";
            })
        );
      });
      container.querySelectorAll("[data-plugin-scraper-enabled]").forEach((node) => {
        node.addEventListener(
          "change",
          () =>
            void editRepository(() => {
              repositories.setScraperEnabled(node.dataset.pluginScraperEnabled, node.checked);
              return "Scraper updated.";
            })
        );
      });
      container.querySelectorAll("[data-plugin-scraper-test]").forEach((node) => {
        node.addEventListener(
          "click",
          () =>
            void editRepository(async () => {
              const id = node.dataset.pluginScraperTest;
              state.scraperTest = null;
              const failures = new Set();
              const results = await repositories.testScraper(id, {
                onRequestFailure: ({ host, status, truncated }) => {
                  if (failures.size >= 12) return;
                  const reason = truncated
                    ? "Response exceeded the size limit"
                    : status
                      ? "HTTP " + status
                      : "Browser request failed (CORS or network)";
                  failures.add((host || "Unknown host") + " · " + reason);
                }
              });
              const scraper = repositories.listScrapers().find((entry) => entry.id === id);
              const media = scraper?.supportedTypes.includes("movie")
                ? "The Matrix (1999) · TMDB 603"
                : "Series test · TMDB 603 · S1 E1";
              state.scraperTest = {
                id,
                media,
                failures: [...failures],
                count: results.length,
                titles: results
                  .slice(0, 3)
                  .map((result) =>
                    String(result.title || result.name || result.quality || "Stream")
                  )
              };
              return results.length + " streams found in the test.";
            })
        );
      });
      container.querySelectorAll("[data-plugin-scraper-settings]").forEach((form) => {
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          const input = form.elements.settings.value;
          void editRepository(() => {
            const settings = JSON.parse(input);
            if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
              throw new Error("Enter a JSON object for scraper settings.");
            }
            repositories.setScraperSettings(form.dataset.pluginScraperSettings, settings);
            return "Scraper settings saved.";
          });
        });
      });
      container
        .querySelector("[data-plugin-add-disclosure]")
        ?.addEventListener("toggle", (event) => {
          state.formOpen = event.currentTarget.open;
        });
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
        node.addEventListener(
          "change",
          () => void setSourceEnabled(state.sources[Number(node.dataset.pluginSourceToggle || -1)])
        );
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
      container
        .querySelector("[data-plugin-remove-confirm]")
        ?.addEventListener("click", () => void confirmRemove());
      container
        .querySelector("[data-plugin-dialog-backdrop]")
        ?.addEventListener("click", (event) => {
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
