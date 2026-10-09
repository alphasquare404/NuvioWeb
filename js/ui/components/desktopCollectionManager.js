import { bindListReorderDrag, deferWhileReordering } from "./listReorderDrag.js";
import { Router } from "../navigation/router.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { CollectionsStore } from "../../data/local/collectionsStore.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function viewModeLabel(value) {
  const mode = String(value || "TABBED_GRID").toUpperCase();
  if (mode === "ROWS") return "Rows";
  if (mode === "FOLLOW_LAYOUT") return "Follow Layout";
  return "Tabs";
}

function activeProfileId() {
  return String(ProfileManager.getActiveProfileId() || "1");
}

export function createDesktopCollectionManager({ requestRender } = {}) {
  const state = { expanded: false, draftName: "", error: "", collections: [] };

  const load = () => {
    state.collections = CollectionsStore.getForProfile(activeProfileId());
  };
  const rerender = async () => {
    // A redraw during a drag would destroy the row under the finger.
    if (deferWhileReordering(() => void rerender())) return;
    await requestRender?.();
  };
  const replace = (collections) => CollectionsStore.replaceForProfile(activeProfileId(), collections);

  const addCollection = async () => {
    const title = String(state.draftName || "").trim();
    if (!title) {
      state.error = "Enter a collection name first.";
      await rerender();
      return;
    }
    const collection = {
      id: CollectionsStore.generateId(),
      title,
      folders: [],
      viewMode: "TABBED_GRID",
      showAllTab: true,
      pinToTop: false
    };
    replace([...state.collections, collection]);
    state.draftName = "";
    state.error = "";
    await Router.navigate("collectionEdit", { collectionId: collection.id });
  };

  const deleteCollection = async (index) => {
    const collection = state.collections[index];
    if (!collection || !globalThis.confirm?.(`Delete ${collection.title}? This cannot be undone.`)) return;
    CollectionsStore.removeCollection(collection.id, { profileId: activeProfileId() });
    load();
    await rerender();
  };

  const bindDrag = (container) => {
    bindListReorderDrag({
      container,
      handleSelector: "[data-desktop-collection-drag]",
      itemSelector: "[data-desktop-collection-row]",
      dragOverClass: "is-drag-over",
      onMove: (fromIndex, toIndex) => {
        const [moved] = state.collections.splice(fromIndex, 1);
        state.collections.splice(toIndex, 0, moved);
      },
      onDrop: () => replace(state.collections)
    });
  };

  return {
    async load() { load(); await rerender(); },
    toggle() { state.expanded = !state.expanded; load(); },
    get expanded() { return state.expanded; },
    render() {
      const rows = state.collections.length
        ? state.collections.map((collection, index) => `
          <article class="desktop-collection-manager-row" data-desktop-collection-row>
            <button type="button" class="desktop-collection-drag-handle" data-desktop-collection-drag="${index}" aria-label="Reorder ${escapeHtml(collection.title)}"><span class="material-icons">drag_indicator</span></button>
            <div class="desktop-collection-manager-copy"><h3>${escapeHtml(collection.title)}</h3><p>${collection.folders.length} ${collection.folders.length === 1 ? "folder" : "folders"} · ${viewModeLabel(collection.viewMode)}${collection.pinToTop ? " · Pinned" : ""}</p></div>
            <div class="desktop-collection-manager-actions"><button type="button" data-desktop-collection-edit="${index}">Edit</button><button type="button" data-desktop-collection-delete="${index}" class="is-danger">Delete</button></div>
          </article>`).join("")
        : '<p class="desktop-collection-manager-empty">No custom collections yet.</p>';
      return `
        <div class="desktop-collection-manager">
          <p class="desktop-collection-manager-intro">Manage custom collections and folders shown on Home.</p>
          <div class="desktop-collection-add-form"><input type="text" data-desktop-collection-name value="${escapeHtml(state.draftName)}" placeholder="Collection name" aria-label="Collection name" /><button type="button" data-desktop-collection-add>Add Collection</button></div>
          ${state.error ? `<p class="desktop-collection-manager-error">${escapeHtml(state.error)}</p>` : ""}
          <div class="desktop-collection-manager-list">${rows}</div>
        </div>`;
    },
    bind(container) {
      const input = container.querySelector("[data-desktop-collection-name]");
      input?.addEventListener("input", () => { state.draftName = input.value; state.error = ""; });
      input?.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); void addCollection(); } });
      container.querySelector("[data-desktop-collection-add]")?.addEventListener("click", () => void addCollection());
      container.querySelectorAll("[data-desktop-collection-edit]").forEach((button) => button.addEventListener("click", () => {
        const collection = state.collections[Number(button.dataset.desktopCollectionEdit)];
        if (collection) void Router.navigate("collectionEdit", { collectionId: collection.id });
      }));
      container.querySelectorAll("[data-desktop-collection-delete]").forEach((button) => button.addEventListener("click", () => void deleteCollection(Number(button.dataset.desktopCollectionDelete))));
      bindDrag(container);
    }
  };
}
