import { AuthManager } from "../../core/auth/authManager.js";
import { StartupSyncService } from "../../core/profile/startupSyncService.js";
import { addonRepository } from "../../data/repository/addonRepository.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatAddonHost(url) {
  try {
    return new URL(String(url || "")).host || String(url || "");
  } catch {
    return String(url || "");
  }
}

function truncateText(value, maxLength = 220) {
  const text = String(value || "").trim();
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function createDesktopAddonManager({ requestRender, isActive } = {}) {
  const state = {
    isLoading: false,
    isAdding: false,
    addonUrl: "",
    addError: "",
    addons: [],
    refreshingUrl: "",
    removeTarget: null,
    statusMessage: "",
    statusTone: ""
  };

  const rerender = async () => {
    await requestRender?.();
  };

  let unsubscribeAddonChanges = null;

  const setStatus = (message = "", tone = "") => {
    state.statusMessage = message;
    state.statusTone = tone;
  };

  const requestAutosync = async () => {
    if (!AuthManager.isAuthenticated) {
      setStatus("Saved locally", "warning");
      await rerender();
      return false;
    }

    setStatus("Syncing…");
    await rerender();
    const synced = await StartupSyncService.requestAddonSync();
    setStatus(synced ? "Synced" : "Sync failed — changes are still saved locally.", synced ? "success" : "error");
    await rerender();
    return synced;
  };

  const loadAddons = async () => {
    state.isLoading = true;
    await rerender();
    try {
      state.addons = await addonRepository.getInstalledAddons({ includeDisabled: true });
    } catch (error) {
      console.warn("Desktop addon list load failed", error);
      state.addons = [];
      setStatus("Couldn’t load installed addons. Please try again.", "error");
    } finally {
      state.isLoading = false;
      await rerender();
    }
  };

  const bindAddonStoreSubscription = () => {
    if (unsubscribeAddonChanges) return;
    unsubscribeAddonChanges = addonRepository.onInstalledAddonsChanged(() => {
      if (typeof isActive === "function" && !isActive()) {
        return;
      }
      void loadAddons();
    });
  };

  const addAddon = async () => {
    const url = String(state.addonUrl || "").trim();
    if (!url) {
      state.addError = "Enter an addon manifest URL first.";
      await rerender();
      return;
    }

    state.isAdding = true;
    state.addError = "";
    setStatus("Validating addon manifest…");
    await rerender();
    try {
      const result = await addonRepository.fetchAddon(url);
      if (result.status !== "success") {
        throw new Error(result.message || "The addon manifest could not be loaded.");
      }
      const added = await addonRepository.addAddon(result.data?.baseUrl || url);
      if (!added) {
        throw new Error("That addon is already installed.");
      }
      state.addonUrl = "";
      state.addons = await addonRepository.getInstalledAddons({ includeDisabled: true });
      setStatus(`${result.data?.displayName || result.data?.name || "Addon"} added locally.`);
      await rerender();
      await requestAutosync();
    } catch (error) {
      console.warn("Desktop addon add failed", error);
      state.addError = String(error?.message || "Unable to add that addon.");
      setStatus("The addon was not added.", "error");
      await rerender();
    } finally {
      state.isAdding = false;
      await rerender();
    }
  };

  const toggleAddon = async (addon) => {
    const url = String(addon?.baseUrl || "");
    if (!url) return;
    const enabled = !addonRepository.isAddonEnabled(url);
    addonRepository.setAddonEnabledStates([{ url, enabled }], { replace: false });
    state.addons = await addonRepository.getInstalledAddons({ includeDisabled: true });
    setStatus(`${addon.displayName || addon.name || "Addon"} ${enabled ? "enabled" : "disabled"} locally.`);
    await rerender();
    await requestAutosync();
  };

  const refreshAddon = async (addon) => {
    const url = String(addon?.baseUrl || "");
    if (!url || state.refreshingUrl) return;
    state.refreshingUrl = url;
    setStatus(`Refreshing ${addon.displayName || addon.name || "addon"} manifest…`);
    await rerender();
    try {
      const result = await addonRepository.refreshAddon(url);
      if (result.status !== "success") {
        throw new Error(result.message || "The manifest could not be refreshed.");
      }
      state.addons = await addonRepository.getInstalledAddons({ includeDisabled: true });
      setStatus("Manifest refreshed.", "success");
    } catch (error) {
      console.warn("Desktop addon refresh failed", error);
      setStatus(String(error?.message || "Unable to refresh the addon manifest."), "error");
    } finally {
      state.refreshingUrl = "";
      await rerender();
    }
  };

  const confirmRemove = async () => {
    const addon = state.removeTarget;
    const url = String(addon?.baseUrl || "");
    if (!url) return;
    state.removeTarget = null;
    setStatus(`Removing ${addon.displayName || addon.name || "addon"}…`);
    await rerender();
    try {
      const removed = await addonRepository.removeAddon(url);
      if (!removed) {
        throw new Error("That addon could not be removed.");
      }
      state.addons = await addonRepository.getInstalledAddons({ includeDisabled: true });
      setStatus(`${addon.displayName || addon.name || "Addon"} removed locally.`);
      await rerender();
      await requestAutosync();
    } catch (error) {
      console.warn("Desktop addon remove failed", error);
      setStatus(String(error?.message || "That addon could not be removed."), "error");
      await rerender();
    }
  };

  const persistOrder = async () => {
    const urls = state.addons.map((addon) => addon.baseUrl).filter(Boolean);
    await addonRepository.setAddonOrder(urls);
    setStatus("Addon order saved locally.");
    await rerender();
    await requestAutosync();
  };

  const renderCard = (addon, index) => {
    const name = addon?.displayName || addon?.name || "Unknown Addon";
    const url = String(addon?.baseUrl || "");
    const enabled = addonRepository.isAddonEnabled(url);
    const version = String(addon?.version || "").trim();
    const description = truncateText(addon?.description);
    const isRefreshing = state.refreshingUrl === url;
    return `
      <article class="desktop-addon-card${enabled ? "" : " is-disabled"}" data-addon-card data-addon-index="${index}">
        <button class="desktop-addon-drag-handle" type="button" data-addon-drag-handle="${index}" aria-label="Reorder ${escapeHtml(name)}" title="Drag to reorder">
          <span class="material-icons" aria-hidden="true">drag_indicator</span>
        </button>
        <div class="desktop-addon-card-copy">
          <div class="desktop-addon-card-heading">
            <h2>${escapeHtml(name)}</h2>
            ${version ? `<span class="desktop-addon-version">v${escapeHtml(version)}</span>` : ""}
          </div>
          ${description ? `<p class="desktop-addon-description">${escapeHtml(description)}</p>` : ""}
          <p class="desktop-addon-url" title="${escapeHtml(url)}">${escapeHtml(formatAddonHost(url))}</p>
        </div>
        <div class="desktop-addon-card-actions" aria-label="${escapeHtml(name)} actions">
          <label class="desktop-addon-toggle">
            <input type="checkbox" data-addon-toggle="${index}" ${enabled ? "checked" : ""} />
            <span class="desktop-addon-toggle-track" aria-hidden="true"><span></span></span>
            <span class="desktop-addon-toggle-label">${enabled ? "Enabled" : "Disabled"}</span>
          </label>
          <button class="desktop-addon-action" type="button" data-addon-refresh="${index}" ${isRefreshing ? "disabled" : ""}>${isRefreshing ? "Refreshing…" : "Refresh"}</button>
          <button class="desktop-addon-action desktop-addon-action-danger" type="button" data-addon-remove="${index}">Remove</button>
        </div>
      </article>
    `;
  };

  const renderConfirmation = () => {
    if (!state.removeTarget) return "";
    const name = state.removeTarget.displayName || state.removeTarget.name || "this addon";
    return `
      <div class="desktop-addon-dialog-backdrop" data-addon-dialog-backdrop>
        <section class="desktop-addon-dialog" role="dialog" aria-modal="true" aria-labelledby="desktop-addon-remove-title">
          <h2 id="desktop-addon-remove-title">Remove ${escapeHtml(name)}?</h2>
          <p>This removes the addon from this profile. You can add it again later with its manifest URL.</p>
          <div class="desktop-addon-dialog-actions">
            <button class="desktop-addon-action" type="button" data-addon-remove-cancel>Cancel</button>
            <button class="desktop-addon-action desktop-addon-action-danger" type="button" data-addon-remove-confirm>Remove</button>
          </div>
        </section>
      </div>
    `;
  };

  const bindDrag = (container) => {
    let drag = null;
    const clearDrag = () => {
      container.querySelectorAll(".desktop-addon-card.is-dragging, .desktop-addon-card.is-drag-over").forEach((node) => {
        node.classList.remove("is-dragging", "is-drag-over");
      });
      document.body.classList.remove("desktop-addon-dragging");
      drag = null;
    };
    const moveItem = (fromIndex, toIndex) => {
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= state.addons.length || toIndex >= state.addons.length) return;
      const next = [...state.addons];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      state.addons = next;
    };
    container.querySelectorAll("[data-addon-drag-handle]").forEach((handle) => {
      handle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        const fromIndex = Number(handle.dataset.addonDragHandle || -1);
        if (fromIndex < 0) return;
        drag = { pointerId: event.pointerId, fromIndex, currentIndex: fromIndex, started: false, startY: event.clientY };
      });
      handle.addEventListener("pointermove", (event) => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (!drag.started && Math.abs(event.clientY - drag.startY) < 6) return;
        if (!drag.started) {
          drag.started = true;
          handle.setPointerCapture?.(event.pointerId);
          handle.closest("[data-addon-card]")?.classList.add("is-dragging");
          document.body.classList.add("desktop-addon-dragging");
        }
        event.preventDefault();
        const cards = Array.from(container.querySelectorAll("[data-addon-card]"));
        const target = cards.find((card) => {
          const rect = card.getBoundingClientRect();
          return event.clientY >= rect.top && event.clientY <= rect.bottom;
        });
        if (!target) return;
        const targetIndex = cards.indexOf(target);
        const draggedCard = handle.closest("[data-addon-card]");
        if (targetIndex < 0 || !draggedCard || target === draggedCard) return;
        const currentIndex = cards.indexOf(draggedCard);
        if (currentIndex < 0 || currentIndex === targetIndex) return;
        if (targetIndex > currentIndex) {
          target.after(draggedCard);
        } else {
          target.before(draggedCard);
        }
        moveItem(drag.currentIndex, targetIndex);
        drag.currentIndex = targetIndex;
        cards.forEach((card) => card.classList.toggle("is-drag-over", card === target));
      });
      const finish = async (event) => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        const didDrag = drag.started;
        handle.releasePointerCapture?.(event.pointerId);
        clearDrag();
        if (didDrag) {
          await rerender();
          await persistOrder();
        }
      };
      handle.addEventListener("pointerup", (event) => void finish(event));
      handle.addEventListener("pointercancel", (event) => void finish(event));
    });
  };

  return {
    async load() {
      await loadAddons();
    },

    render() {
      const cards = state.isLoading
        ? '<p class="desktop-addon-empty">Loading installed addons…</p>'
        : state.addons.length
          ? state.addons.map(renderCard).join("")
          : '<p class="desktop-addon-empty">No addons are installed for this profile yet.</p>';
      const statusClass = state.statusTone ? ` is-${state.statusTone}` : "";
      return `
        <div class="desktop-addon-manager desktop-addon-manager-inline">
          <section class="desktop-addon-section" aria-labelledby="desktop-addon-installed-title">
            <div class="desktop-addon-section-heading">
              <div>
                <h2 id="desktop-addon-installed-title">Installed Addons</h2>
                <p>Manage the addons available to this profile.</p>
              </div>
              <span class="desktop-addon-count">${state.addons.length} installed</span>
            </div>
            ${state.statusMessage ? `<p class="desktop-addon-inline-status${statusClass}" role="status">${escapeHtml(state.statusMessage)}</p>` : ""}
            <form class="desktop-addon-form" data-addon-form>
              <label class="desktop-addon-input-label" for="desktop-addon-url">Manifest URL</label>
              <div class="desktop-addon-input-row">
                <input id="desktop-addon-url" class="desktop-addon-input" type="url" inputmode="url" autocomplete="url" placeholder="https://example.com/manifest.json" value="${escapeHtml(state.addonUrl)}" data-addon-url />
                <button class="desktop-addon-primary-action" type="submit" ${state.isAdding ? "disabled" : ""}>${state.isAdding ? "Adding…" : "Add Addon"}</button>
              </div>
              ${state.addError ? `<p class="desktop-addon-form-message is-error" role="alert">${escapeHtml(state.addError)}</p>` : ""}
            </form>
            <div class="desktop-addon-list">${cards}</div>
          </section>
          ${renderConfirmation()}
        </div>
      `;
    },

    bind(container) {
      bindAddonStoreSubscription();
      container.querySelector("[data-addon-url]")?.addEventListener("input", (event) => {
        state.addonUrl = String(event.target?.value || "");
        state.addError = "";
      });
      container.querySelector("[data-addon-form]")?.addEventListener("submit", (event) => {
        event.preventDefault();
        void addAddon();
      });
      container.querySelectorAll("[data-addon-toggle]").forEach((node) => {
        node.addEventListener("change", () => void toggleAddon(state.addons[Number(node.dataset.addonToggle || -1)]));
      });
      container.querySelectorAll("[data-addon-refresh]").forEach((node) => {
        node.addEventListener("click", () => void refreshAddon(state.addons[Number(node.dataset.addonRefresh || -1)]));
      });
      container.querySelectorAll("[data-addon-remove]").forEach((node) => {
        node.addEventListener("click", () => {
          state.removeTarget = state.addons[Number(node.dataset.addonRemove || -1)] || null;
          void rerender();
        });
      });
      container.querySelector("[data-addon-remove-cancel]")?.addEventListener("click", () => {
        state.removeTarget = null;
        void rerender();
      });
      container.querySelector("[data-addon-remove-confirm]")?.addEventListener("click", () => void confirmRemove());
      container.querySelector("[data-addon-dialog-backdrop]")?.addEventListener("click", (event) => {
        if (event.target === event.currentTarget) {
          state.removeTarget = null;
          void rerender();
        }
      });
      bindDrag(container);
    },

    async handleKeyDown(event) {
      if (event?.key === "Escape" && state.removeTarget) {
        event.preventDefault();
        state.removeTarget = null;
        await rerender();
        return true;
      }
      return false;
    },

    dispose() {
      unsubscribeAddonChanges?.();
      unsubscribeAddonChanges = null;
    }
  };
}
