import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const settingsScreenUrl = new URL("./settingsScreen.js", import.meta.url);

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
