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

  assert.doesNotMatch(source, /isDesktopDebridComingSoon|Desktop browser support is coming soon|Coming Soon/);
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
  assert.match(source, /result\.status === DEBRID_DEVICE_AUTH_STATUS\.PENDING\) \{\s*this\.scheduleDebridDeviceAuthPoll\(nonce\)/);
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
  assert.match(source, /this\.refreshDebridDeviceAuthDialog\(\);\s*await this\.render\(\{ refreshModel: false \}\)/);
});

test("About renders independent fork identity and quiet community fallbacks", async () => {
  const source = await settingsScreenSource();

  assert.match(source, /Version \$\{escapeHtml\(APP_IDENTITY\.version\)\}/);
  assert.match(source, /Based on Nuvio \$\{escapeHtml\(APP_IDENTITY\.upstreamVersion\)\}/);
  assert.match(source, /Maintained by \$\{escapeHtml\(APP_IDENTITY\.maintainer\)\}/);
  assert.match(source, /Independent community fork\. Not affiliated with or endorsed by NuvioMedia\./);
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
  assert.match(desktopCss, /settings-playback-external-player-row \{\s*align-items: stretch;\s*flex-wrap: wrap;/);
  assert.match(desktopCss, /settings-playback-external-player-row \.settings-row-copy \{\s*flex-basis: 100%;/);
  assert.doesNotMatch(desktopCss, /settings-playback-external-player-row\.settings-toggle-row/);
});
