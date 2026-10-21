// Opening an MKV inside the app without a second engine.
//
// Measured, not assumed: the same frames that stutter inside a canvas player play
// smoothly — and seek — once they are delivered as an MP4 to the ordinary player.
// So the container is rewritten, not the engine: when a deployment configures a
// remux endpoint, an MKV source becomes a request for that endpoint.
//
// Off by default. Without REMUX_ENDPOINT nothing here changes behaviour, which is
// the same rule the IntroDB relay follows.

const MKV_PATH = /\.mkv$/i;

export function isRemuxEndpointConfigured(endpoint) {
  return String(endpoint || "").trim().length > 0;
}

/**
 * Should this source be handed to the remux endpoint?
 *
 * Only when the endpoint exists, the source is something the server can fetch, and
 * the path really ends in .mkv — a query string may follow it, and asking twice
 * would nest the wrapper inside itself.
 */
export function shouldRemuxSource(url, endpoint = "") {
  if (!isRemuxEndpointConfigured(endpoint)) return false;
  const value = String(url || "").trim();
  if (!/^https?:\/\//i.test(value)) return false;
  if (value.startsWith(String(endpoint).trim())) return false;
  const [withoutQuery] = value.split(/[?#]/);
  return MKV_PATH.test(withoutQuery);
}

export function buildRemuxUrl(url, endpoint = "") {
  const base = String(endpoint || "").trim();
  if (!base) return "";
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}u=${encodeURIComponent(String(url || ""))}`;
}

/** The params the player route should receive, with the source rewritten if needed. */
export function applyRemuxSource(params, endpoint = "") {
  const source = String(params?.streamUrl || "");
  if (!shouldRemuxSource(source, endpoint)) return params;
  return { ...params, streamUrl: buildRemuxUrl(source, endpoint) };
}
