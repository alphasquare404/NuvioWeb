import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Keys this localization pass added to the default (English) file together
// with their French translation. A key missing on either side would render the
// English fallback in the French UI, which is exactly what this pass removes.
const ADDED_KEYS = [
  "boot_failed_title",
  "boot_failed_message",
  "subtitle_dialog_options",
  "subtitle_dialog_none",
  "subtitle_dialog_close_hint",
  "plugin_sync_status_syncing",
  "plugin_sync_status_link_prompt",
  "plugin_sync_status_error",
  "plugin_sync_status_up_to_date",
  "plugin_sync_status_empty",
  "cast_detail_loading",
  "cast_detail_empty",
  "cast_detail_born_label",
  "cast_detail_place_of_birth",
  "cast_detail_credits",
  "cast_detail_biography",
  "cast_detail_biography_empty",
  "detail_no_cast_information",
  "detail_error_title",
  "profile_default_name",
  "profile_pin_offline_unlock_error",
  "profile_pin_needs_connection",
  "stream_current_source",
  "stream_current_source_addon",
  "action_edit",
  "action_remove",
  "common.untitled",
  "account_settings_loading",
  "account_settings_signed_out_note",
  "account_sync_overview_loading",
  "library_empty_simkl_title",
  "library_empty_simkl_subtitle",
  "collections_editor_view_mode_grid",
  "collections_editor_name_label",
  "collections_editor_backdrop_url_label",
  "collections_editor_backdrop_preview",
  "collections_editor_show_all_tab_hint",
  "collections_editor_folders_hint",
  "collections_editor_sources_one",
  "collections_editor_sources_many",
  "collections_editor_folders_empty",
  "collections_editor_cover_preview",
  "collections_editor_gif_url_label",
  "collections_editor_sources_heading",
  "collections_editor_sources_hint",
  "collections_editor_source_kind_addon",
  "collections_editor_source_tmdb_upcoming",
  "collections_editor_genre_placeholder",
  "collections_editor_trakt_list_id_hint",
  "collections_editor_sources_empty",
  "collections_editor_no_catalogs",
  "collections_editor_remove_source_confirm"
];

// Keys that already had an English string but no French one, so every French
// user saw the fallback. They must now carry a French value that actually
// differs from the English one -- copying the English text back in would
// silently undo the fix.
const NEWLY_TRANSLATED_KEYS = [
  "account_signin_welcome",
  "account_signin_welcome_sub",
  "account_signin_password_placeholder",
  "account_signin_divider",
  "account_signin_qr_action",
  "account_signin_guest_action",
  "media_connection_signing_in",
  "common.show",
  "common.hide",
  "common_back",
  "common.back",
  "common.unknown",
  "action_delete",
  "detail_description_more",
  "detail_description_less",
  "detail.addToLibrary",
  "detail.playTrailer",
  "pwa_install_title",
  "pwa_install_pitch",
  "pwa_install_action",
  "pwa_install_dismiss",
  "pwa_install_sheet_title",
  "pwa_install_sheet_body",
  "pwa_install_step_menu",
  "pwa_install_step_share",
  "pwa_install_step_add",
  "pwa_install_step_open",
  "pwa_install_confirm",
  "pwa_install_never",
  "cast_detail_known_for"
];

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

async function readStrings(localeDir) {
  const xml = await readFile(path.join(ROOT, "res", localeDir, "strings.xml"), "utf8");
  return new Map(Array.from(xml.matchAll(/<string name="([^"]+)">(.*?)<\/string>/gs), (m) => [m[1], m[2]]));
}

test("every key added by the localization pass exists in English and French", async () => {
  const [en, fr] = await Promise.all([readStrings("values"), readStrings("values-fr")]);
  for (const key of ADDED_KEYS) {
    assert.ok(en.has(key), `missing English string: ${key}`);
    assert.ok(fr.has(key), `missing French string: ${key}`);
    assert.ok(String(fr.get(key)).trim().length > 0, `empty French string: ${key}`);
  }
});

test("keys that only had a fallback now carry a real French translation", async () => {
  const [en, fr] = await Promise.all([readStrings("values"), readStrings("values-fr")]);
  for (const key of NEWLY_TRANSLATED_KEYS) {
    assert.ok(en.has(key), `missing English string: ${key}`);
    assert.ok(fr.has(key), `missing French string: ${key}`);
    assert.notEqual(fr.get(key), en.get(key), `French string is still the English text: ${key}`);
  }
});
