const TMDB_POSTER_BASE_URL = "https://image.tmdb.org/t/p/w342";

function normalizeMediaType(value) {
  return String(value || "").toLowerCase() === "tv" ? "series" : "movie";
}

function dateForCredit(credit = {}) {
  return String(credit?.release_date || credit?.first_air_date || "").trim();
}

function posterUrl(path) {
  const value = String(path || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return value.startsWith("/") ? `${TMDB_POSTER_BASE_URL}${value}` : value;
}

function mergeCredit(current, candidate) {
  if (!current) return candidate;
  const roles = [...new Set([...(current.roles || []), ...(candidate.roles || [])].filter(Boolean))];
  const preferCandidate =
    (candidate.kind === "cast" && current.kind !== "cast") ||
    (!current.poster && Boolean(candidate.poster));
  const preferred = preferCandidate ? candidate : current;
  return { ...preferred, roles, role: preferred.role || roles[0] || "" };
}

export function normalizePersonCredits(combinedCredits = {}) {
  const entries = [];
  const add = (credit, kind) => {
    const rawType = String(credit?.media_type || "").toLowerCase();
    const id = Number(credit?.id);
    const title = String(credit?.title || credit?.name || "").trim();
    if (!Number.isFinite(id) || id <= 0 || !title || !["movie", "tv"].includes(rawType)) return;
    const role = String(kind === "cast" ? credit?.character || "" : credit?.job || credit?.department || "").trim();
    entries.push({
      key: `${rawType}:${id}`, tmdbId: String(id), itemId: `tmdb:${id}`, type: normalizeMediaType(rawType),
      title, poster: posterUrl(credit?.poster_path), releaseDate: dateForCredit(credit),
      popularity: Number(credit?.popularity || 0), voteCount: Number(credit?.vote_count || 0),
      rating: Number(credit?.vote_average || 0), kind, role, roles: role ? [role] : []
    });
  };
  (Array.isArray(combinedCredits?.cast) ? combinedCredits.cast : []).forEach((credit) => add(credit, "cast"));
  (Array.isArray(combinedCredits?.crew) ? combinedCredits.crew : []).forEach((credit) => add(credit, "crew"));
  const byIdentity = new Map();
  entries.forEach((entry) => byIdentity.set(entry.key, mergeCredit(byIdentity.get(entry.key), entry)));
  return [...byIdentity.values()];
}

export function sortPersonCreditsByPopularity(credits = []) {
  return [...credits].sort((left, right) => right.popularity - left.popularity || right.voteCount - left.voteCount || right.rating - left.rating || String(right.releaseDate).localeCompare(String(left.releaseDate)));
}

export function sortPersonCreditsByLatest(credits = [], today = new Date().toISOString().slice(0, 10)) {
  return [...credits].filter((credit) => credit.releaseDate && credit.releaseDate <= today).sort((left, right) => String(right.releaseDate).localeCompare(String(left.releaseDate)) || right.popularity - left.popularity);
}

export function calculatePersonAge(birthday = "", deathday = "", now = new Date()) {
  const birth = new Date(`${String(birthday || "").trim()}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const end = deathday ? new Date(`${String(deathday).trim()}T00:00:00`) : now;
  if (Number.isNaN(end.getTime()) || end < birth) return null;
  let age = end.getFullYear() - birth.getFullYear();
  if (end.getMonth() < birth.getMonth() || (end.getMonth() === birth.getMonth() && end.getDate() < birth.getDate())) age -= 1;
  return age >= 0 ? age : null;
}
