import { LocalStore } from "../../core/storage/localStore.js";

/**
 * What TMDB answered about a title's textless artwork, remembered between runs.
 *
 * The plates are not in the addon's data -- they take a TMDB id lookup and an
 * images request to find -- so without this the hero paints the wide artwork
 * first and swaps when the answer arrives, every single time the app is opened.
 * Remembered, that swap happens once per title in a fortnight instead.
 *
 * Deliberately a cache and not a store: it holds answers that can be fetched
 * again, it expires, it is capped, and the person can throw it away. Nothing
 * depends on it being there.
 */
const KEY = "heroArtworkCache";
const VERSION = 1;
// A fortnight. Artwork does change -- that 14481px logo was itself replaced
// at some point -- and a cache nobody ever revisits is a cache that is wrong.
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
// Roughly a hundred titles of hero rotation, at a couple of hundred bytes
// each. Enough that a regular viewer never waits twice; small enough that a
// year of use costs a fraction of what the watched list already does.
const MAX_ENTRIES = 240;

function readStored() {
  const stored = LocalStore.get(KEY, null);
  if (!stored || typeof stored !== "object" || stored.version !== VERSION) {
    return { seq: 0, items: {} };
  }
  return {
    seq: Number(stored.seq || 0) || 0,
    items: stored.items && typeof stored.items === "object" ? stored.items : {}
  };
}

function readRaw() {
  return readStored().items;
}

function writeRaw(items, seq) {
  LocalStore.set(KEY, { version: VERSION, seq, items });
}

function isFresh(entry, now) {
  return Boolean(entry) && now - Number(entry.t || 0) < MAX_AGE_MS;
}

/**
 * @returns {{poster: string, backdrop: string} | null} null when this title has
 * never been asked about, or the answer has expired. An entry with two empty
 * strings is a remembered "there is none", which is just as useful.
 */
export function readHeroArtwork(key) {
  if (!key) {
    return null;
  }
  const entry = readRaw()[key];
  if (!isFresh(entry, Date.now())) {
    return null;
  }
  return { poster: String(entry.p || ""), backdrop: String(entry.b || "") };
}

export function rememberHeroArtwork(key, { poster = "", backdrop = "" } = {}) {
  if (!key) {
    return;
  }
  const now = Date.now();
  const { seq, items } = readStored();
  // A counter, not the clock: a run that fills the cache writes many entries
  // inside the same millisecond, and sorting those by time keeps whichever
  // the object happened to list first -- which is the oldest. The counter
  // gives every write an order of its own.
  const nextSeq = seq + 1;
  items[key] = { p: String(poster || ""), b: String(backdrop || ""), t: now, s: nextSeq };

  // Pruned on the way in rather than on a timer: this is the only moment the
  // cache grows, so it is the only moment it can outgrow its limits.
  const live = Object.entries(items).filter(([, entry]) => isFresh(entry, now));
  live.sort((a, b) => Number(b[1].s || 0) - Number(a[1].s || 0));
  writeRaw(Object.fromEntries(live.slice(0, MAX_ENTRIES)), nextSeq);
}

export function clearHeroArtworkCache() {
  LocalStore.remove(KEY);
}

/**
 * For the row in Settings that offers to clear it: how much is in there, and
 * roughly how much room it takes.
 */
export function describeHeroArtworkCache() {
  const items = readRaw();
  const entries = Object.keys(items).length;
  if (!entries) {
    return { entries: 0, bytes: 0 };
  }
  // The stored string is the honest measure, headers and all.
  const bytes = JSON.stringify({ version: VERSION, seq: readStored().seq, items }).length;
  return { entries, bytes };
}
