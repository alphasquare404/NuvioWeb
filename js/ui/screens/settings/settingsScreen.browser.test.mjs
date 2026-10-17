import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const settingsScreenUrl = new URL("./settingsScreen.js", import.meta.url);
const desktopCssUrl = new URL("../../../../css/desktop.css", import.meta.url);

async function settingsScreenSource() {
  return readFile(settingsScreenUrl, "utf8");
}

test("browser Connected Services keeps visible Device Code providers actionable", async () => {
  const source = await settingsScreenSource();

  assert.doesNotMatch(
    source,
    /isDesktopDebridComingSoon|Desktop browser support is coming soon|Coming Soon/
  );
  assert.match(
    source,
    /this\.actionMap\.set\(`integration:debrid:key:\$\{provider\.id\}`, \(\) => \{\s*if \(provider\.authMethod === DEBRID_AUTH_METHODS\.DEVICE_CODE\) \{\s*this\.openDebridDeviceAuthDialog\(provider\);/
  );
  assert.match(
    source,
    /provider\.authMethod === DEBRID_AUTH_METHODS\.DEVICE_CODE\s*\? t\(\s*"debrid_provider_device_description"/
  );
  assert.match(source, /icon: "chevron"/);
  assert.doesNotMatch(source, /disabled:\s*comingSoon/);
});

test("Connected Services retains credential-gated Cloud Library and resolver toggles", async () => {
  const source = await settingsScreenSource();

  assert.match(source, /const hasResolverProvider = Boolean\(activeResolverProvider\);/);
  assert.match(source, /disabled: !hasResolverProvider/);
  assert.match(source, /const hasCloudLibraryProvider = configuredProviders\.some/);
  assert.match(source, /disabled: !hasCloudLibraryProvider/);
  assert.match(source, /DebridSettingsStore\.setProviderApiKey\(state\.provider\.id, ""\)/);
});

test("Settings only renders visible debrid providers, keeping Real-Debrid hidden", async () => {
  const source = await settingsScreenSource();

  assert.match(source, /const providers = DebridProviders\.visible\(\);/);
});

test("device authorization polls at the provider interval, retries pending, and expires before another redeem", async () => {
  const source = await settingsScreenSource();

  assert.match(source, /intervalSeconds \|\| 5/);
  assert.match(
    source,
    /result\.status === DEBRID_DEVICE_AUTH_STATUS\.PENDING\) \{\s*this\.scheduleDebridDeviceAuthPoll\(nonce\)/
  );
  assert.match(source, /isDeviceAuthorizationExpired\(state\.session\.expiresAt\)/);
  assert.match(source, /this\.debridAuthDialog\.status = "expired"/);
});

test("Device Code dialog renders shared copy and trusted-link actions only while waiting", async () => {
  const source = await settingsScreenSource();

  assert.match(source, /state\.status === "waiting" && state\.session/);
  assert.match(source, /data-debrid-auth-action="copy" aria-label="Copy device code"/);
  assert.match(source, /data-debrid-auth-action="open" aria-label="Open verification link"/);
  assert.match(source, /copyDeviceAuthorizationCode\(currentState\.session\.userCode\)/);
  assert.match(source, /openDeviceAuthorizationLink\(/);
  assert.match(
    source,
    /this\.refreshDebridDeviceAuthDialog\(\);\s*await this\.render\(\{ refreshModel: false \}\)/
  );
});

test("About renders independent fork identity and quiet community fallbacks", async () => {
  const source = await settingsScreenSource();

  assert.match(source, /Version \$\{escapeHtml\(APP_IDENTITY\.version\)\}/);
  assert.match(source, /Based on Nuvio \$\{escapeHtml\(APP_IDENTITY\.upstreamVersion\)\}/);
  assert.match(source, /Maintained by \$\{escapeHtml\(APP_IDENTITY\.maintainer\)\}/);
  assert.match(
    source,
    /Independent community fork\. Not affiliated with or endorsed by NuvioMedia\./
  );
  assert.match(source, /title: "View Contributors on GitHub"/);
  assert.match(source, /hasDesktopSupporterSource\(\)/);
  assert.doesNotMatch(source, /Contributors API is not configured\.|Unable to load supporters\./);
});

test("mobile Playback selector rows preserve full-width copy while toggles retain their normal row", async () => {
  const [source, desktopCss] = await Promise.all([
    settingsScreenSource(),
    readFile(desktopCssUrl, "utf8")
  ]);

  assert.match(source, /classes: "settings-playback-external-player-row"/);
  assert.match(
    desktopCss,
    /settings-playback-external-player-row \{\s*align-items: stretch;\s*flex-wrap: wrap;/
  );
  assert.match(
    desktopCss,
    /settings-playback-external-player-row \.settings-row-copy \{\s*flex-basis: 100%;/
  );
  assert.doesNotMatch(desktopCss, /settings-playback-external-player-row\.settings-toggle-row/);
});

test("Back in browser Settings is the browser's own, one route at a time", async () => {
  // Settings is two routes in the browser: the index, and the section opened
  // from it. Back is a route pop, so the screen must not swallow it and must
  // not close the section by hand any more.
  const source = await settingsScreenSource();

  assert.match(
    source,
    /consumeBackRequest\(\)\s*\{[\s\S]*?if \(settingsUsesRoutePages\(\)\) \{\s*return false;\s*\}/
  );
  assert.doesNotMatch(source, /settingsUsesTouchNav/);
  assert.doesNotMatch(source, /closeSectionToIndex/);
  assert.match(source, /Router\.navigate\(SETTINGS_SECTION_ROUTE, \{ section: id \}\)/);
});

test("the section page carries the same floating back control as every other screen", async () => {
  const source = await settingsScreenSource();
  const desktopCss = await readFile(desktopCssUrl, "utf8");

  // Painted by the shared rule that lists Detail, Stream, Player and the rest,
  // and wired to the same thing the browser's Back does.
  assert.match(source, /class="settings-section-back focusable"[\s\S]*?data-settings-back/);
  assert.match(source, /closest\?\.\("\[data-settings-back\]"\)[\s\S]*?Router\.back\(\)/);
  assert.match(desktopCss, /\.desktop-browser \.settings-shell \.settings-section-back/);
});

test("hovering a Settings row lights it without changing its box", async () => {
  const desktopCss = await readFile(desktopCssUrl, "utf8");

  // Every row on the index page is a settings-nav-item, the account card
  // included; the rule is written for the page, not per group, or the account
  // row has no hover at all. A hover border would resize a row under the
  // pointer, so hover is a tint only.
  const hoverRule = desktopCss.match(
    /\.settings-shell\[data-settings-nav-mode="index"\][\s\S]{0,80}?\.settings-nav-item:hover \{([\s\S]*?)\}/
  );

  assert.ok(hoverRule, "the index rows need a hover rule of their own");
  assert.match(hoverRule[1], /background: var\(--focus-bg\);/);
  assert.match(hoverRule[1], /color: var\(--text-color\);/);
  assert.doesNotMatch(hoverRule[1], /border|outline|font-weight|transform/);
});

test("each Settings route owns its own screen instance", async () => {
  // The router suspends the page it navigates away from and restores it on
  // Back. Two routes sharing one screen object meant the restored index was
  // drawn into the section's container with the section's state: dead rows, a
  // missing focus, and clicks that did nothing.
  const source = await settingsScreenSource();
  const routerSource = await readFile(
    new URL("../../navigation/router.js", import.meta.url),
    "utf8"
  );

  assert.match(
    source,
    /export const SettingsSectionScreen =\s*createScreenPrototype\(SettingsScreen\)/
  );
  assert.match(routerSource, /settingsSection: SettingsSectionScreen/);
});

test("each Settings container binds its own listeners, so both pages stay clickable", async () => {
  // A "bound once" flag on the screen object marked the first page done and
  // left the other without a click handler: every control there did nothing.
  const source = await settingsScreenSource();

  assert.match(source, /this\.container\.__settingsListeners/);
  assert.match(source, /addEventListener\("click", listeners\.click\)/);
  assert.doesNotMatch(source, /this\.handleClickBound/);
  assert.doesNotMatch(source, /this\.handleWheelBound/);
});

test("the gap before Advanced belongs to its group, not to the row inside the card", async () => {
  // Written on the row, the gap sat inside the group's card and left a band
  // above the highlighted row instead of space between two groups.
  const desktopCss = await readFile(desktopCssUrl, "utf8");

  assert.match(
    desktopCss,
    /\.settings-nav-group:has\(\.settings-nav-item\[data-section="advanced"\]\) \{\s*margin-top: 14px;/
  );
  assert.doesNotMatch(desktopCss, /\.settings-nav-item\[data-section="advanced"\] \{\s*margin-top/);
});
