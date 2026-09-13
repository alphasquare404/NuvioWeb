import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAndroidVlcLaunchUrl,
  buildBrowserExternalPlayerLaunch,
  buildInfuseLaunchUrl,
  buildIosVlcLaunchUrl,
  buildLennaLaunchUrl,
  buildOutplayerLaunchUrl,
  copyBrowserExternalStreamLink,
  getBrowserExternalPlayerOptions,
  getManualBrowserExternalPlayerOptions,
  getBrowserExternalPlayerPlatform,
  getBrowserExternalPlayerStoreUrl,
  getBrowserExternalPlayerCapabilities,
  isTransferableExternalMediaUrl,
  launchBrowserExternalPlayer,
  prepareBrowserExternalPlaybackLaunch,
  resolveBrowserStreamPlaybackRoute
} from "./browserExternalPlayer.js";

const ios = { navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)", platform: "iPhone", maxTouchPoints: 5 } };
const android = { navigator: { userAgent: "Mozilla/5.0 (Linux; Android 15)", platform: "Linux armv8l" } };
const desktop = { navigator: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", platform: "Win32", maxTouchPoints: 0 } };

function createHandoffRuntime() {
  const values = new Map();
  return {
    crypto: globalThis.crypto,
    location: { href: "https://nuviotest.alphasquare.my.id/player" },
    localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key)
    }
  };
}

test("external player options are platform-aware", () => {
  assert.equal(getBrowserExternalPlayerPlatform(ios), "ios");
  assert.deepEqual(getBrowserExternalPlayerOptions(ios), ["lenna", "outplayer", "infuse", "vlc", "disabled"]);
  assert.deepEqual(getManualBrowserExternalPlayerOptions(ios), ["lenna", "outplayer", "infuse", "vlc"]);
  assert.equal(getBrowserExternalPlayerStoreUrl({ player: "outplayer", platform: "ios" }), "https://apps.apple.com/app/outplayer/id1449923287");
  assert.equal(getBrowserExternalPlayerPlatform(android), "android");
  assert.deepEqual(getBrowserExternalPlayerOptions(android), ["disabled", "vlc"]);
  assert.equal(getBrowserExternalPlayerPlatform(desktop), "other");
  assert.deepEqual(getBrowserExternalPlayerOptions(desktop), ["disabled"]);
});

test("external handoff rejects non-transferable local URLs", () => {
  assert.equal(isTransferableExternalMediaUrl("blob:https://nuvio.tv/id"), false);
  assert.equal(buildInfuseLaunchUrl({ mediaUrl: "blob:https://nuvio.tv/id" }), "");
  assert.equal(buildLennaLaunchUrl({ mediaUrl: "blob:https://nuvio.tv/id" }), "");
  assert.equal(buildBrowserExternalPlayerLaunch({ player: "vlc", platform: "android", mediaUrl: "file:///video.mp4" }), null);
  assert.equal(buildBrowserExternalPlayerLaunch({ player: "lenna", platform: "ios", mediaUrl: "blob:https://nuvio.tv/id" }), null);
});

test("default stream routing only bypasses Nuvio for an eligible configured target", () => {
  const mediaUrl = "https://media.example/video.mp4";
  assert.equal(resolveBrowserStreamPlaybackRoute({ player: "disabled", platform: "ios", mediaUrl }).target, "nuvio");
  assert.equal(resolveBrowserStreamPlaybackRoute({ player: "lenna", platform: "ios", mediaUrl }).target, "external");
  assert.equal(resolveBrowserStreamPlaybackRoute({ player: "infuse", platform: "ios", mediaUrl }).target, "external");
  assert.equal(resolveBrowserStreamPlaybackRoute({ player: "outplayer", platform: "ios", mediaUrl }).target, "external");
  assert.equal(resolveBrowserStreamPlaybackRoute({ player: "vlc", platform: "android", mediaUrl }).target, "external");
  assert.equal(resolveBrowserStreamPlaybackRoute({ player: "vlc", platform: "android", mediaUrl: "blob:https://nuvio/id" }).target, "nuvio");
});

test("Lenna uses an x-callback URL with the media URL encoded exactly once", () => {
  const normalMediaUrl = "https://example.com/video.mkv";
  assert.equal(
    new URL(buildLennaLaunchUrl({ mediaUrl: normalMediaUrl })).searchParams.get("url"),
    normalMediaUrl
  );
  const mediaUrl = "https://media.example/video.mkv?token=a%2Fb&quality=1080&part=1";
  const launch = buildLennaLaunchUrl({ mediaUrl });
  const parsed = new URL(launch);
  assert.equal(parsed.protocol, "lenna:");
  assert.equal(`${parsed.hostname}${parsed.pathname}`, "x-callback-url/play");
  assert.equal(parsed.searchParams.get("url"), mediaUrl);
  assert.equal(launch.includes(encodeURIComponent(mediaUrl)), true);
});

test("Infuse and VLC launch URLs preserve encoded source and optional subtitle", () => {
  const mediaUrl = "https://media.example/video.mp4?token=private&quality=1080";
  const subtitleUrl = "https://media.example/subtitle.vtt?token=private";
  const infuse = new URL(buildInfuseLaunchUrl({ mediaUrl, title: "A title", subtitleUrl, resumePositionSeconds: 2525.625 }));
  assert.equal(infuse.protocol, "infuse:");
  assert.equal(infuse.searchParams.get("url"), mediaUrl);
  assert.equal(infuse.searchParams.get("filename"), "A title");
  assert.equal(infuse.searchParams.get("sub"), subtitleUrl);
  assert.equal(infuse.searchParams.get("position"), "2525");
  const vlc = new URL(buildIosVlcLaunchUrl({ mediaUrl, subtitleUrl }));
  assert.equal(vlc.protocol, "vlc-x-callback:");
  assert.equal(vlc.searchParams.get("url"), mediaUrl);
  assert.equal(vlc.searchParams.get("sub"), subtitleUrl);
});

test("Android VLC handoff uses a package-targeted Chrome intent URI", () => {
  const intent = buildAndroidVlcLaunchUrl({ mediaUrl: "https://media.example/folder/video.mp4?quality=1080" });
  assert.match(intent, /package=org\.videolan\.vlc/);
  assert.match(intent, /S\.browser_fallback_url=https%3A%2F%2Fplay\.google\.com/);
});

test("iOS launches are fire-and-forget and store destinations are centralized", () => {
  let assignedHref = "";
  const runtime = { location: { assign: (href) => { assignedHref = href; } } };
  assert.equal(launchBrowserExternalPlayer({ runtime, href: "infuse://x-callback-url/play" }), true);
  assert.equal(assignedHref, "infuse://x-callback-url/play");
  assert.match(getBrowserExternalPlayerStoreUrl({ player: "infuse", platform: "ios" }), /apps\.apple\.com/);
  assert.match(getBrowserExternalPlayerStoreUrl({ player: "lenna", platform: "ios" }), /id6502967807/);
  assert.match(getBrowserExternalPlayerStoreUrl({ player: "vlc", platform: "ios" }), /apps\.apple\.com/);
  assert.match(getBrowserExternalPlayerStoreUrl({ player: "vlc", platform: "android" }), /play\.google\.com/);
  assert.equal(getBrowserExternalPlayerStoreUrl({ player: "infuse", platform: "android" }), "");
});

test("the shared launcher has no lifecycle timer or popup callback path", () => {
  let assignedHref = "";
  const runtime = { location: { assign: (href) => { assignedHref = href; } } };
  launchBrowserExternalPlayer({ runtime, href: "infuse://x-callback-url/play?url=https%3A%2F%2Fmedia.example" });
  assert.equal(assignedHref.startsWith("infuse:"), true);
});

test("Lenna keeps url, subtitle, integer resume position, then callbacks in documented order", () => {
  const token = "0123456789abcdef0123456789abcdef";
  const launch = buildLennaLaunchUrl({
    mediaUrl: "https://example.test/video.mkv",
    subtitleUrl: "https://example.test/sub.srt",
    resumePositionSeconds: 342.8,
    externalReturnToken: token,
    externalReturnOrigin: "https://nuvio.example"
  });
  const parsed = new URL(launch);
  assert.equal(parsed.searchParams.get("url"), "https://example.test/video.mkv");
  assert.equal(parsed.searchParams.get("sub"), "https://example.test/sub.srt");
  assert.equal(parsed.searchParams.get("position"), "342");
  assert.notEqual(parsed.searchParams.get("position"), "342800");
  assert.deepEqual([...parsed.searchParams.keys()].slice(0, 5), ["url", "sub", "position", "x-success", "x-error"]);
  assert.equal(new URL(buildLennaLaunchUrl({ mediaUrl: "https://example.test/video.mkv", resumePositionSeconds: 0 })).searchParams.get("position"), "0");
});

test("Outplayer sends the media only to Outplayer, retains a safe resume position, and uses opaque HTTPS callbacks", () => {
  const token = "0123456789abcdef0123456789abcdef";
  const launch = new URL(buildOutplayerLaunchUrl({
    mediaUrl: "https://media.example/video.mp4?signature=temporary",
    externalReturnToken: token,
    externalReturnOrigin: "https://nuviotest.alphasquare.my.id",
    resumePositionSeconds: 45.625,
    knownDurationMs: 2_520_000
  }));
  assert.equal(launch.searchParams.get("url"), "https://media.example/video.mp4?signature=temporary");
  const success = new URL(launch.searchParams.get("x-success"));
  assert.equal(success.searchParams.get("outcome"), "stopped");
  assert.equal(success.searchParams.get("sourceOutcome"), "finished");
  assert.equal(success.searchParams.has("syntheticFinished"), false);
  assert.equal(success.searchParams.has("position"), false);
  assert.equal(success.searchParams.has("duration"), false);
  assert.equal(launch.searchParams.get("x-cancel"), `https://nuviotest.alphasquare.my.id/api/external-return/report/${token}?outcome=stopped&provider=outplayer`);
  assert.equal(launch.searchParams.get("position"), "45.625");
  const cancel = new URL(launch.searchParams.get("x-cancel"));
  assert.equal(cancel.searchParams.has("position"), false);
  assert.equal(cancel.searchParams.has("duration"), false);
  for (const callback of [launch.searchParams.get("x-success"), launch.searchParams.get("x-cancel")]) {
    const target = new URL(callback);
    assert.equal(target.searchParams.has("outcome"), true);
    assert.equal(target.hash, "");
    assert.equal(callback.includes("media.example"), false);
    assert.equal(callback.includes("signature"), false);
    assert.equal(callback.includes("access_token"), false);
    assert.equal(callback.includes("api_key"), false);
    assert.equal(callback.includes("secret"), false);
  }
});

test("Copy Stream Link copies only an explicit active resolved URL and does not persist it", async () => {
  let copied = "";
  const runtime = { navigator: { clipboard: { writeText: async (value) => { copied = value; } } } };
  assert.equal(await copyBrowserExternalStreamLink({ runtime, mediaUrl: "https://media.example/video.mp4?signature=temporary" }), true);
  assert.equal(copied, "https://media.example/video.mp4?signature=temporary");
  assert.equal(await copyBrowserExternalStreamLink({ runtime, mediaUrl: "magnet:?xt=urn:btih:abc" }), false);
});

test("Infuse uses opaque success/error callbacks without exposing lastPlayedUrl to local state", () => {
  const token = "0123456789abcdef0123456789abcdef";
  const launch = new URL(buildInfuseLaunchUrl({ mediaUrl: "https://media.example/video.mp4", externalReturnToken: token, externalReturnOrigin: "https://nuvio.example" }));
  assert.equal(launch.searchParams.get("position"), "0");
  assert.equal(new URL(launch.searchParams.get("x-success")).searchParams.get("sourceOutcome"), "success");
  assert.equal(new URL(launch.searchParams.get("x-error")).searchParams.get("sourceOutcome"), "error");
  assert.equal(launch.searchParams.has("x-cancel"), false);
});

test("capabilities distinguish automatic position players from VLC manual return", () => {
  assert.equal(getBrowserExternalPlayerCapabilities("outplayer").automaticProgress, true);
  assert.equal(getBrowserExternalPlayerCapabilities("infuse").resume, true);
  assert.equal(getBrowserExternalPlayerCapabilities("lenna").automaticProgress, true);
  assert.equal(getBrowserExternalPlayerCapabilities("vlc").automaticProgress, false);
});

test("Infuse, Lenna, and VLC apply their callback policy without changing Outplayer", () => {
  const runtime = createHandoffRuntime();
  const common = { platform: "ios", mediaUrl: "https://media.example/video.mp4", profileId: "1", progressContext: { itemId: "movie:1", itemType: "movie" }, runtime };
  const infuse = prepareBrowserExternalPlaybackLaunch({ ...common, player: "infuse", resumePositionSeconds: 2525.625, knownDurationMs: 1_440_000 });
  assert.equal(new URL(infuse.launch.href).searchParams.get("position"), "2525");
  assert.equal(infuse.handoff.manualPromptEligible, false);
  const lenna = prepareBrowserExternalPlaybackLaunch({ ...common, player: "lenna" });
  assert.equal(new URL(lenna.launch.href).searchParams.has("x-success"), true);
  assert.equal(lenna.handoff.manualPromptEligible, true);
  const vlc = prepareBrowserExternalPlaybackLaunch({ ...common, player: "vlc" });
  assert.equal(new URL(vlc.launch.href).searchParams.has("x-success"), true);
  assert.equal(vlc.handoff.manualPromptEligible, true);
});

test("manual progress mode can launch Outplayer without sending relay callbacks", () => {
  const launch = new URL(buildOutplayerLaunchUrl({ mediaUrl: "https://media.example/video.mp4" }));
  assert.equal(launch.searchParams.has("x-success"), false);
  assert.equal(launch.searchParams.has("x-cancel"), false);
});

test("the persisted Outplayer preference prepares automatic callbacks before its preferred-setting launch", () => {
  const prepared = prepareBrowserExternalPlaybackLaunch({
    player: "outplayer",
    platform: "ios",
    mediaUrl: "https://media.example/video.mp4",
    resumePositionSeconds: 45.625,
    knownDurationMs: 120_000,
    progressMode: "automatic",
    profileId: "1",
    progressContext: { itemId: "movie:1", itemType: "movie", title: "Movie" },
    runtime: createHandoffRuntime()
  });
  const launch = new URL(prepared.launch.href);
  assert.equal(launch.protocol, "outplayer:");
  assert.equal(launch.searchParams.has("url"), true);
  assert.equal(launch.searchParams.get("position"), "45.625");
  assert.equal(launch.searchParams.has("x-success"), true);
  assert.equal(launch.searchParams.has("x-cancel"), true);
  const success = new URL(launch.searchParams.get("x-success"));
  const cancel = new URL(launch.searchParams.get("x-cancel"));
  assert.equal(success.searchParams.has("position"), false);
  assert.equal(success.searchParams.has("duration"), false);
  assert.equal(cancel.searchParams.has("position"), false);
  assert.equal(cancel.searchParams.has("duration"), false);
  assert.equal(prepared.handoff.automatic, true);
  assert.equal(prepared.callbackCapable, true);
});

test("the persisted Outplayer preference keeps manual reporting callback-free", () => {
  const prepared = prepareBrowserExternalPlaybackLaunch({
    player: "outplayer",
    platform: "ios",
    mediaUrl: "https://media.example/video.mp4",
    resumePositionSeconds: 45.625,
    progressMode: "manual",
    profileId: "1",
    progressContext: { itemId: "movie:1", itemType: "movie", title: "Movie" },
    runtime: createHandoffRuntime()
  });
  const launch = new URL(prepared.launch.href);
  assert.equal(launch.searchParams.has("x-success"), false);
  assert.equal(launch.searchParams.has("x-cancel"), false);
  assert.equal(prepared.handoff.automatic, false);
  assert.equal(prepared.handoff.manualPromptEligible, true);
});
