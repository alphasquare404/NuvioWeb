/**
 * The one name a subtitle is known by.
 *
 * Four places used to answer this, each with a shorter fallback chain than the
 * one before: the picker read fileName, filename, name and id; the repository
 * dropped id; the download descriptor dropped name as well; and the stored
 * offline record kept only the first two. The name did not fail to travel -- it
 * was trimmed at every handover until nothing was left, which is why nine
 * downloaded English subtitles for one episode all read identically in the
 * player's track list.
 *
 * `id` is included because addons routinely put the release there and nowhere
 * else, and because it is what the picker already showed when the subtitle was
 * chosen -- naming it differently afterwards is what made a downloaded track
 * impossible to recognise.
 */
export function subtitleReleaseName(subtitle = {}) {
  const candidate =
    subtitle?.fileName ?? subtitle?.filename ?? subtitle?.name ?? subtitle?.id ?? "";
  return String(candidate ?? "").trim();
}
export function createSubtitle({ id, url, lang, addonName = null, addonLogo = null }) {
  return {
    id,
    url,
    lang,
    addonName,
    addonLogo
  };
}
