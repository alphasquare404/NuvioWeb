import assert from "node:assert/strict";
import { test } from "node:test";

import {
  desktopContinueWatchingShowUnairedNextUp,
  parseDesktopContinueWatchingSettingsPayload,
  patchDesktopContinueWatchingSettingsPayload
} from "./profileSettingsContinueWatchingBridge.js";

globalThis.__NUVIO_INCLUDE_TRAKT_CLIENT_SECRET__ = false;
const { hasUsableRemoteProfileSettings } = await import("./profileSettingsSyncService.js");

test("projects explicit Desktop Continue Watching booleans without coercion", () => {
  assert.equal(
    desktopContinueWatchingShowUnairedNextUp('{"show_unaired_next_up":true}'),
    true
  );
  assert.equal(
    desktopContinueWatchingShowUnairedNextUp('{"show_unaired_next_up":false}'),
    false
  );
  assert.equal(
    desktopContinueWatchingShowUnairedNextUp('{"show_unaired_next_up":"false"}'),
    null
  );
  assert.equal(desktopContinueWatchingShowUnairedNextUp('{"other":true}'), null);
});

test("handles malformed Desktop Continue Watching payloads without throwing", () => {
  assert.equal(parseDesktopContinueWatchingSettingsPayload("not-json"), null);
  assert.equal(parseDesktopContinueWatchingSettingsPayload("[]"), null);
  assert.equal(parseDesktopContinueWatchingSettingsPayload(null), null);
});

test("patches only show_unaired_next_up and preserves unknown Desktop keys", () => {
  const patched = patchDesktopContinueWatchingSettingsPayload(
    '{"show_unaired_next_up":false,"desktop_only_a":123,"desktop_only_b":"keep"}',
    true
  );
  assert.deepEqual(JSON.parse(patched), {
    show_unaired_next_up: true,
    desktop_only_a: 123,
    desktop_only_b: "keep"
  });
});

test("creates a minimal valid compatibility payload when the Desktop payload is absent or invalid", () => {
  assert.deepEqual(JSON.parse(patchDesktopContinueWatchingSettingsPayload(null, false)), {
    show_unaired_next_up: false
  });
  assert.deepEqual(JSON.parse(patchDesktopContinueWatchingSettingsPayload("not-json", true)), {
    show_unaired_next_up: true
  });
});

test("treats a Desktop-only Continue Watching payload as meaningful remote settings", () => {
  assert.equal(
    hasUsableRemoteProfileSettings({
      version: 1,
      features: {
        continue_watching_settings_payload: '{"show_unaired_next_up":false}'
      }
    }),
    true
  );
});
