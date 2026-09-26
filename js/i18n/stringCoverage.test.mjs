import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Keys the app asks for that the strings file does not answer.
//
// Each one printed "Missing translation for ..." and then rendered its inline
// fallback, so the screen looked right and nothing was obviously wrong. That is
// what let them accumulate: a fallback is a safety net, not a translation, and
// a key with only a fallback is English in every locale.
//
// Two of the reported keys needed no new string. The word was already there
// under the name another screen used -- `nav_settings` in all thirty locales,
// `common.viewDetails` in fourteen -- so they are aliased rather than copied.
//
// Thirty-one others are still unanswered. They are listed here rather than
// fixed, because some want a translator's decision rather than an English
// string copied into the default file. Listing them stops the number growing:
// a new key with no string fails this test, and closing one means deleting a
// line from the list.

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

async function readStringNames() {
  const xml = await readFile(path.join(ROOT, "res/values/strings.xml"), "utf8");
  return new Set(Array.from(xml.matchAll(/<string name="([^"]+)"/g), (match) => match[1]));
}

async function readAliases() {
  const source = await readFile(path.join(ROOT, "js/i18n/index.js"), "utf8");
  const block = source.match(/const KEY_ALIASES = \{([\s\S]*?)\n\};/)?.[1] || "";
  return new Map(Array.from(block.matchAll(/"([^"]+)":\s*"([^"]+)"/g), (m) => [m[1], m[2]]));
}

async function readRequestedKeys() {
  const keys = new Set();
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith(".js") && !entry.name.includes(".test.")) {
        const source = await readFile(full, "utf8");
        for (const match of source.matchAll(/\bt\(\s*"([^"]+)"/g)) keys.add(match[1]);
      }
    }
  }
  await walk(path.join(ROOT, "js"));
  return keys;
}

async function unansweredKeys() {
  const [names, aliases, requested] = await Promise.all([
    readStringNames(),
    readAliases(),
    readRequestedKeys()
  ]);
  return [...requested].filter((key) => !names.has(key) && !names.has(aliases.get(key))).sort();
}

// The keys the device logs caught. These are closed and must stay closed.
const REPORTED = [
  "profile_active",
  "home_view_details",
  "nav.settings",
  "offline.downloadSeason",
  "debug_console_copy",
  "debug_console_copy_done",
  "debug_console_copy_failed"
];

// Everything else still unanswered, as of this test being written.
const KNOWN_GAPS = [
  "account_signin_qr_subtitle_desktop",
  "account_signin_title",
  "cast_detail_empty",
  "common.copied",
  "common.disabled",
  "common.hide",
  "common.show",
  "common_close",
  "debrid_device_auth_copy_code",
  "debrid_device_auth_open_link",
  "discover_choose_catalog",
  "discover_load_failed",
  "discover_no_matching_items",
  "home.continueStatusWatchedPercent",
  "library_clear_filters",
  "library_filter_status",
  "offline.downloaded",
  "offline.episodesUnavailable",
  "offline.playOffline",
  "offline.seasonDownloaded",
  "offline.sendSubtitle",
  "person_latest",
  "person_popular",
  "person_upcoming",
  "player_engine_switch_unavailable",
  "profile_pin",
  "settings.plugins.comingSoon",
  "stream_autoplay_countdown",
  "stream_autoplay_hint",
  "stream_autoplay_title",
  "subtitle_style_reset_action"
];

test("the keys the logs caught are answered", async () => {
  const unanswered = new Set(await unansweredKeys());
  for (const key of REPORTED) {
    assert.ok(!unanswered.has(key), `${key} has no string behind it`);
  }
});

// The two that were aliased are only fixed if their targets exist, and the
// point of aliasing was that those targets are already translated.
test("the aliased keys point at strings that exist", async () => {
  const names = await readStringNames();
  assert.ok(names.has("nav_settings"));
  assert.ok(names.has("common.viewDetails"));
});

test("no new key is asked for without a string", async () => {
  const unanswered = await unansweredKeys();
  const unexpected = unanswered.filter((key) => !KNOWN_GAPS.includes(key));
  assert.deepEqual(unexpected, [], `these keys have no string: ${unexpected.join(", ")}`);
});

// A gap that has been closed should leave the list, or the list stops meaning
// anything.
test("the known list has no entries that were since answered", async () => {
  const unanswered = new Set(await unansweredKeys());
  const stale = KNOWN_GAPS.filter((key) => !unanswered.has(key));
  assert.deepEqual(stale, [], `these are answered now and can leave the list: ${stale.join(", ")}`);
});
