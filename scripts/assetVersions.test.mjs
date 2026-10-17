import assert from "node:assert/strict";
import test from "node:test";
import { assetBuildId, versionAssetUrls } from "./assetVersions.mjs";

const INDEX = `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="css/components.css?v=20260531supporters2" />
    <link rel="stylesheet" href="css/desktop.css?v=20260821" />
  </head>
  <body>
    <script src="app.bundle.js?v=20260531supporters2"></script>
  </body>
</html>`;

test("every frozen asset query becomes the build id, so a reload cannot reuse an old bundle", () => {
  const versioned = versionAssetUrls(INDEX, "a1b2c3d4e5f6");

  assert.match(versioned, /css\/components\.css\?v=a1b2c3d4e5f6/);
  assert.match(versioned, /css\/desktop\.css\?v=a1b2c3d4e5f6/);
  assert.match(versioned, /app\.bundle\.js\?v=a1b2c3d4e5f6/);
  assert.doesNotMatch(versioned, /20260531supporters2|20260821/);
});

test("versioning leaves the rest of the document untouched", () => {
  const versioned = versionAssetUrls(INDEX, "a1b2c3d4e5f6");

  assert.equal(
    versioned.replace(/\?v=[A-Za-z0-9._-]+/g, ""),
    INDEX.replace(/\?v=[A-Za-z0-9._-]+/g, "")
  );
});

test("a second build id replaces the first instead of stacking", () => {
  const once = versionAssetUrls(INDEX, "aaaaaaaaaaaa");
  const twice = versionAssetUrls(once, "bbbbbbbbbbbb");

  assert.match(twice, /app\.bundle\.js\?v=bbbbbbbbbbbb/);
  assert.doesNotMatch(twice, /aaaaaaaaaaaa/);
});

test("versioning refuses to run without a build id", () => {
  assert.throws(() => versionAssetUrls(INDEX, ""), /build id is required/i);
  assert.throws(() => versionAssetUrls(INDEX, "   "), /build id is required/i);
});

test("the build id follows the bundle contents, not the clock", () => {
  const first = assetBuildId(Buffer.from("bundle one"));
  const second = assetBuildId(Buffer.from("bundle one"));
  const changed = assetBuildId(Buffer.from("bundle two"));

  assert.equal(first, second);
  assert.notEqual(first, changed);
  assert.match(first, /^[0-9a-f]{12}$/);
});

test("asking for a build id of nothing is an error, not a silent stale cache", () => {
  assert.throws(() => assetBuildId(undefined), /contents of the built bundle/i);
});
