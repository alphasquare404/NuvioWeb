import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { quickSetupReleaseFeatures, loadQuickSetupReleaseFeatures } from "./quickSetupRelease.js";
import { selectQuickSetupSteps } from "./quickSetupSteps.js";

test("client remux advertises Mediabunny and never server audio conversion", () => {
  assert.deepEqual(quickSetupReleaseFeatures({ mode: "client", transcodeEndpoint: "/transcode" }), {
    remuxProvider: "Mediabunny",
    client: true,
    audioTranscoding: false
  });
});

test("server processing is described only when configured and verified", () => {
  assert.deepEqual(
    quickSetupReleaseFeatures({
      mode: "server",
      remuxEndpoint: "/remux",
      transcodeEndpoint: "/transcode",
      availability: { remux: true, audioTranscoding: true }
    }),
    {
      remuxProvider: "FFmpeg",
      client: false,
      audioTranscoding: true
    }
  );
  assert.equal(
    quickSetupReleaseFeatures({ mode: "server", remuxEndpoint: "/remux" }).audioTranscoding,
    false
  );
  assert.equal(quickSetupReleaseFeatures({ mode: "server" }).remuxProvider, null);
  assert.equal(
    quickSetupReleaseFeatures({ mode: "server", remuxEndpoint: "/remux" }).remuxProvider,
    null
  );
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

test("onboarding confirms the binary capability rather than trusting a configured health URL", async () => {
  const options = { mode: "server", remuxEndpoint: "/remux", transcodeEndpoint: "/transcode" };
  const unverified = await loadQuickSetupReleaseFeatures(options, {
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true }) })
  });
  assert.equal(unverified.remuxProvider, null);
  assert.equal(unverified.audioTranscoding, false);
  const verified = await loadQuickSetupReleaseFeatures(options, {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        ffmpeg: { verified: true, available: true, remux: true, audioTranscoding: true }
      })
    })
  });
  assert.equal(verified.remuxProvider, "FFmpeg");
  assert.equal(verified.audioTranscoding, true);
  const unavailable = await loadQuickSetupReleaseFeatures(options, {
    fetchImpl: async () => {
      throw Error("unreachable");
    }
  });
  assert.equal(unavailable.remuxProvider, null);
  assert.equal(unavailable.audioTranscoding, false);
});

test("client onboarding never requests a server FFmpeg capability", async () => {
  const features = await loadQuickSetupReleaseFeatures(
    { mode: "client", remuxEndpoint: "/remux", transcodeEndpoint: "/transcode" },
    {
      fetchImpl: () => {
        throw Error("must not request");
      }
    }
  );
  assert.equal(features.remuxProvider, "Mediabunny");
  assert.equal(features.audioTranscoding, false);
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
      transcodeEndpoint: "/transcode",
      availability: { remux: true, audioTranscoding: true }
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
    streamFilter: ["direct", "remux"],
    initialStreamFilter: ["direct", "remux"],
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
  Object.assign(h.ctx, { labels: true, filenameRouting: true, streamFilter: ["all"] });
  h.commit.call(h.ctx, "processing");
  h.commit.call(h.ctx, "processing");
  assert.deepEqual(h.playerWrites, [
    { filenamePlaybackRoutingEnabled: true, filenameStreamFilter: ["all"] }
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
  const html = preview.call({ labels: true, streamFilter: ["all"] });
  assert.deepEqual(
    models.map((m) => m.source.previewMethod),
    ["direct", "remux", "audio-transcode", "transcode", "unknown"]
  );
  assert.ok(html.includes("stream-route-card-action"));
  assert.ok(html.includes("stream-route-offline-actions"));
  assert.ok(!html.includes('data-action="playStream"'));
  models.length = 0;
  preview.call({ labels: false, streamFilter: ["direct", "remux"] });
  assert.deepEqual(
    models.map((m) => m.source.previewMethod),
    ["direct", "remux"]
  );
  assert.ok(models.every((m) => !m.bottomBadges));
});
