import assert from "node:assert/strict";
import test from "node:test";

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {}
};

const { hasCloudLibraryConfiguration, mediaServerSources, mediaServerCloudItem } =
  await import("./cloudLibraryRepository.js");

const server = { id: "media:one", name: "Living Room", url: "https://jellyfin.test" };

const libraries = {
  "media:one": [
    { id: "movies", name: "Movies", kind: "movie" },
    { id: "shows", name: "Shows", kind: "series" },
    { id: "boxsets", name: "Collections", kind: "collection" }
  ],
  "media:two": [{ id: "anime", name: "Anime", kind: "series" }]
};

test("servers expose their selected libraries as picker options", () => {
  const sources = mediaServerSources(
    [
      { id: "media:one", name: "Living Room", enabled: true },
      { id: "media:two", name: "Bedroom", enabled: true },
      { id: "media:three", name: "Off", enabled: false }
    ],
    libraries
  );
  assert.deepEqual(sources, [
    {
      id: "media:one",
      name: "Living Room",
      libraries: [
        { id: "movies", name: "Movies", kind: "movie" },
        { id: "shows", name: "Shows", kind: "series" }
      ]
    },
    {
      id: "media:two",
      name: "Bedroom",
      libraries: [{ id: "anime", name: "Anime", kind: "series" }]
    }
  ]);
});

test("a saved library selection narrows the picker options", () => {
  const [source] = mediaServerSources(
    [{ id: "media:one", name: "Living Room", enabled: true, libraryIds: ["shows"] }],
    libraries
  );
  assert.deepEqual(
    source.libraries.map(({ id }) => id),
    ["shows"]
  );
});

test("a movie row keeps its cover, library and kind", () => {
  const item = mediaServerCloudItem(
    server,
    { id: "movies", name: "Movies" },
    {
      Id: "m1",
      Type: "Movie",
      Name: "Arrival",
      ImageTags: { Primary: "tag-m1" },
      UserData: { PlayedPercentage: 25, PlaybackPositionTicks: 5000000 }
    }
  );
  assert.equal(item.libraryId, "movies");
  assert.equal(item.kind, "movie");
  assert.equal(item.name, "Arrival");
  assert.equal(item.poster, "https://jellyfin.test/Items/m1/Images/Primary?tag=tag-m1");
  assert.equal(item.progressFraction, 0.25);
  assert.equal(item.resumePositionMs, 500);
});

test("an episode without art borrows the series poster", () => {
  const item = mediaServerCloudItem(
    server,
    { id: "shows", name: "Shows" },
    {
      Id: "e1",
      Type: "Episode",
      Name: "Pilot",
      SeriesName: "Severance",
      SeriesId: "s1",
      SeriesPrimaryImageTag: "tag-s1"
    }
  );
  assert.equal(item.kind, "series");
  assert.equal(item.name, "Severance – Pilot");
  assert.equal(item.poster, "https://jellyfin.test/Items/s1/Images/Primary?tag=tag-s1");
});

test("an item without artwork keeps no poster instead of inventing one", () => {
  const item = mediaServerCloudItem(
    server,
    { id: "movies", name: "Movies" },
    {
      Id: "x",
      Type: "Video",
      Name: "Clip"
    }
  );
  assert.equal(item.poster, null);
});

test("the Cloud tab only exists when a debrid cloud library is configured", () => {
  assert.equal(
    hasCloudLibraryConfiguration({ cloudLibraryEnabled: false, torboxApiKey: "x" }),
    false
  );
  assert.equal(hasCloudLibraryConfiguration({ cloudLibraryEnabled: true }), false);
  assert.equal(
    hasCloudLibraryConfiguration({ cloudLibraryEnabled: true, torboxApiKey: "x" }),
    true
  );
});
