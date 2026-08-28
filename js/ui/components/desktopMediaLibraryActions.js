import {
  libraryRepository,
  LibrarySourceMode
} from "../../data/repository/libraryRepository.js";
import { TraktSettingsStore } from "../../data/local/traktSettingsStore.js";
import { NuvioDialog } from "./nuvioDialog.js";

function membershipKeyForSource(sourceMode) {
  if (sourceMode === LibrarySourceMode.SIMKL) return "simkl:status:plantowatch";
  if (sourceMode === LibrarySourceMode.TRAKT) return "watchlist";
  return "local";
}

function toLibraryItem(item = {}) {
  return {
    itemId: item.id,
    itemType: item.type || item.apiType || "movie",
    title: item.name || item.title || item.id || "Untitled",
    poster: item.poster || null,
    background: item.background || item.backdrop || null,
    description: item.description || item.overview || "",
    releaseInfo: item.releaseInfo || item.year || "",
    imdbRating: item.imdbRating == null ? null : Number(item.imdbRating),
    genres: Array.isArray(item.genres) ? item.genres : []
  };
}

export async function getDesktopMediaLibraryMembership(item) {
  const sourceMode = await libraryRepository.getSourceMode().catch(() => LibrarySourceMode.LOCAL);
  const snapshot = await libraryRepository
    .getMembershipSnapshot(toLibraryItem(item), { sourceMode })
    .catch(() => ({ listMembership: {} }));
  return {
    sourceMode,
    isSaved: Boolean(snapshot?.listMembership?.[membershipKeyForSource(sourceMode)])
  };
}

export async function toggleDesktopMediaLibraryMembership(item) {
  const libraryItem = toLibraryItem(item);
  const { sourceMode, isSaved } = await getDesktopMediaLibraryMembership(item);
  await libraryRepository.applyMembershipChanges(
    libraryItem,
    { desiredMembership: { [membershipKeyForSource(sourceMode)]: !isSaved } },
    { sourceMode }
  );
}

export async function openDesktopMediaLibraryDestinationMenu(item, refresh) {
  const libraryItem = toLibraryItem(item);
  const sourceModes = await libraryRepository
    .getAvailableSourceModes()
    .catch(() => [LibrarySourceMode.LOCAL]);
  const entries = await Promise.all(sourceModes.map(async (sourceMode) => {
    const tabs = sourceMode === LibrarySourceMode.LOCAL
      ? [{ key: "local", title: "Library" }]
      : await libraryRepository.getListTabs({ sourceMode }).catch(() => []);
    const snapshot = await libraryRepository
      .getMembershipSnapshot(libraryItem, { sourceMode })
      .catch(() => ({ listMembership: {} }));
    return {
      sourceMode,
      tabs: tabs.filter((tab) => tab.isMembershipDestination !== false),
      membership: snapshot.listMembership || {}
    };
  }));
  const dialog = new NuvioDialog({
    title: "Add to Library",
    subtitle: "Choose a destination for this item",
    widthVw: 32,
    panelClassName: "desktop-library-destination-dialog",
    actionsClassName: "desktop-library-destination-actions",
    buttons: entries.flatMap((entry) => entry.tabs.map((tab, index) => ({
      key: `${entry.sourceMode}:${tab.key}`,
      label: tab.title || tab.key,
      selected: Boolean(entry.membership[tab.key]),
      className: `desktop-library-destination-button desktop-library-destination-source-${entry.sourceMode}${index === 0 ? " is-provider-start" : ""}`,
      onAction: async () => {
        const desiredMembership = entry.sourceMode === LibrarySourceMode.SIMKL
          ? Object.fromEntries(entry.tabs.map((candidate) => [candidate.key, candidate.key === tab.key ? !entry.membership[tab.key] : false]))
          : { ...entry.membership, [tab.key]: !entry.membership[tab.key] };
        await libraryRepository.applyMembershipChanges(libraryItem, { desiredMembership }, { sourceMode: entry.sourceMode });
        dialog.destroy();
        await refresh?.();
      }
    })))
  }).mount(document.body);
  return Boolean(dialog);
}

export function subscribeDesktopMediaLibrarySource(listener) {
  return TraktSettingsStore.subscribeLibrarySource(listener);
}
