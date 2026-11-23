import { bindListReorderDrag, deferWhileReordering } from "../../components/listReorderDrag.js";
import { Platform } from "../../../platform/index.js";
import { ProfileManager } from "../../../core/profile/profileManager.js";
import {
  CollectionsStore,
  getCollectionFolderSources
} from "../../../data/local/collectionsStore.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { bindPageHeadingCollapse } from "../../components/pageHeadingCollapse.js";
import { renderBackButtonIcon } from "../../components/backButtonIcon.js";
import { I18n } from "../../../i18n/index.js";

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

function renderMobileCollectionHeading({ title, subtitle, backAttribute }) {
  return `<header class="collection-editor-mobile-heading" data-page-heading>
    <button class="collection-editor-mobile-back" type="button" ${backAttribute} aria-label="${escapeHtml(t("common.back", {}, "Back"))}">
      ${renderBackButtonIcon()}
    </button>
    <div class="collection-editor-mobile-copy">
      <h1 class="collection-editor-mobile-title">${escapeHtml(title)}</h1>
      <p class="collection-editor-mobile-subtitle">${escapeHtml(subtitle)}</p>
    </div>
  </header>`;
}

function bindMobileCollectionHeading(screen) {
  screen.mobileHeadingCleanup?.();
  screen.mobileHeadingCleanup = bindPageHeadingCollapse({ container: screen.container });
}
const profileId = () => String(ProfileManager.getActiveProfileId() || "1");
const labelForMode = (value) =>
  ({
    TABBED_GRID: t("collections_editor_view_mode_grid", {}, "Grid"),
    ROWS: t("collections_editor_view_mode_rows", {}, "Rows"),
    FOLLOW_LAYOUT: t("collections_editor_view_mode_follow", {}, "Follow Layout")
  })[String(value || "").toUpperCase()] || t("collections_editor_view_mode_grid", {}, "Grid");
const labelForShape = (value) =>
  ({
    POSTER: t("collections_editor_shape_poster", {}, "Poster"),
    SQUARE: t("collections_editor_shape_square", {}, "Square"),
    LANDSCAPE: t("collections_editor_shape_wide", {}, "Wide")
  })[String(value || "").toUpperCase()] || t("collections_editor_shape_square", {}, "Square");

function getCollection(id) {
  return (
    CollectionsStore.getForProfile(profileId()).find(
      (collection) => String(collection.id) === String(id)
    ) || null
  );
}

function saveCollection(next) {
  const targetProfile = profileId();
  const collections = CollectionsStore.getForProfile(targetProfile);
  CollectionsStore.replaceForProfile(
    targetProfile,
    collections.map((item) => (item.id === next.id ? next : item))
  );
}

function sourceLabel(source) {
  if (source.provider === "tmdb") return `TMDB · ${source.title || source.tmdbSourceType}`;
  if (source.provider === "trakt") {
    return `Trakt · ${source.title ||
      t("collections_editor_trakt_list_with_id", [source.traktListId], `List ${source.traktListId}`)}`;
  }
  return [
    source.catalogName || source.title || t("collections_editor_catalogs", {}, "Catalog"),
    source.type,
    source.addonName
  ]
    .filter(Boolean)
    .join(" · ");
}

function backToSettings() {
  void Router.navigate("settings");
}

function bindImagePreview(input, preview) {
  const apply = () => {
    const url = String(input.value || "").trim();
    preview.hidden = !url;
    if (url) preview.src = url;
  };
  input.addEventListener("input", apply);
  preview.addEventListener("error", () => {
    preview.hidden = true;
  });
  apply();
}

export const CollectionEditorScreen = {
  container: null,
  params: null,
  async mount(params = {}) {
    this.params = params;
    this.container = document.getElementById("collectionEdit");
    if (!Platform.isBrowser()) {
      backToSettings();
      return;
    }
    ScreenUtils.show(this.container);
    await this.render();
  },
  cleanup() {
    this.mobileHeadingCleanup?.();
    this.mobileHeadingCleanup = null;
    ScreenUtils.hide(this.container);
  },
  async render() {
    // A redraw during a drag would destroy the row under the finger.
    if (deferWhileReordering(() => void this.render())) return;
    const collection = getCollection(this.params?.collectionId);
    if (!collection) {
      backToSettings();
      return;
    }
    const folders = collection.folders || [];
    this.container.innerHTML = `
      <main class="desktop-collection-editor-shell">
        ${renderMobileCollectionHeading({
          title: t("collections_editor_edit_collection", {}, "Edit Collection"),
          subtitle: t("collections_header", {}, "Collections"),
          backAttribute: "data-editor-mobile-back"
        })}
        <button class="desktop-collection-editor-back" type="button" data-editor-back aria-label="${escapeHtml(t("common.back", {}, "Back"))}">${renderBackButtonIcon()}</button>
        <header class="desktop-collection-editor-header"><p>${escapeHtml(t("collections_header", {}, "Collections"))}</p><h1>${escapeHtml(t("collections_editor_edit_collection", {}, "Edit Collection"))}</h1></header>
        <section class="desktop-collection-editor-card">
          <label>${escapeHtml(t("collections_editor_name_label", {}, "Collection Name"))}<input data-field="title" value="${escapeHtml(collection.title)}" /></label>
          <label>${escapeHtml(t("collections_editor_backdrop_url_label", {}, "Backdrop Image URL"))}<input data-field="backdropImageUrl" value="${escapeHtml(collection.backdropImageUrl || "")}" placeholder="https://…" /></label>
          <img class="desktop-collection-backdrop-preview" data-backdrop-preview alt="${escapeHtml(t("collections_editor_backdrop_preview", {}, "Backdrop preview"))}" />
          <div class="desktop-collection-editor-toggle-row"><span><strong>${escapeHtml(t("collections_editor_pin_above", {}, "Pin Above Catalogs"))}</strong><small>${escapeHtml(t("collections_editor_pin_above_desc", {}, "Show this collection before standard catalog rows."))}</small></span><label class="desktop-collection-switch"><input type="checkbox" data-field="pinToTop" ${collection.pinToTop ? "checked" : ""}/><span></span></label></div>
          <fieldset class="desktop-collection-segmented"><legend>${escapeHtml(t("collections_editor_view_mode", {}, "View Mode"))}</legend>${["TABBED_GRID", "ROWS", "FOLLOW_LAYOUT"].map((mode) => `<button type="button" data-view-mode="${mode}" class="${collection.viewMode === mode ? "is-selected" : ""}">${labelForMode(mode)}</button>`).join("")}</fieldset>
          <div class="desktop-collection-editor-toggle-row"><span><strong>${escapeHtml(t("collections_editor_show_all_tab", {}, "Show “All” Tab"))}</strong><small>${escapeHtml(t("collections_editor_show_all_tab_hint", {}, "Used in Grid view."))}</small></span><label class="desktop-collection-switch"><input type="checkbox" data-field="showAllTab" ${collection.showAllTab ? "checked" : ""}/><span></span></label></div>
        </section>
        <section class="desktop-collection-editor-section"><div class="desktop-collection-editor-section-heading"><div><h2>${escapeHtml(t("collections_editor_folders", {}, "Folders"))}</h2><p>${escapeHtml(t("collections_editor_folders_hint", {}, "Folders appear in their saved order."))}</p></div><button type="button" data-add-folder>${escapeHtml(t("collections_editor_add_folder", {}, "Add Folder"))}</button></div>
          <div class="desktop-collection-editor-list">${folders.length ? folders.map((folder, index) => `<article class="desktop-collection-editor-row"><button type="button" data-folder-drag="${index}" class="desktop-collection-drag-handle"><span class="material-icons">drag_indicator</span></button><div class="desktop-folder-cover">${folder.coverImageUrl ? `<img src="${escapeHtml(folder.coverImageUrl)}" alt="" />` : escapeHtml(folder.coverEmoji || "□")}</div><div><h3>${escapeHtml(folder.title)}</h3><p>${labelForShape(folder.tileShape)} · ${(() => { const count = getCollectionFolderSources(folder).length; return count === 1 ? t("collections_editor_sources_one", {}, "1 source") : t("collections_editor_sources_many", [count], `${count} sources`); })()}</p></div><div class="desktop-collection-editor-actions"><button type="button" data-edit-folder="${escapeHtml(folder.id)}">${escapeHtml(t("action_edit", {}, "Edit"))}</button><button type="button" data-delete-folder="${escapeHtml(folder.id)}" class="is-danger">${escapeHtml(t("action_delete", {}, "Delete"))}</button></div></article>`).join("") : `<p class="desktop-collection-manager-empty">${escapeHtml(t("collections_editor_folders_empty", {}, "No folders yet. Add one to start grouping sources."))}</p>`}</div>
        </section>
      </main>`;
    bindMobileCollectionHeading(this);
    this.bind(collection);
  },
  bind(collection) {
    this.container
      .querySelector("[data-editor-back]")
      ?.addEventListener("click", () => backToSettings());
    this.container
      .querySelector("[data-editor-mobile-back]")
      ?.addEventListener("click", () => backToSettings());
    let current = collection;
    const update = (patch) => {
      current = { ...current, ...patch };
      saveCollection(current);
      return current;
    };
    this.container.querySelectorAll("[data-field]").forEach((input) => {
      const field = input.dataset.field;
      const listener = () =>
        update({ [field]: input.type === "checkbox" ? input.checked : input.value });
      input.addEventListener(input.type === "checkbox" ? "change" : "change", listener);
    });
    const backdropInput = this.container.querySelector('[data-field="backdropImageUrl"]');
    const backdropPreview = this.container.querySelector("[data-backdrop-preview]");
    if (backdropInput && backdropPreview) bindImagePreview(backdropInput, backdropPreview);
    this.container.querySelectorAll("[data-view-mode]").forEach((button) =>
      button.addEventListener("click", () => {
        update({ viewMode: button.dataset.viewMode });
        void this.render();
      })
    );
    this.container.querySelector("[data-add-folder]")?.addEventListener("click", () => {
      const title = globalThis.prompt?.("Folder name");
      if (!String(title || "").trim()) return;
      const folder = {
        id: CollectionsStore.generateId(),
        title: String(title).trim(),
        tileShape: "SQUARE",
        sources: []
      };
      update({ folders: [...current.folders, folder] });
      void Router.navigate("collectionFolderEdit", {
        collectionId: current.id,
        folderId: folder.id
      });
    });
    this.container
      .querySelectorAll("[data-edit-folder]")
      .forEach((button) =>
        button.addEventListener(
          "click",
          () =>
            void Router.navigate("collectionFolderEdit", {
              collectionId: collection.id,
              folderId: button.dataset.editFolder
            })
        )
      );
    this.container.querySelectorAll("[data-delete-folder]").forEach((button) =>
      button.addEventListener("click", () => {
        const folder = collection.folders.find((item) => item.id === button.dataset.deleteFolder);
        if (
          !folder ||
          !globalThis.confirm?.(
            `${t("collections_editor_delete_folder_title", {}, "Delete Folder?")} ${t(
              "collections_editor_delete_folder_subtitle",
              [folder.title],
              `This will permanently delete "${folder.title}" and its contents.`
            )}`
          )
        )
          return;
        update({ folders: collection.folders.filter((item) => item.id !== folder.id) });
        void this.render();
      })
    );
    this.bindFolderDrag(collection);
  },
  bindFolderDrag(collection) {
    bindListReorderDrag({
      container: this.container,
      handleSelector: "[data-folder-drag]",
      itemSelector: ".desktop-collection-editor-row",
      onMove: (fromIndex, toIndex) => {
        const latest = getCollection(collection.id) || collection;
        const next = [...latest.folders];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        saveCollection({ ...latest, folders: next });
      },
      onDrop: () => this.render()
    });
  }
};

export const CollectionFolderEditorScreen = {
  container: null,
  params: null,
  async mount(params = {}) {
    this.params = params;
    this.container = document.getElementById("collectionFolderEdit");
    if (!Platform.isBrowser()) {
      backToSettings();
      return;
    }
    ScreenUtils.show(this.container);
    await this.render();
  },
  cleanup() {
    this.mobileHeadingCleanup?.();
    this.mobileHeadingCleanup = null;
    ScreenUtils.hide(this.container);
  },
  async render() {
    // A redraw during a drag would destroy the row under the finger.
    if (deferWhileReordering(() => void this.render())) return;
    const collection = getCollection(this.params?.collectionId);
    const folder = collection?.folders?.find(
      (item) => String(item.id) === String(this.params?.folderId)
    );
    if (!collection || !folder) {
      void Router.navigate("collectionEdit", { collectionId: this.params?.collectionId });
      return;
    }
    const sources = getCollectionFolderSources(folder);
    const addons = await addonRepository.getInstalledAddons();
    const catalogOptions = addons
      .flatMap((addon) =>
        (addon.catalogs || []).map((catalog) => ({ addon, catalog, type: catalog?.apiType }))
      )
      .filter(({ catalog, type }) => catalog?.id && type);
    this.container.innerHTML = `<main class="desktop-collection-editor-shell">${renderMobileCollectionHeading({ title: t("collections_editor_edit_folder", {}, "Edit Folder"), subtitle: collection.title, backAttribute: "data-folder-mobile-back" })}<button class="desktop-collection-editor-back" type="button" data-folder-back aria-label="${escapeHtml(t("common.back", {}, "Back"))}">${renderBackButtonIcon()}</button><header class="desktop-collection-editor-header"><p>${escapeHtml(collection.title)}</p><h1>${escapeHtml(t("collections_editor_edit_folder", {}, "Edit Folder"))}</h1></header><section class="desktop-collection-editor-card"><label>${escapeHtml(t("collections_editor_folder_title", {}, "Folder Name"))}<input data-folder-field="title" value="${escapeHtml(folder.title)}" /></label><fieldset class="desktop-collection-segmented"><legend>${escapeHtml(t("collections_editor_cover", {}, "Cover Type"))}</legend><button type="button" data-cover-type="none" class="${!folder.coverImageUrl && !folder.coverEmoji ? "is-selected" : ""}">${escapeHtml(t("collections_editor_cover_none", {}, "None"))}</button><button type="button" data-cover-type="emoji" class="${folder.coverEmoji ? "is-selected" : ""}">${escapeHtml(t("collections_editor_cover_emoji", {}, "Emoji"))}</button><button type="button" data-cover-type="image" class="${folder.coverImageUrl ? "is-selected" : ""}">${escapeHtml(t("collections_editor_cover_image_url", {}, "Image URL"))}</button></fieldset><label data-cover-emoji ${folder.coverEmoji ? "" : "hidden"}>${escapeHtml(t("collections_editor_cover_emoji", {}, "Emoji"))}<input data-folder-field="coverEmoji" value="${escapeHtml(folder.coverEmoji || "")}" /></label><label data-cover-image ${folder.coverImageUrl ? "" : "hidden"}>${escapeHtml(t("collections_editor_cover_image_url", {}, "Image URL"))}<input data-folder-field="coverImageUrl" value="${escapeHtml(folder.coverImageUrl || "")}" placeholder="https://…" /></label><img class="desktop-collection-backdrop-preview" data-cover-preview alt="${escapeHtml(t("collections_editor_cover_preview", {}, "Cover preview"))}" /><label>${escapeHtml(t("collections_editor_gif_url_label", {}, "Animated GIF URL"))}<input data-folder-field="focusGifUrl" value="${escapeHtml(folder.focusGifUrl || "")}" placeholder="https://…" /></label><label class="desktop-collection-editor-toggle-row"><strong>${escapeHtml(t("collections_editor_play_gif", {}, "Show GIF when configured"))}</strong><span class="desktop-collection-switch"><input type="checkbox" role="switch" data-folder-field="focusGifEnabled" ${folder.focusGifEnabled ? "checked" : ""}/><span aria-hidden="true"></span></span></label><fieldset class="desktop-collection-segmented"><legend>${escapeHtml(t("collections_editor_tile_shape", {}, "Tile Shape"))}</legend>${["POSTER", "SQUARE", "LANDSCAPE"].map((shape) => `<button type="button" data-tile-shape="${shape}" class="${folder.tileShape === shape ? "is-selected" : ""}">${labelForShape(shape)}</button>`).join("")}</fieldset><label class="desktop-collection-editor-toggle-row"><strong>${escapeHtml(t("collections_editor_hide_title", {}, "Hide Title"))}</strong><span class="desktop-collection-switch"><input type="checkbox" role="switch" data-folder-field="hideTitle" ${folder.hideTitle ? "checked" : ""}/><span aria-hidden="true"></span></span></label></section><section class="desktop-collection-editor-section"><div class="desktop-collection-editor-section-heading"><div><h2>${escapeHtml(t("collections_editor_sources_heading", {}, "Catalog Sources"))}</h2><p>${escapeHtml(t("collections_editor_sources_hint", {}, "Saved source order controls the folder tabs and rows."))}</p></div></div><div class="desktop-collection-source-add"><select data-source-kind><option value="addon">${escapeHtml(t("collections_editor_source_kind_addon", {}, "Addon catalog"))}</option><option value="tmdb">${escapeHtml(t("collections_editor_tmdb_default_discover", {}, "TMDB discover"))}</option><option value="trakt">${escapeHtml(t("collections_editor_trakt_list", {}, "Trakt list"))}</option></select><select data-addon-source aria-label="${escapeHtml(t("collections_editor_source_kind_addon", {}, "Addon catalog"))}" ${catalogOptions.length ? "" : "disabled"}>${catalogOptions.map(({ addon, catalog, type }, index) => `<option value="${index}">${escapeHtml([catalog.name || catalog.id, type, addon.displayName || addon.name].filter(Boolean).join(" · "))}</option>`).join("") || `<option value="">${escapeHtml(t("collections_editor_no_catalogs", {}, "No enabled addon catalogs"))}</option>`}</select><select data-tmdb-type hidden><option value="POPULAR">${escapeHtml(t("tmdb_entity_rail_popular", {}, "Popular"))}</option><option value="TOP_RATED">${escapeHtml(t("tmdb_entity_rail_top_rated", {}, "Top Rated"))}</option><option value="UPCOMING">${escapeHtml(t("collections_editor_source_tmdb_upcoming", {}, "Upcoming"))}</option></select><select data-tmdb-media hidden><option value="MOVIE">${escapeHtml(t("type_movie", {}, "Movies"))}</option><option value="TV">${escapeHtml(t("type_series", {}, "Series"))}</option></select><input data-tmdb-genre hidden placeholder="${escapeHtml(t("collections_editor_genre_placeholder", {}, "Genre filter (optional)"))}" /><input data-trakt-list hidden type="number" min="1" placeholder="${escapeHtml(t("collections_editor_trakt_list_id_hint", {}, "Trakt list ID"))}" /><button type="button" data-add-source>${escapeHtml(t("collections_editor_add_source", {}, "Add Source"))}</button></div><div class="desktop-collection-editor-list">${sources.length ? sources.map((source, index) => `<article class="desktop-collection-editor-row"><button type="button" class="desktop-collection-drag-handle" data-source-drag="${index}"><span class="material-icons">drag_indicator</span></button><div><h3>${escapeHtml(sourceLabel(source))}</h3><p>${escapeHtml(source.mediaType || source.type || t("type_movie", {}, "Movie"))}${source.genre ? ` · ${escapeHtml(source.genre)}` : ""}</p></div><div class="desktop-collection-editor-actions"><button type="button" data-remove-source="${index}" class="is-danger">${escapeHtml(t("action_remove", {}, "Remove"))}</button></div></article>`).join("") : `<p class="desktop-collection-manager-empty">${escapeHtml(t("collections_editor_sources_empty", {}, "No catalog sources yet."))}</p>`}</div></section></main>`;
    bindMobileCollectionHeading(this);
    this.bind(collection, folder, catalogOptions);
  },
  bind(collection, folder, catalogOptions) {
    let currentCollection = collection;
    let currentFolder = folder;
    const updateFolder = (patch) => {
      currentFolder = { ...currentFolder, ...patch };
      currentCollection = {
        ...currentCollection,
        folders: currentCollection.folders.map((item) =>
          item.id === currentFolder.id ? currentFolder : item
        )
      };
      saveCollection(currentCollection);
      return currentFolder;
    };
    this.container
      .querySelector("[data-folder-back]")
      ?.addEventListener(
        "click",
        () => void Router.navigate("collectionEdit", { collectionId: collection.id })
      );
    this.container
      .querySelector("[data-folder-mobile-back]")
      ?.addEventListener(
        "click",
        () => void Router.navigate("collectionEdit", { collectionId: collection.id })
      );
    this.container
      .querySelectorAll("[data-folder-field]")
      .forEach((input) =>
        input.addEventListener(input.type === "checkbox" ? "change" : "change", () =>
          updateFolder({
            [input.dataset.folderField]: input.type === "checkbox" ? input.checked : input.value
          })
        )
      );
    const coverInput = this.container.querySelector('[data-folder-field="coverImageUrl"]');
    const preview = this.container.querySelector("[data-cover-preview]");
    if (coverInput && preview) bindImagePreview(coverInput, preview);
    this.container.querySelectorAll("[data-cover-type]").forEach((button) =>
      button.addEventListener("click", () => {
        const type = button.dataset.coverType;
        updateFolder(
          type === "emoji"
            ? { coverImageUrl: null }
            : type === "image"
              ? { coverEmoji: null }
              : { coverImageUrl: null, coverEmoji: null }
        );
        void this.render();
      })
    );
    this.container.querySelectorAll("[data-tile-shape]").forEach((button) =>
      button.addEventListener("click", () => {
        updateFolder({ tileShape: button.dataset.tileShape });
        void this.render();
      })
    );
    const sourceKind = this.container.querySelector("[data-source-kind]");
    const addonSource = this.container.querySelector("[data-addon-source]");
    const addSource = this.container.querySelector("[data-add-source]");
    const updateSourceFields = () => {
      const kind = sourceKind.value;
      addonSource.hidden = kind !== "addon";
      addSource.disabled = kind === "addon" && !catalogOptions.length;
      this.container
        .querySelectorAll("[data-tmdb-type], [data-tmdb-media], [data-tmdb-genre]")
        .forEach((node) => {
          node.hidden = kind !== "tmdb";
        });
      this.container.querySelector("[data-trakt-list]").hidden = kind !== "trakt";
    };
    sourceKind?.addEventListener("change", updateSourceFields);
    updateSourceFields();
    addSource.addEventListener("click", () => {
      const kind = sourceKind.value;
      let source = null;
      if (kind === "addon") {
        const entry = catalogOptions[addonSource.value];
        if (entry)
          source = {
            provider: "addon",
            addonId: entry.addon.baseUrl || entry.addon.id,
            addonBaseUrl: entry.addon.baseUrl || null,
            addonName: entry.addon.displayName || entry.addon.name,
            type: entry.type,
            catalogId: entry.catalog.id,
            catalogName: entry.catalog.name || entry.catalog.id
          };
      }
      if (kind === "tmdb") {
        const type = this.container.querySelector("[data-tmdb-type]").value;
        const mediaType = this.container.querySelector("[data-tmdb-media]").value;
        const genre = String(this.container.querySelector("[data-tmdb-genre]").value || "").trim();
        source = {
          provider: "tmdb",
          tmdbSourceType: type,
          title: `${type.replaceAll("_", " ")} ${mediaType === "TV" ? "Series" : "Movies"}`,
          mediaType,
          filters: genre ? { withGenres: genre } : {}
        };
      }
      if (kind === "trakt") {
        const listId = Number(this.container.querySelector("[data-trakt-list]").value);
        if (Number.isFinite(listId) && listId > 0)
          source = {
            provider: "trakt",
            traktListId: listId,
            title: t("collections_editor_trakt_list_with_id", [listId], `List ${listId}`),
            mediaType: "MOVIE"
          };
      }
      if (source) {
        updateFolder({ sources: [...getCollectionFolderSources(currentFolder), source] });
        void this.render();
      }
    });
    this.container.querySelectorAll("[data-remove-source]").forEach((button) =>
      button.addEventListener("click", () => {
        const sources = getCollectionFolderSources(currentFolder);
        const source = sources[Number(button.dataset.removeSource)];
        if (
          !source ||
          !globalThis.confirm?.(
            t("collections_editor_remove_source_confirm", [sourceLabel(source)], `Remove ${sourceLabel(source)}?`)
          )
        )
          return;
        sources.splice(Number(button.dataset.removeSource), 1);
        updateFolder({ sources });
        void this.render();
      })
    );
    this.bindSourceDrag(collection, folder);
  },
  bindSourceDrag(collection, folder) {
    bindListReorderDrag({
      container: this.container,
      handleSelector: "[data-source-drag]",
      itemSelector: ".desktop-collection-editor-row",
      onMove: (fromIndex, toIndex) => {
        const latestCollection = getCollection(collection.id) || collection;
        const latestFolder =
          latestCollection.folders.find((item) => item.id === folder.id) || folder;
        const next = getCollectionFolderSources(latestFolder);
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        saveCollection({
          ...latestCollection,
          folders: latestCollection.folders.map((item) =>
            item.id === folder.id ? { ...latestFolder, sources: next } : item
          )
        });
      },
      onDrop: () => this.render()
    });
  }
};
