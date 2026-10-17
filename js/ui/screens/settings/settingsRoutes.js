// Settings is two pages, the way Search and Discover are two pages: the index
// is its own route, and choosing a section opens a section of its own. Nothing
// here changes the address bar -- the router never writes a path -- but Back is
// the browser's own Back again, because a route was pushed for it to pop.

export const SETTINGS_ROUTE = "settings";
export const SETTINGS_SECTION_ROUTE = "settingsSection";

/**
 * Which section the section page is showing, or null for the index page.
 *
 * An unknown or empty section falls back to the index rather than to a blank
 * page, so a stale entry in the persisted UI state can never open a page with
 * nothing on it.
 */
export function readSettingsRouteSection(routeName, params) {
  if (String(routeName || "") !== SETTINGS_SECTION_ROUTE) {
    return null;
  }
  const section = String(params?.section || "").trim();
  return section || null;
}
