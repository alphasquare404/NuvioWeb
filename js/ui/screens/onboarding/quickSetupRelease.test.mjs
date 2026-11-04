import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { quickSetupReleaseFeatures } from "./quickSetupRelease.js";
import { selectQuickSetupSteps } from "./quickSetupSteps.js";

test("client remux advertises Mediabunny and never server audio conversion", () => {
  assert.deepEqual(quickSetupReleaseFeatures({ mode: "client", transcodeEndpoint: "/transcode" }), {
    remuxProvider: "Mediabunny",
    client: true,
    audioTranscoding: false
  });
});

test("server processing is described only when its endpoints are configured", () => {
  assert.deepEqual(
    quickSetupReleaseFeatures({
      mode: "server",
      remuxEndpoint: "/remux",
      transcodeEndpoint: "/transcode"
    }),
    {
      remuxProvider: "Jellyfin FFmpeg",
      client: false,
      audioTranscoding: true
    }
  );
  assert.equal(
    quickSetupReleaseFeatures({ mode: "server", remuxEndpoint: "/remux" }).audioTranscoding,
    false
  );
  assert.equal(quickSetupReleaseFeatures({ mode: "server" }).remuxProvider, null);
  assert.deepEqual(
    quickSetupReleaseFeatures({
      mode: "off",
      remuxEndpoint: "/remux",
      transcodeEndpoint: "/transcode"
    }),
    {
      remuxProvider: null,
      client: false,
      audioTranscoding: false
    }
  );
});

test("upgrading an internal profile adds a release introduction and processing before offline sync", () => {
  assert.deepEqual(selectQuickSetupSteps({ internalProcessing: true, includeReleaseIntro: true }), [
    "release",
    "player",
    "processing",
    "offlineSync"
  ]);
  assert.deepEqual(selectQuickSetupSteps({ internalProcessing: true }), [
    "player",
    "processing",
    "offlineSync"
  ]);
});

test("external steps retain their sequence without the internal processing question", () => {
  assert.deepEqual(
    selectQuickSetupSteps({
      includeReleaseIntro: true,
      internalProcessing: true,
      callbackMode: "progress",
      automaticProgress: true,
      pushState: "enabled"
    }),
    ["release", "player", "progress", "return", "offlineSync"]
  );
  assert.deepEqual(
    selectQuickSetupSteps({
      internalProcessing: true,
      callbackMode: "return-only",
      pushState: "enabled"
    }),
    ["player", "return", "offlineSync"]
  );
});

const source = readFileSync(new URL("./quickSetupScreen.js", import.meta.url), "utf8");
function renderReleaseMethod(name, context) {
  const start = source.indexOf(`  ${name}()`),
    end = source.indexOf("\n  },", start);
  const render = new Function("escapeHtml", "t", "return ({" + source.slice(start, end + 5) + "})")(
    String,
    (key, params, fallback) => fallback
  )[name];
  return render.call(context);
}

test("What's new starts collapsed and advertises only enabled processing features", () => {
  const render = (features) => renderReleaseMethod("renderWhatsNew", { releaseFeatures: features });
  const client = render(quickSetupReleaseFeatures({ mode: "client" }));
  assert.match(client, /<details class="quick-setup-whats-new">/);
  assert.doesNotMatch(client, /<details[^>]*\bopen\b/);
  for (const group of ["New", "Fix", "Change"]) assert.ok(client.includes(`<h3>${group}</h3>`));
  assert.ok(client.includes("Internal player remux"));
  assert.ok(!client.includes("Audio transcoding"));
  const server = render(
    quickSetupReleaseFeatures({
      mode: "server",
      remuxEndpoint: "/remux",
      transcodeEndpoint: "/transcode"
    })
  );
  assert.ok(server.includes("Audio transcoding"));
  const off = render(quickSetupReleaseFeatures());
  assert.ok(!off.includes("Internal player remux"));
  assert.ok(!off.includes("Audio transcoding"));
});

test("release intro keeps preference reassurance as plain text without the removed player box", () => {
  const html = renderReleaseMethod("renderReleaseStep", {
    releaseFeatures: quickSetupReleaseFeatures({ mode: "client" }),
    renderReleaseCapabilities: () => "capabilities",
    renderWhatsNew: () => "release notes"
  });
  assert.ok(html.includes("More ways to watch, right here."));
  assert.ok(html.includes('class="quick-setup-existing-settings"'));
  assert.ok(!html.includes("Your player is still"));
  assert.ok(!html.includes("quick-setup-kept"));
});

function commitHarness() {
  const playerWrites = [],
    badgeWrites = [];
  const start = source.indexOf("  commitStep(step)"),
    end = source.indexOf("\n  },", start);
  const commit = new Function(
    "PlayerSettingsStore",
    "StreamBadgeSettingsStore",
    "return ({" + source.slice(start, end + 5) + "})"
  )(
    { set: (value) => playerWrites.push(value) },
    { set: (value) => badgeWrites.push(value) }
  ).commitStep;
  const ctx = {
    labels: false,
    initialLabels: false,
    filenameRouting: false,
    initialFilenameRouting: false,
    streamFilter: "DIRECT_REMUX",
    initialStreamFilter: "DIRECT_REMUX",
    offlineSync: true,
    initialOfflineSync: true
  };
  return { ctx, playerWrites, badgeWrites, commit };
}

test("reviewing existing internal and offline choices never rewrites them", () => {
  const h = commitHarness();
  h.commit.call(h.ctx, "processing");
  h.commit.call(h.ctx, "offlineSync");
  assert.deepEqual(h.playerWrites, []);
  assert.deepEqual(h.badgeWrites, []);
});

test("processing commits only changed fields and is idempotent", () => {
  const h = commitHarness();
  Object.assign(h.ctx, { labels: true, filenameRouting: true, streamFilter: "ALL" });
  h.commit.call(h.ctx, "processing");
  h.commit.call(h.ctx, "processing");
  assert.deepEqual(h.playerWrites, [
    { filenamePlaybackRoutingEnabled: true, filenameStreamDisplayMode: "ALL" }
  ]);
  assert.deepEqual(h.badgeWrites, [{ showPlaybackLabels: true }]);
  assert.equal(h.ctx.offlineSync, true);
});

test("changing offline sync is independent of player and processing settings", () => {
  const h = commitHarness();
  h.ctx.offlineSync = false;
  h.commit.call(h.ctx, "offlineSync");
  h.commit.call(h.ctx, "offlineSync");
  assert.deepEqual(h.playerWrites, [{ syncOfflineProgress: false }]);
  assert.deepEqual(h.badgeWrites, []);
});

test("preview filters actual shared card models without opening a stream", async () => {
  const { settingsStreamPreviewSources } =
    await import("../settings/playbackSettingsPresentation.js");
  const start = source.indexOf("  renderStreamPreview()"),
    end = source.indexOf("\n  },", start);
  const models = [];
  const preview = new Function(
    "StreamBadgeSettingsStore",
    "settingsStreamPreviewSources",
    "normalizeSourceForDisplay",
    "renderFilenamePlaybackMethodBadge",
    "renderBrowserSourceCardContent",
    "escapeHtml",
    "t",
    "return ({" + source.slice(start, end + 5) + "})"
  )(
    { snapshot: () => ({ badgePlacement: "BOTTOM", showAddonLogo: true }) },
    settingsStreamPreviewSources,
    (s) => ({ source: s, badges: "" }),
    (method, settings) => (settings.showPlaybackLabels ? `<span>${method}</span>` : ""),
    (model) => {
      models.push(model);
      return "<div class='shared-card-copy'></div>";
    },
    String,
    (key, params, fallback) => fallback
  ).renderStreamPreview;
  const html = preview.call({ labels: true, streamFilter: "ALL" });
  assert.deepEqual(
    models.map((m) => m.source.previewMethod),
    ["direct", "remux", "audio-transcode", "unknown"]
  );
  assert.ok(html.includes("stream-route-card-action"));
  assert.ok(html.includes("stream-route-offline-actions"));
  assert.ok(!html.includes('data-action="playStream"'));
  models.length = 0;
  preview.call({ labels: false, streamFilter: "DIRECT_REMUX" });
  assert.deepEqual(
    models.map((m) => m.source.previewMethod),
    ["direct", "remux"]
  );
  assert.ok(models.every((m) => !m.bottomBadges));
});
