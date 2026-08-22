import { AuthManager } from "../../core/auth/authManager.js";
import { buildOrderedHomeCatalogItems } from "../../core/addons/homeCatalogs.js";
import { HomeCatalogStore } from "../../data/local/homeCatalogStore.js";
import { addonRepository } from "../../data/repository/addonRepository.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function catalogTypeLabel(type) {
  const value = String(type || "").trim().toLowerCase();
  if (value === "series") return "Show";
  if (value === "movie") return "Movie";
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "Catalog";
}

export function createDesktopHomeCatalogManager({ requestRender } = {}) {
  const state = {
    isLoading: false,
    items: [],
    statusMessage: "",
    statusTone: ""
  };

  const rerender = async () => {
    await requestRender?.();
  };

  const setStatus = (message = "", tone = "") => {
    state.statusMessage = message;
    state.statusTone = tone;
  };

  const loadItems = async () => {
    const addons = await addonRepository.getInstalledAddons();
    const prefs = HomeCatalogStore.get();
    state.items = buildOrderedHomeCatalogItems(
      addons,
      [],
      prefs.order,
      prefs.disabled,
      prefs.customTitles
    );
  };

  const saveAndSync = async (writePreferences, verifyLocalSave = null) => {
    const syncResult = writePreferences();
    if (typeof verifyLocalSave === "function" && !verifyLocalSave()) {
      setStatus("Couldn’t save home catalogs.", "error");
      await rerender();
      return;
    }
    if (!AuthManager.isAuthenticated) {
      setStatus("Saved locally", "warning");
      await rerender();
      return;
    }

    setStatus("Saving…", "success");
    await rerender();
    setStatus("Syncing…", "success");
    await rerender();
    const didSync = await syncResult;
    if (didSync === true) {
      setStatus("Synced", "success");
    } else {
      setStatus("Sync failed", "error");
    }
    await rerender();
  };

  const saveOrder = async () => {
    const order = state.items.map((item) => item.key);
    await saveAndSync(
      () => HomeCatalogStore.setOrder(order),
      () => {
        const savedOrder = HomeCatalogStore.get().order || [];
        return order.every((key, index) => savedOrder[index] === key);
      }
    );
  };

  const toggleVisibility = async (item) => {
    if (!item?.disableKey) return;
    const syncResult = HomeCatalogStore.toggleDisabled(item.disableKey);
    await loadItems();
    await saveAndSync(() => syncResult);
  };

  const renderItem = (item, index) => {
    const name = String(item?.catalogName || "Catalog");
    const metadata = [catalogTypeLabel(item?.type), String(item?.addonName || "").trim()]
      .filter(Boolean)
      .join(" · ");
    const visible = !item?.isDisabled;
    return `
      <article class="desktop-home-catalog-row${visible ? "" : " is-hidden"}" data-home-catalog-row data-home-catalog-index="${index}">
        <button class="desktop-home-catalog-drag-handle" type="button" data-home-catalog-drag-handle="${index}" aria-label="Reorder ${escapeHtml(name)}" title="Drag to reorder">
          <span class="material-icons" aria-hidden="true">drag_indicator</span>
        </button>
        <div class="desktop-home-catalog-copy">
          <h3>${escapeHtml(name)}</h3>
          <p>${escapeHtml(metadata)}</p>
        </div>
        <label class="desktop-home-catalog-toggle">
          <input type="checkbox" data-home-catalog-toggle="${index}" ${visible ? "checked" : ""} />
          <span class="desktop-home-catalog-toggle-track" aria-hidden="true"><span></span></span>
          <span class="desktop-home-catalog-toggle-label">Visible</span>
        </label>
      </article>
    `;
  };

  const bindDrag = (container) => {
    let drag = null;
    const moveItem = (fromIndex, toIndex) => {
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
      const next = [...state.items];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      state.items = next;
    };
    const clearDrag = () => {
      container
        .querySelectorAll(".desktop-home-catalog-row.is-dragging, .desktop-home-catalog-row.is-drag-over")
        .forEach((node) => node.classList.remove("is-dragging", "is-drag-over"));
      document.body.classList.remove("desktop-home-catalog-dragging");
      drag = null;
    };

    container.querySelectorAll("[data-home-catalog-drag-handle]").forEach((handle) => {
      handle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        const fromIndex = Number(handle.dataset.homeCatalogDragHandle || -1);
        if (fromIndex < 0) return;
        drag = {
          pointerId: event.pointerId,
          currentIndex: fromIndex,
          startY: event.clientY,
          started: false
        };
      });
      handle.addEventListener("pointermove", (event) => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (!drag.started && Math.abs(event.clientY - drag.startY) < 6) return;
        if (!drag.started) {
          drag.started = true;
          handle.setPointerCapture?.(event.pointerId);
          handle.closest("[data-home-catalog-row]")?.classList.add("is-dragging");
          document.body.classList.add("desktop-home-catalog-dragging");
        }
        event.preventDefault();
        const rows = Array.from(container.querySelectorAll("[data-home-catalog-row]"));
        const target = rows.find((row) => {
          const rect = row.getBoundingClientRect();
          return event.clientY >= rect.top && event.clientY <= rect.bottom;
        });
        const draggedRow = handle.closest("[data-home-catalog-row]");
        if (!target || !draggedRow || target === draggedRow) return;
        const currentIndex = rows.indexOf(draggedRow);
        const targetIndex = rows.indexOf(target);
        if (currentIndex < 0 || targetIndex < 0 || currentIndex === targetIndex) return;
        if (targetIndex > currentIndex) target.after(draggedRow);
        else target.before(draggedRow);
        moveItem(drag.currentIndex, targetIndex);
        drag.currentIndex = targetIndex;
        rows.forEach((row) => row.classList.toggle("is-drag-over", row === target));
      });
      const finish = async (event) => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        const didDrag = drag.started;
        handle.releasePointerCapture?.(event.pointerId);
        clearDrag();
        if (didDrag) {
          await saveOrder();
        }
      };
      handle.addEventListener("pointerup", (event) => void finish(event));
      handle.addEventListener("pointercancel", (event) => void finish(event));
    });
  };

  return {
    async load() {
      state.isLoading = true;
      await rerender();
      try {
        await loadItems();
      } catch (error) {
        console.warn("Desktop home catalog load failed", error);
        state.items = [];
        setStatus("Couldn’t load home catalogs.", "error");
      } finally {
        state.isLoading = false;
        await rerender();
      }
    },

    render() {
      const statusClass = state.statusTone ? ` is-${state.statusTone}` : "";
      const rows = state.isLoading
        ? '<p class="desktop-home-catalog-empty">Loading home catalogs…</p>'
        : state.items.length
          ? state.items.map(renderItem).join("")
          : '<p class="desktop-home-catalog-empty">No home catalogs available. Install or enable an addon that provides catalogs.</p>';
      return `
        <div class="desktop-home-catalog-manager">
          <section class="desktop-home-catalog-section" aria-labelledby="desktop-home-catalog-title">
            <div class="desktop-home-catalog-heading">
              <div>
                <h2 id="desktop-home-catalog-title">Home Catalogs</h2>
                <p>Reorder catalog rows and choose which ones appear on Home.</p>
              </div>
              <span class="desktop-home-catalog-count">${state.items.length} catalogs</span>
            </div>
            ${state.statusMessage ? `<p class="desktop-home-catalog-status${statusClass}" role="status">${escapeHtml(state.statusMessage)}</p>` : ""}
            <div class="desktop-home-catalog-list">${rows}</div>
          </section>
        </div>
      `;
    },

    bind(container) {
      container.querySelectorAll("[data-home-catalog-toggle]").forEach((node) => {
        node.addEventListener("change", () => void toggleVisibility(state.items[Number(node.dataset.homeCatalogToggle || -1)]));
      });
      bindDrag(container);
    }
  };
}
