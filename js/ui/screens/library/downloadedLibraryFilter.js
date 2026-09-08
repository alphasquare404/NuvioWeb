export const DOWNLOADED_LIBRARY_TYPE_OPTIONS = Object.freeze([
  { value: "all", label: "All" },
  { value: "movies", label: "Movies" },
  { value: "series", label: "Series" }
]);

export function normalizeDownloadedLibraryType(value) {
  return DOWNLOADED_LIBRARY_TYPE_OPTIONS.some((option) => option.value === value)
    ? value
    : "all";
}

export function filterDownloadedLibraryItems(type, movies = [], series = []) {
  switch (normalizeDownloadedLibraryType(type)) {
    case "movies":
      return movies;
    case "series":
      return series;
    default:
      return [...movies, ...series];
  }
}
