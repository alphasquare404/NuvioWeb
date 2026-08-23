import { Platform } from "../../../platform/index.js";
import { ProfileManager } from "../../../core/profile/profileManager.js";
import { CollectionsStore, getCollectionFolderSources } from "../../../data/local/collectionsStore.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const profileId = () => String(ProfileManager.getActiveProfileId() || "1");
const labelForMode = (value) => ({ TABBED_GRID: "Tabs", ROWS: "Rows", FOLLOW_LAYOUT: "Follow Layout" }[String(value || "").toUpperCase()] || "Tabs");
const labelForShape = (value) => ({ POSTER: "Poster", SQUARE: "Square", LANDSCAPE: "Wide" }[String(value || "").toUpperCase()] || "Square");

function getCollection(id) {
  return CollectionsStore.getForProfile(profileId()).find((collection) => String(collection.id) === String(id)) || null;
}

function saveCollection(next) {
  const targetProfile = profileId();
  const collections = CollectionsStore.getForProfile(targetProfile);
  CollectionsStore.replaceForProfile(targetProfile, collections.map((item) => item.id === next.id ? next : item));
}

function sourceLabel(source) {
  if (source.provider === "tmdb") return `TMDB · ${source.title || source.tmdbSourceType}`;
  if (source.provider === "trakt") return `Trakt · ${source.title || `List ${source.traktListId}`}`;
  return [source.catalogName || source.title || "Catalog", source.type, source.addonName].filter(Boolean).join(" · ");
}

function backToSettings() { void Router.navigate("settings"); }

function bindImagePreview(input, preview) {
  const apply = () => {
    const url = String(input.value || "").trim();
    preview.hidden = !url;
    if (url) preview.src = url;
  };
  input.addEventListener("input", apply);
  preview.addEventListener("error", () => { preview.hidden = true; });
  apply();
}

export const CollectionEditorScreen = {
  container: null,
  params: null,
  async mount(params = {}) {
    this.params = params;
    this.container = document.getElementById("collectionEdit");
    if (!Platform.isBrowser()) { backToSettings(); return; }
    ScreenUtils.show(this.container);
    await this.render();
  },
  cleanup() { ScreenUtils.hide(this.container); },
  async render() {
    const collection = getCollection(this.params?.collectionId);
    if (!collection) { backToSettings(); return; }
    const folders = collection.folders || [];
    this.container.innerHTML = `
      <main class="desktop-collection-editor-shell">
        <button class="desktop-collection-editor-back" type="button" data-editor-back aria-label="Back"><span class="material-icons">arrow_back</span></button>
        <header class="desktop-collection-editor-header"><p>Collections</p><h1>Edit Collection</h1></header>
        <section class="desktop-collection-editor-card">
          <label>Collection Name<input data-field="title" value="${escapeHtml(collection.title)}" /></label>
          <label>Backdrop Image URL<input data-field="backdropImageUrl" value="${escapeHtml(collection.backdropImageUrl || "")}" placeholder="https://…" /></label>
          <img class="desktop-collection-backdrop-preview" data-backdrop-preview alt="Backdrop preview" />
          <div class="desktop-collection-editor-toggle-row"><span><strong>Pin Above Catalogs</strong><small>Show this collection before standard catalog rows.</small></span><label class="desktop-collection-switch"><input type="checkbox" data-field="pinToTop" ${collection.pinToTop ? "checked" : ""}/><span></span></label></div>
          <fieldset class="desktop-collection-segmented"><legend>View Mode</legend>${["TABBED_GRID", "ROWS", "FOLLOW_LAYOUT"].map((mode) => `<button type="button" data-view-mode="${mode}" class="${collection.viewMode === mode ? "is-selected" : ""}">${labelForMode(mode)}</button>`).join("")}</fieldset>
          <div class="desktop-collection-editor-toggle-row"><span><strong>Show “All” Tab</strong><small>Used when the collection is displayed as tabs.</small></span><label class="desktop-collection-switch"><input type="checkbox" data-field="showAllTab" ${collection.showAllTab ? "checked" : ""}/><span></span></label></div>
        </section>
        <section class="desktop-collection-editor-section"><div class="desktop-collection-editor-section-heading"><div><h2>Folders</h2><p>Folders appear in their saved order.</p></div><button type="button" data-add-folder>Add Folder</button></div>
          <div class="desktop-collection-editor-list">${folders.length ? folders.map((folder, index) => `<article class="desktop-collection-editor-row"><button type="button" data-folder-drag="${index}" class="desktop-collection-drag-handle"><span class="material-icons">drag_indicator</span></button><div class="desktop-folder-cover">${folder.coverImageUrl ? `<img src="${escapeHtml(folder.coverImageUrl)}" alt="" />` : escapeHtml(folder.coverEmoji || "□")}</div><div><h3>${escapeHtml(folder.title)}</h3><p>${labelForShape(folder.tileShape)} · ${getCollectionFolderSources(folder).length} sources</p></div><div class="desktop-collection-editor-actions"><button type="button" data-edit-folder="${escapeHtml(folder.id)}">Edit</button><button type="button" data-delete-folder="${escapeHtml(folder.id)}" class="is-danger">Delete</button></div></article>`).join("") : '<p class="desktop-collection-manager-empty">No folders yet. Add one to start grouping sources.</p>'}</div>
        </section>
      </main>`;
    this.bind(collection);
  },
  bind(collection) {
    this.container.querySelector("[data-editor-back]")?.addEventListener("click", () => backToSettings());
    let current = collection;
    const update = (patch) => {
      current = { ...current, ...patch };
      saveCollection(current);
      return current;
    };
    this.container.querySelectorAll("[data-field]").forEach((input) => {
      const field = input.dataset.field;
      const listener = () => update({ [field]: input.type === "checkbox" ? input.checked : input.value });
      input.addEventListener(input.type === "checkbox" ? "change" : "change", listener);
    });
    const backdropInput = this.container.querySelector('[data-field="backdropImageUrl"]');
    const backdropPreview = this.container.querySelector("[data-backdrop-preview]");
    if (backdropInput && backdropPreview) bindImagePreview(backdropInput, backdropPreview);
    this.container.querySelectorAll("[data-view-mode]").forEach((button) => button.addEventListener("click", () => { update({ viewMode: button.dataset.viewMode }); void this.render(); }));
    this.container.querySelector("[data-add-folder]")?.addEventListener("click", () => {
      const title = globalThis.prompt?.("Folder name");
      if (!String(title || "").trim()) return;
      const folder = { id: CollectionsStore.generateId(), title: String(title).trim(), tileShape: "SQUARE", sources: [] };
      update({ folders: [...current.folders, folder] });
      void Router.navigate("collectionFolderEdit", { collectionId: current.id, folderId: folder.id });
    });
    this.container.querySelectorAll("[data-edit-folder]").forEach((button) => button.addEventListener("click", () => void Router.navigate("collectionFolderEdit", { collectionId: collection.id, folderId: button.dataset.editFolder })));
    this.container.querySelectorAll("[data-delete-folder]").forEach((button) => button.addEventListener("click", () => {
      const folder = collection.folders.find((item) => item.id === button.dataset.deleteFolder);
      if (!folder || !globalThis.confirm?.(`Delete ${folder.title}? This cannot be undone.`)) return;
      update({ folders: collection.folders.filter((item) => item.id !== folder.id) });
      void this.render();
    }));
    this.bindFolderDrag(collection);
  },
  bindFolderDrag(collection) {
    let drag = null;
    this.container.querySelectorAll("[data-folder-drag]").forEach((handle) => {
      handle.addEventListener("pointerdown", (event) => { if (event.button === 0) drag = { id: event.pointerId, index: Number(handle.dataset.folderDrag), y: event.clientY, started: false }; });
      handle.addEventListener("pointermove", (event) => {
        if (!drag || drag.id !== event.pointerId || (!drag.started && Math.abs(event.clientY - drag.y) < 6)) return;
        drag.started = true; handle.setPointerCapture?.(event.pointerId); event.preventDefault();
        const rows = Array.from(this.container.querySelectorAll(".desktop-collection-editor-row")); const current = handle.closest(".desktop-collection-editor-row"); const target = rows.find((row) => { const rect = row.getBoundingClientRect(); return event.clientY >= rect.top && event.clientY <= rect.bottom; });
        if (!current || !target || current === target) return; const from = rows.indexOf(current); const to = rows.indexOf(target); if (to > from) target.after(current); else target.before(current); const latest = getCollection(collection.id) || collection; const next = [...latest.folders]; const [moved] = next.splice(drag.index, 1); next.splice(to, 0, moved); drag.index = to; saveCollection({ ...latest, folders: next });
      });
      const end = (event) => { if (!drag || drag.id !== event.pointerId) return; handle.releasePointerCapture?.(event.pointerId); const rerender = drag.started; drag = null; if (rerender) void this.render(); };
      handle.addEventListener("pointerup", end); handle.addEventListener("pointercancel", end);
    });
  }
};

export const CollectionFolderEditorScreen = {
  container: null,
  params: null,
  async mount(params = {}) { this.params = params; this.container = document.getElementById("collectionFolderEdit"); if (!Platform.isBrowser()) { backToSettings(); return; } ScreenUtils.show(this.container); await this.render(); },
  cleanup() { ScreenUtils.hide(this.container); },
  async render() {
    const collection = getCollection(this.params?.collectionId); const folder = collection?.folders?.find((item) => String(item.id) === String(this.params?.folderId));
    if (!collection || !folder) { void Router.navigate("collectionEdit", { collectionId: this.params?.collectionId }); return; }
    const sources = getCollectionFolderSources(folder); const addons = await addonRepository.getInstalledAddons();
    const catalogOptions = addons.flatMap((addon) => (addon.catalogs || []).map((catalog) => ({ addon, catalog }))).filter(({ catalog }) => catalog?.id && catalog?.type);
    this.container.innerHTML = `<main class="desktop-collection-editor-shell"><button class="desktop-collection-editor-back" type="button" data-folder-back aria-label="Back"><span class="material-icons">arrow_back</span></button><header class="desktop-collection-editor-header"><p>${escapeHtml(collection.title)}</p><h1>Edit Folder</h1></header><section class="desktop-collection-editor-card"><label>Folder Name<input data-folder-field="title" value="${escapeHtml(folder.title)}" /></label><fieldset class="desktop-collection-segmented"><legend>Cover Type</legend><button type="button" data-cover-type="none" class="${!folder.coverImageUrl && !folder.coverEmoji ? "is-selected" : ""}">None</button><button type="button" data-cover-type="emoji" class="${folder.coverEmoji ? "is-selected" : ""}">Emoji</button><button type="button" data-cover-type="image" class="${folder.coverImageUrl ? "is-selected" : ""}">Image URL</button></fieldset><label data-cover-emoji ${folder.coverEmoji ? "" : "hidden"}>Emoji<input data-folder-field="coverEmoji" value="${escapeHtml(folder.coverEmoji || "")}" /></label><label data-cover-image ${folder.coverImageUrl ? "" : "hidden"}>Image URL<input data-folder-field="coverImageUrl" value="${escapeHtml(folder.coverImageUrl || "")}" placeholder="https://…" /></label><img class="desktop-collection-backdrop-preview" data-cover-preview alt="Cover preview" /><label>Animated GIF URL<input data-folder-field="focusGifUrl" value="${escapeHtml(folder.focusGifUrl || "")}" placeholder="https://…" /></label><div class="desktop-collection-editor-toggle-row"><span><strong>Show GIF when configured</strong></span><label class="desktop-collection-switch"><input type="checkbox" data-folder-field="focusGifEnabled" ${folder.focusGifEnabled ? "checked" : ""}/><span></span></label></div><fieldset class="desktop-collection-segmented"><legend>Tile Shape</legend>${["POSTER", "SQUARE", "LANDSCAPE"].map((shape) => `<button type="button" data-tile-shape="${shape}" class="${folder.tileShape === shape ? "is-selected" : ""}">${labelForShape(shape)}</button>`).join("")}</fieldset><div class="desktop-collection-editor-toggle-row"><span><strong>Hide Title</strong></span><label class="desktop-collection-switch"><input type="checkbox" data-folder-field="hideTitle" ${folder.hideTitle ? "checked" : ""}/><span></span></label></div></section><section class="desktop-collection-editor-section"><div class="desktop-collection-editor-section-heading"><div><h2>Catalog Sources</h2><p>Saved source order controls the folder tabs and rows.</p></div></div><div class="desktop-collection-source-add"><select data-source-kind><option value="addon">Addon catalog</option><option value="tmdb">TMDB discover</option><option value="trakt">Trakt list</option></select><select data-addon-source>${catalogOptions.map(({ addon, catalog }, index) => `<option value="${index}">${escapeHtml([catalog.name || catalog.id, catalog.type, addon.displayName || addon.name].filter(Boolean).join(" · "))}</option>`).join("") || '<option value="">No enabled addon catalogs</option>'}</select><select data-tmdb-type hidden><option value="POPULAR">Popular</option><option value="TOP_RATED">Top Rated</option><option value="UPCOMING">Upcoming</option></select><select data-tmdb-media hidden><option value="MOVIE">Movies</option><option value="TV">Series</option></select><input data-tmdb-genre hidden placeholder="Genre filter (optional)" /><input data-trakt-list hidden type="number" min="1" placeholder="Trakt list ID" /><button type="button" data-add-source>Add Source</button></div><div class="desktop-collection-editor-list">${sources.length ? sources.map((source, index) => `<article class="desktop-collection-editor-row"><button type="button" class="desktop-collection-drag-handle" data-source-drag="${index}"><span class="material-icons">drag_indicator</span></button><div><h3>${escapeHtml(sourceLabel(source))}</h3><p>${escapeHtml(source.mediaType || source.type || "Movie")}${source.genre ? ` · ${escapeHtml(source.genre)}` : ""}</p></div><div class="desktop-collection-editor-actions"><button type="button" data-remove-source="${index}" class="is-danger">Remove</button></div></article>`).join("") : '<p class="desktop-collection-manager-empty">No catalog sources yet.</p>'}</div></section></main>`;
    this.bind(collection, folder, catalogOptions);
  },
  bind(collection, folder, catalogOptions) {
    let currentCollection = collection;
    let currentFolder = folder;
    const updateFolder = (patch) => {
      currentFolder = { ...currentFolder, ...patch };
      currentCollection = { ...currentCollection, folders: currentCollection.folders.map((item) => item.id === currentFolder.id ? currentFolder : item) };
      saveCollection(currentCollection);
      return currentFolder;
    };
    this.container.querySelector("[data-folder-back]")?.addEventListener("click", () => void Router.navigate("collectionEdit", { collectionId: collection.id }));
    this.container.querySelectorAll("[data-folder-field]").forEach((input) => input.addEventListener(input.type === "checkbox" ? "change" : "change", () => updateFolder({ [input.dataset.folderField]: input.type === "checkbox" ? input.checked : input.value })));
    const coverInput = this.container.querySelector('[data-folder-field="coverImageUrl"]'); const preview = this.container.querySelector("[data-cover-preview]"); if (coverInput && preview) bindImagePreview(coverInput, preview);
    this.container.querySelectorAll("[data-cover-type]").forEach((button) => button.addEventListener("click", () => { const type = button.dataset.coverType; updateFolder(type === "emoji" ? { coverImageUrl: null } : type === "image" ? { coverEmoji: null } : { coverImageUrl: null, coverEmoji: null }); void this.render(); }));
    this.container.querySelectorAll("[data-tile-shape]").forEach((button) => button.addEventListener("click", () => { updateFolder({ tileShape: button.dataset.tileShape }); void this.render(); }));
    const sourceKind = this.container.querySelector("[data-source-kind]");
    const updateSourceFields = () => {
      const kind = sourceKind.value;
      this.container.querySelector("[data-addon-source]").hidden = kind !== "addon";
      this.container.querySelectorAll("[data-tmdb-type], [data-tmdb-media], [data-tmdb-genre]").forEach((node) => { node.hidden = kind !== "tmdb"; });
      this.container.querySelector("[data-trakt-list]").hidden = kind !== "trakt";
    };
    sourceKind?.addEventListener("change", updateSourceFields); updateSourceFields();
    this.container.querySelector("[data-add-source]")?.addEventListener("click", () => {
      const kind = sourceKind.value; let source = null;
      if (kind === "addon") { const entry = catalogOptions[Number(this.container.querySelector("[data-addon-source]").value)]; if (entry) source = { provider: "addon", addonId: entry.addon.baseUrl || entry.addon.id, addonBaseUrl: entry.addon.baseUrl || null, addonName: entry.addon.displayName || entry.addon.name, type: entry.catalog.type, catalogId: entry.catalog.id, catalogName: entry.catalog.name || entry.catalog.id }; }
      if (kind === "tmdb") { const type = this.container.querySelector("[data-tmdb-type]").value; const mediaType = this.container.querySelector("[data-tmdb-media]").value; const genre = String(this.container.querySelector("[data-tmdb-genre]").value || "").trim(); source = { provider: "tmdb", tmdbSourceType: type, title: `${type.replaceAll("_", " ")} ${mediaType === "TV" ? "Series" : "Movies"}`, mediaType, filters: genre ? { withGenres: genre } : {} }; }
      if (kind === "trakt") { const listId = Number(this.container.querySelector("[data-trakt-list]").value); if (Number.isFinite(listId) && listId > 0) source = { provider: "trakt", traktListId: listId, title: `List ${listId}`, mediaType: "MOVIE" }; }
      if (source) { updateFolder({ sources: [...getCollectionFolderSources(currentFolder), source] }); void this.render(); }
    });
    this.container.querySelectorAll("[data-remove-source]").forEach((button) => button.addEventListener("click", () => { const sources = getCollectionFolderSources(currentFolder); const source = sources[Number(button.dataset.removeSource)]; if (!source || !globalThis.confirm?.(`Remove ${sourceLabel(source)}?`)) return; sources.splice(Number(button.dataset.removeSource), 1); updateFolder({ sources }); void this.render(); }));
    this.bindSourceDrag(collection, folder);
  },
  bindSourceDrag(collection, folder) {
    let drag = null;
    this.container.querySelectorAll("[data-source-drag]").forEach((handle) => { handle.addEventListener("pointerdown", (event) => { if (event.button === 0) drag = { id: event.pointerId, index: Number(handle.dataset.sourceDrag), y: event.clientY, started: false }; }); handle.addEventListener("pointermove", (event) => { if (!drag || drag.id !== event.pointerId || (!drag.started && Math.abs(event.clientY - drag.y) < 6)) return; drag.started = true; handle.setPointerCapture?.(event.pointerId); event.preventDefault(); const rows = Array.from(this.container.querySelectorAll(".desktop-collection-editor-row")); const current = handle.closest(".desktop-collection-editor-row"); const target = rows.find((row) => { const r = row.getBoundingClientRect(); return event.clientY >= r.top && event.clientY <= r.bottom; }); if (!current || !target || current === target) return; const from = rows.indexOf(current), to = rows.indexOf(target); const latestCollection = getCollection(collection.id) || collection; const latestFolder = latestCollection.folders.find((item) => item.id === folder.id) || folder; const next = getCollectionFolderSources(latestFolder); if (to > from) target.after(current); else target.before(current); const [moved] = next.splice(drag.index, 1); next.splice(to, 0, moved); drag.index = to; saveCollection({ ...latestCollection, folders: latestCollection.folders.map((item) => item.id === folder.id ? { ...latestFolder, sources: next } : item) }); }); const end = (event) => { if (!drag || drag.id !== event.pointerId) return; handle.releasePointerCapture?.(event.pointerId); const refresh = drag.started; drag = null; if (refresh) void this.render(); }; handle.addEventListener("pointerup", end); handle.addEventListener("pointercancel", end); });
  }
};
