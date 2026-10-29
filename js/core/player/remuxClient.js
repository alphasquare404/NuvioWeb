import { runStartupStep } from "./clientRemux/startupFailure.mjs";
/* global __NUVIO_REMUX_ASSET_ID__ */
import { classifyPlayback } from "./playbackMethod.js";
import { REMUX_POLICY, PROBE_MODE, TRANSCODE_ENDPOINT } from "../../config.js";
import { getDeviceCapabilities } from "./deviceCapabilities.js";
import { isConfiguredCopyRelayUrl } from "./remuxPolicy.js";

export function clientRemuxPlan(
  stream,
  probe,
  {
    policy = REMUX_POLICY,
    capabilities = getDeviceCapabilities(),
    baseUrl = globalThis.location?.href || "http://localhost/",
    transcodeEndpoint = TRANSCODE_ENDPOINT
  } = {}
) {
  if (!policy.explicit || policy.mode !== "client") return null;
  let sourceUrl = String(stream?.url || stream?.externalUrl || "").trim(),
    audioIndex = null;
  try {
    const url = new URL(sourceUrl, baseUrl),
      local = new URL(baseUrl);
    const ownLegacy =
      url.origin === local.origin && url.pathname === "/api/remux" && url.searchParams.has("u");
    if (
      ownLegacy ||
      isConfiguredCopyRelayUrl(sourceUrl, { endpoint: transcodeEndpoint, baseUrl })
    ) {
      const raw = url.searchParams.get("ai") ?? "0";
      if (!/^\d+$/.test(raw)) throw Error("Invalid saved audio selection.");
      audioIndex = Number(raw);
      sourceUrl = url.searchParams.get("u") || "";
    }
  } catch (error) {
    if (error.message === "Invalid saved audio selection.") throw error;
  }
  if (!probe && audioIndex === null) return null;
  const verdict = classifyPlayback({ url: sourceUrl, label: "", probe, capabilities });
  if (audioIndex === null && verdict.method !== "remux") return null;
  const index = audioIndex ?? Number(verdict.audioIndex ?? 0);
  if (!Number.isInteger(index) || index < 0) throw Error("Invalid audio selection.");
  return {
    sourceUrl,
    method: "remux",
    route: "client",
    delivery: "mse",
    mediaUrl: null,
    audioIndex: index,
    expectedAudio: probe?.audioStreams?.length
      ? {
          index,
          count: probe.audioStreams.length,
          codec: probe.audioStreams[index]?.codec,
          channels: probe.audioStreams[index]?.channels,
          sampleRate: probe.audioStreams[index]?.sampleRate
        }
      : null,
    state: "needs-preflight",
    reason: null,
    serverAssistance: { probe: probe ? PROBE_MODE : "none", media: false }
  };
}

export async function loadClientRemux(options) {
  const version =
    typeof __NUVIO_REMUX_ASSET_ID__ === "undefined" ? "dev" : __NUVIO_REMUX_ASSET_ID__;
  const assetBase = new URL("./assets/libs/remux/" + version + "/", document.baseURI);
  const module = await runStartupStep(
    "runtime-import",
    () => import(new URL("client-runtime.js", assetBase).href)
  );
  return runStartupStep("runtime-create", () =>
    module.createClientRemux({ ...options, assetBase, version })
  );
}
