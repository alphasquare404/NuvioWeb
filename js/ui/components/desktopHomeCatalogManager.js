import { bindListReorderDrag, deferWhileReordering } from "./listReorderDrag.js";
import { AuthManager } from "../../core/auth/authManager.js";
import { buildOrderedHomeCatalogItems } from "../../core/addons/homeCatalogs.js";
import { HomeCatalogStore } from "../../data/local/homeCatalogStore.js";
import { CollectionsStore } from "../../data/local/collectionsStore.js";
import { LayoutPreferences } from "../../data/local/layoutPreferences.js";
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
    // A redraw during a drag would destroy the row under the finger.
    if (deferWhileReordering(() => void rerender())) return;
    await requestRender?.();
  };

  const setStatus = (message = "", tone = "") => {
    state.statusMessage = message;
    state.statusTone = tone;
  };

  const loadItems = async () => {
    const addons = await addonRepository.getInstalledAddons();
    const collections = CollectionsStore.get();
    const prefs = HomeCatalogStore.get();
    const heroCatalogKeys = new Set(
      (LayoutPreferences.get().heroCatalogKeys || []).map((key) => String(key || "").trim())
    );
    const hasExplicitHeroSelection = heroCatalogKeys.size > 0;
    const collectionsById = new Map(
      collections.map((collection) => [String(collection?.id || "").trim(), collection])
    );
    state.items = buildOrderedHomeCatalogItems(
      addons,
      collections,
      prefs.order,
      prefs.disabled,
      prefs.customTitles
    ).map((item) => {
      if (item.isCollection) {
        return {
          ...item,
          pinToTop: Boolean(collectionsById.get(String(item.collectionId || ""))?.pinToTop)
        };
      }
      return {
        ...item,
        isHeroSource:
          !hasExplicitHeroSelection || heroCatalogKeys.has(String(item.key || ""))
      };
    });
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

    // "Saving" and "Syncing" were set one after the other without yielding,
    // so the first was painted over before a frame could show it.
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
    const isCollection = Boolean(item?.isCollection);
    const name = String(item?.catalogName || (isCollection ? "Collection" : "Catalog"));
    const metadata = isCollection
      ? [
          "Collection",
          String(item?.addonName || "").trim(),
          item?.pinToTop ? "Pinned above catalogs" : ""
        ]
          .filter(Boolean)
          .join(" · ")
      : [
          catalogTypeLabel(item?.type),
          String(item?.addonName || "").trim(),
          item?.isHeroSource ? "Hero source" : "Not in hero"
        ]
          .filter(Boolean)
          .join(" · ");
    const visible = !item?.isDisabled;
    return `
      <article class="desktop-home-catalog-row${visible ? "" : " is-hidden"}${isCollection ? " is-collection" : ""}"
               data-home-catalog-row
               data-home-catalog-index="${index}">
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
    const moveItem = (fromIndex, toIndex) => {
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
      if (fromIndex >= state.items.length || toIndex >= state.items.length) return;
      const next = [...state.items];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      state.items = next;
    };
    bindListReorderDrag({
      container,
      handleSelector: "[data-home-catalog-drag-handle]",
      itemSelector: "[data-home-catalog-row]",
      dragOverClass: "is-drag-over",
      bodyClass: "desktop-home-catalog-dragging",
      onMove: moveItem,
      onDrop: () => saveOrder()
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
        ? '<p class="desktop-home-catalog-empty">Loading catalogs and collections…</p>'
        : state.items.length
          ? state.items.map(renderItem).join("")
          : '<p class="desktop-home-catalog-empty">No catalogs or collections are available for Home.</p>';
      return `
        <div class="desktop-home-catalog-manager">
          <section class="desktop-home-catalog-section" aria-labelledby="desktop-home-catalog-title">
            <div class="desktop-home-catalog-heading">
              <div>
                <h2 id="desktop-home-catalog-title">Catalogs &amp; Collections</h2>
                <p>Reorder Home rows and choose which catalogs or collections appear.</p>
              </div>
              <span class="desktop-home-catalog-count">${state.items.length} ${
                state.items.length === 1 ? "row" : "rows"
              }</span>
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
