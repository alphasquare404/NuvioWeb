import assert from "node:assert/strict";
import test from "node:test";
import { readAppMetadata } from "./appMetadata.mjs";

test("application metadata supplies the independent fork version and repository identity", async () => {
  const metadata = await readAppMetadata();

  assert.equal(metadata.version, "0.1.2");
  assert.equal(metadata.identity.upstreamVersion, "0.3.35");
  assert.equal(metadata.identity.maintainer, "alphasquare");
  assert.equal(metadata.identity.sourceRepositoryUrl, "https://github.com/alphasquare404/NuvioWeb");
  assert.equal(metadata.identity.issuesUrl, "https://github.com/alphasquare404/NuvioWeb/issues");
  assert.equal(
    metadata.identity.latestReleaseUrl,
    "https://api.github.com/repos/alphasquare404/NuvioWeb/releases/latest"
  );
});
