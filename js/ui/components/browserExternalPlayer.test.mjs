import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAndroidVlcLaunchUrl,
  buildBrowserExternalPlayerLaunch,
  buildInfuseLaunchUrl,
  buildIosVlcLaunchUrl,
  getBrowserExternalPlayerOptions,
  getBrowserExternalPlayerPlatform,
  getBrowserExternalPlayerStoreUrl,
  isTransferableExternalMediaUrl,
  launchBrowserExternalPlayer,
  resolveBrowserStreamPlaybackRoute
} from "./browserExternalPlayer.js";

const ios = { navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)", platform: "iPhone", maxTouchPoints: 5 } };
const android = { navigator: { userAgent: "Mozilla/5.0 (Linux; Android 15)", platform: "Linux armv8l" } };

test("external player options are platform-aware", () => {
  assert.equal(getBrowserExternalPlayerPlatform(ios), "ios");
  assert.deepEqual(getBrowserExternalPlayerOptions(ios), ["disabled", "infuse", "vlc"]);
  assert.equal(getBrowserExternalPlayerPlatform(android), "android");
  assert.deepEqual(getBrowserExternalPlayerOptions(android), ["disabled", "vlc"]);
});

test("external handoff rejects non-transferable local URLs", () => {
  assert.equal(isTransferableExternalMediaUrl("blob:https://nuvio.tv/id"), false);
  assert.equal(buildInfuseLaunchUrl({ mediaUrl: "blob:https://nuvio.tv/id" }), "");
  assert.equal(buildBrowserExternalPlayerLaunch({ player: "vlc", platform: "android", mediaUrl: "file:///video.mp4" }), null);
});

test("default stream routing only bypasses Nuvio for an eligible configured target", () => {
  const mediaUrl = "https://media.example/video.mp4";
  assert.equal(resolveBrowserStreamPlaybackRoute({ player: "disabled", platform: "ios", mediaUrl }).target, "nuvio");
  assert.equal(resolveBrowserStreamPlaybackRoute({ player: "infuse", platform: "ios", mediaUrl }).target, "external");
  assert.equal(resolveBrowserStreamPlaybackRoute({ player: "vlc", platform: "android", mediaUrl }).target, "external");
  assert.equal(resolveBrowserStreamPlaybackRoute({ player: "vlc", platform: "android", mediaUrl: "blob:https://nuvio/id" }).target, "nuvio");
});

test("Infuse and VLC launch URLs preserve encoded source and optional subtitle", () => {
  const mediaUrl = "https://media.example/video.mp4?token=private&quality=1080";
  const subtitleUrl = "https://media.example/subtitle.vtt?token=private";
  const infuse = new URL(buildInfuseLaunchUrl({ mediaUrl, title: "A title", subtitleUrl }));
  assert.equal(infuse.protocol, "infuse:");
  assert.equal(infuse.searchParams.get("url"), mediaUrl);
  assert.equal(infuse.searchParams.get("filename"), "A title");
  assert.equal(infuse.searchParams.get("sub"), subtitleUrl);
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
