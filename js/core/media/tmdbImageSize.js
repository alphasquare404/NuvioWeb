/**
 * Caps the size of a TMDB image URL.
 *
 * TMDB serves `/t/p/original/` as the file somebody uploaded, and nothing says
 * how big that is. A logo measured on a phone came back 14481x3568: 197MB once
 * the browser decoded it, to be drawn 440px wide. Decoded images are four bytes
 * a pixel however small the file was, so a handful of those is more memory than
 * an installed web app is given, and the process is killed -- which is what an
 * iPhone was doing every time the hero rotated to that title.
 *
 * Addons hand us whatever URL they like, so the cap belongs here, on the way
 * into the page, rather than in a request to anyone.
 */
const SIZE_BY_ROLE = {
  // Drawn at most a few hundred points wide, on a screen that may have three
  // device pixels to the point.
  logo: "w780",
  // Poster and landscape cards.
  poster: "w500",
  // Artwork behind anything that is not the hero.
  backdrop: "w1280",
  // The hero and the detail page draw one picture across the whole screen,
  // and a phone crops a wide one to upright -- so a 1280 backdrop arrives as
  // about 500 real pixels stretched over 1125. These two are the only places
  // a single image is worth its full size; the cap that matters, the one on
  // logos, is untouched.
  heroPoster: "w780",
  // The title logo over the hero. TMDB's own enrichment hands these out at
  // w300, which is half what the detail page draws -- and it arrived second,
  // replacing a sharper one.
  heroLogo: "w780"
};

// A wide screen shows the whole frame and has the memory for it. A phone
// crops it, and is the device that gets killed for memory: a TMDB original
// can be 3840 across, which is 33MB once decoded, where 1280 is 3.7MB. The
// upright plate above is what a phone gets instead, and it is not cropped.
function heroBackdropSize() {
  return Number(globalThis.innerWidth) >= 1024 ? "original" : "w1280";
}

// The hero asks for a size; everything else asks for a ceiling.
//
// A card is handed whatever the add-on chose and only shrinks when that is
// wasteful. The hero and the detail page fill a screen with one picture, and
// they are written to repeatedly -- the add-on's artwork, then TMDB's, then
// TMDB's again through another field. Each of those arrives at whatever size
// its source happened to name, so a ceiling alone let a w1280 land on top of
// an original and the picture visibly got worse while you watched it.
const SIZED_ROLES = new Set(["heroBackdrop", "heroPoster", "heroLogo"]);

// Metahub is what Cinemeta hands out, and it names the small one by default:
// background/medium is 1280x720 where background/large is 1920x1080, and
// poster/small is 300x450 where poster/large is 780x1169. Same picture, same
// URL but for one word.
const METAHUB_PATH =
  /^(https?:\/\/[^/]*metahub\.space\/)(background|poster)\/(small|medium|large)(\/.+)$/i;

const TMDB_PATH = /^(https?:\/\/image\.tmdb\.org\/t\/p\/)([^/]+)(\/.+)$/i;

function widthOf(size) {
  const match = /^w(\d+)$/i.exec(String(size || ""));
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

/**
 * @param {string} url an image URL, TMDB or otherwise
 * @param {"logo"|"poster"|"backdrop"|"heroBackdrop"|"heroPoster"|"heroLogo"} role what it will be drawn as
 * @returns {string} the URL, sized for that role where the host publishes sizes
 */
export function capTmdbImageSize(url, role = "poster") {
  const value = String(url || "");
  const metahub = METAHUB_PATH.exec(value);
  if (metahub) {
    if (role !== "heroBackdrop" && role !== "heroPoster") {
      return value;
    }
    const [, prefix, kind, , tail] = metahub;
    return `${prefix}${kind}/large${tail}`;
  }
  const match = TMDB_PATH.exec(value);
  if (!match) {
    return value;
  }
  const target =
    role === "heroBackdrop" ? heroBackdropSize() : SIZE_BY_ROLE[role] || SIZE_BY_ROLE.poster;
  const [, prefix, size, tail] = match;
  // Anything already smaller is left alone, unless this is a role that names
  // its size rather than its ceiling.
  if (widthOf(size) <= widthOf(target) && !SIZED_ROLES.has(role)) {
    return value;
  }
  if (size === target) {
    return value;
  }
  return `${prefix}${target}${tail}`;
}
