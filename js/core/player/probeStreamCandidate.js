import { DirectDebridResolver } from "../debrid/directDebridResolver.js";
import { streamProbeIdentity } from "./streamProbe.js";

// Metadata labeling owns its candidate cap; Instant Playback preparation is a
// separate feature. Resolve only a cache-missing candidate when its probe slot runs.
export async function probeStreamCandidate(
  prober,
  stream,
  {
    mode = "server",
    context = {},
    active = () => true,
    onResolved = () => {},
    resolver = DirectDebridResolver,
    resolveTimeoutMs = 15000,
    timeoutMs = 15000
  } = {}
) {
  if (!active()) return null;
  const identity = streamProbeIdentity(stream);
  let url = String(stream.url || stream.externalUrl || "").trim();
  if (!/^https?:/i.test(url)) url = "";
  if (mode === "client" && /^torrent-file:[a-f0-9]{40}:\d+$/.test(identity)) {
    const cached = await prober.probe("", { identity, reason: "label-cache" });
    if (!active()) return null;
    if (cached) return cached;
  }
  if (!url) {
    if (!resolver.canResolveStream(stream, context)) return null;
    let timer;
    try {
      const resolved = await Promise.race([
        Promise.resolve().then(() => resolver.resolve(stream, context)),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(null), resolveTimeoutMs);
        })
      ]);
      if (!active() || resolved?.status !== "success") return null;
      url = String(resolved.stream?.url || resolved.url || "").trim();
      if (!/^https?:/i.test(url)) return null;
      onResolved(url);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  if (!active() || !/^https?:/i.test(url)) return null;
  return prober.probe(url, { identity, reason: "selection", resolveTimeoutMs, timeoutMs });
}
