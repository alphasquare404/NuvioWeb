import assert from "node:assert/strict";
import test from "node:test";

globalThis.__NUVIO_PLATFORM__ = "browser";
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
};

const { libraryRepository, LibrarySourceMode } = await import(
  "../../../data/repository/libraryRepository.js"
);
const { watchedItemsRepository } = await import("../../../data/repository/watchedItemsRepository.js");
const { LibraryController, LIBRARY_PRESENTATION_MODE, LIBRARY_VIEW_MODE } = await import(
  "./libraryController.js"
);

async function withLibraryFixture(fixture, run) {
  const originals = {
    getSourceMode: libraryRepository.getSourceMode,
    getListTabs: libraryRepository.getListTabs,
    getItems: libraryRepository.getItems,
    hydrateItems: libraryRepository.hydrateItems,
    getWatchedItems: watchedItemsRepository.getAll
  };
  libraryRepository.getSourceMode = async () => fixture.sourceMode;
  libraryRepository.getListTabs = async () => fixture.listTabs || [];
  libraryRepository.getItems = async () => fixture.items || [];
  libraryRepository.hydrateItems = fixture.hydrateItems || (async (items) => items);
  watchedItemsRepository.getAll = async () => [];
  try {
    await run();
  } finally {
    libraryRepository.getSourceMode = originals.getSourceMode;
    libraryRepository.getListTabs = originals.getListTabs;
    libraryRepository.getItems = originals.getItems;
    libraryRepository.hydrateItems = originals.hydrateItems;
    watchedItemsRepository.getAll = originals.getWatchedItems;
  }
}

test("LibraryController captures and hydrates serializable route-level selections", () => {
  const controller = new LibraryController();
  try {
    const restored = controller.hydrateFromRouteState({
      viewMode: LIBRARY_VIEW_MODE.CLOUD,
      presentationMode: LIBRARY_PRESENTATION_MODE.GROUPED,
      sourceMode: "simkl",
      selectedListKey: "watching",
      selectedTypeKey: "series",
      selectedGenre: "drama",
      selectedYear: "2024",
      selectedSortKey: "title_asc",
      selectedCloudProviderId: "provider-a",
      selectedCloudType: "video",
      cloudSearchQuery: "moana"
    });
    assert.equal(restored, true);
    assert.deepEqual(controller.captureRouteState(), {
      viewMode: LIBRARY_VIEW_MODE.CLOUD,
      presentationMode: LIBRARY_PRESENTATION_MODE.GROUPED,
      sourceMode: "local",
      selectedListKey: "watching",
      selectedTypeKey: "series",
      selectedGenre: "drama",
      selectedYear: "2024",
      selectedSortKey: "title_asc",
      selectedCloudProviderId: "provider-a",
      selectedCloudType: "video",
      cloudSearchQuery: "moana"
    });
  } finally {
    controller.dispose();
  }
});

test("LibraryController safely normalizes malformed route state", () => {
  const controller = new LibraryController();
  try {
    assert.equal(controller.hydrateFromRouteState(null), false);
    assert.equal(controller.hydrateFromRouteState({
      viewMode: "unexpected",
      presentationMode: "unexpected",
      selectedTypeKey: "",
      selectedSortKey: ""
    }), true);
    const state = controller.captureRouteState();
    assert.equal(state.viewMode, LIBRARY_VIEW_MODE.SAVED);
    assert.equal(state.presentationMode, LIBRARY_PRESENTATION_MODE.FLAT);
    assert.equal(state.selectedTypeKey, "__all__");
    assert.equal(state.selectedSortKey, "added_desc");
  } finally {
    controller.dispose();
  }
});

test("LibraryController applies a restored logical state only after its first loaded options exist", async () => {
  await withLibraryFixture(
    {
      sourceMode: LibrarySourceMode.TRAKT,
      listTabs: [
        { key: "watchlist", title: "Watchlist", type: "watchlist" },
        { key: "favorites", title: "Favorites", type: "personal" }
      ],
      items: [
        {
          id: "movie-1",
          itemId: "movie-1",
          type: "movie",
          title: "Example",
          year: 2024,
          genres: ["Drama"],
          listKeys: ["favorites"]
        }
      ]
    },
    async () => {
      const controller = new LibraryController();
      try {
        controller.hydrateFromRouteState({
          viewMode: LIBRARY_VIEW_MODE.SAVED,
          presentationMode: LIBRARY_PRESENTATION_MODE.GROUPED,
          selectedListKey: "favorites",
          selectedTypeKey: "movie",
          selectedGenre: "Drama",
          selectedYear: "2024",
          selectedSortKey: "title_asc"
        });
        await controller.init();
        assert.deepEqual(controller.captureRouteState(), {
          viewMode: LIBRARY_VIEW_MODE.SAVED,
          presentationMode: LIBRARY_PRESENTATION_MODE.GROUPED,
          sourceMode: LibrarySourceMode.TRAKT,
          selectedListKey: "favorites",
          selectedTypeKey: "movie",
          selectedGenre: "Drama",
          selectedYear: "2024",
          selectedSortKey: "title_asc",
          selectedCloudProviderId: null,
          selectedCloudType: null,
          cloudSearchQuery: ""
        });
      } finally {
        controller.dispose();
      }
    }
  );
});

test("LibraryController falls back safely when restored loaded-state selections are no longer available", async () => {
  await withLibraryFixture(
    {
      sourceMode: LibrarySourceMode.TRAKT,
      listTabs: [{ key: "watchlist", title: "Watchlist", type: "watchlist" }],
      items: [{ id: "movie-1", itemId: "movie-1", type: "movie", title: "Example", year: 2024 }]
    },
    async () => {
      const controller = new LibraryController();
      try {
        controller.hydrateFromRouteState({
          selectedListKey: "removed-list",
          selectedTypeKey: "missing-type",
          selectedGenre: "Missing",
          selectedYear: "1999",
          selectedSortKey: "missing-sort"
        });
        await controller.init();
        const state = controller.captureRouteState();
        assert.equal(state.selectedListKey, "watchlist");
        assert.equal(state.selectedTypeKey, "__all__");
        assert.equal(state.selectedGenre, null);
        assert.equal(state.selectedYear, null);
        assert.equal(state.selectedSortKey, "default");
      } finally {
        controller.dispose();
      }
    }
  );
});

test("LibraryController validates restored genre and year after metadata hydration supplies their options", async () => {
  const rawItems = [
    { id: "movie-1", itemId: "movie-1", type: "movie", title: "Example", listKeys: ["watchlist"] }
  ];
  const enrichedItems = [
    {
      ...rawItems[0],
      genres: ["Action"],
      year: 2024,
      releaseInfo: "2024",
      imdbRating: 8
    }
  ];
  await withLibraryFixture(
    {
      sourceMode: LibrarySourceMode.TRAKT,
      listTabs: [{ key: "watchlist", title: "Watchlist", type: "watchlist" }],
      items: rawItems,
      hydrateItems: async (items, { onBatch }) => {
        onBatch?.(enrichedItems);
        return enrichedItems;
      }
    },
    async () => {
      const controller = new LibraryController();
      try {
        controller.hydrateFromRouteState({
          selectedTypeKey: "movie",
          selectedGenre: "Action",
          selectedYear: "2024",
          selectedSortKey: "title_asc"
        });
        await controller.init();
        await Promise.resolve();
        await Promise.resolve();
        const state = controller.captureRouteState();
        assert.equal(state.selectedTypeKey, "movie");
        assert.equal(state.selectedGenre, "Action");
        assert.equal(state.selectedYear, "2024");
        assert.equal(state.selectedSortKey, "title_asc");
      } finally {
        controller.dispose();
      }
    }
  );
});
