import { DirectDebridResolver } from "../../core/debrid/directDebridResolver.js";
import { isTransferableExternalMediaUrl } from "./browserExternalPlayer.js";

function playableUrl(stream) {
  return [stream?.url, stream?.externalUrl].find(isTransferableExternalMediaUrl) || "";
}

/**
 * The link to hand an external player, or "" when there is none to hand over.
 *
 * A stream Nuvio resolves itself -- a debrid torrent, shown as "Instant" --
 * carries no link until the provider is asked for one, and that ask lived only
 * inside the internal player. The external route therefore read an empty URL,
 * built no launch and reported that it had not routed, which means fall back to
 * the player. The setting was never ignored: it was answered for a stream that
 * had nothing to hand over yet. Preparation resolves a few of these ahead of
 * time, but it is off by default, so for most people this was every debrid
 * stream they keep a debrid account to play.
 *
 * A magnet is not a link either. It is a torrent an external player cannot
 * fetch, so it is treated as absent and resolved like any other.
 *
 * Failure returns "" rather than an error. Falling back to the internal player
 * asks this same resolver, and that path already owns the message for every way
 * this can fail -- not cached, no API key, the provider degraded.
 */
export async function resolveExternalHandoffMediaUrl(
  stream,
  { season = null, episode = null, onNetworkResolve = null } = {}
) {
  const direct = playableUrl(stream);
  if (direct) return direct;
  const resolveContext = { season, episode };
  if (!DirectDebridResolver.canResolveStream(stream, resolveContext)) return "";
  const cached = DirectDebridResolver.cachedPlayableStream(stream, resolveContext);
  if (cached) return playableUrl(cached);
  // Only the network path is worth announcing. The internal player has a
  // loading screen to wait behind and this route has none, so without this the
  // list sits there doing nothing until another app opens over it.
  if (typeof onNetworkResolve === "function") onNetworkResolve();
  const result = await DirectDebridResolver.resolve(stream, resolveContext).catch(() => null);
  return result?.status === "success" ? playableUrl(result.stream) : "";
}
