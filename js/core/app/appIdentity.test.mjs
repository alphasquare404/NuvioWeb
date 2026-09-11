import assert from "node:assert/strict";
import test from "node:test";
import { createAppIdentity } from "./appIdentity.js";

test("app identity preserves fork provenance while using fork-owned links", () => {
  const identity = createAppIdentity({
    name: "NuvioWeb",
    version: "0.1.0",
    upstreamVersion: "0.3.35",
    maintainer: "alphasquare",
    sourceRepositoryUrl: "https://github.com/alphasquare404/NuvioWeb",
    issuesUrl: "https://github.com/alphasquare404/NuvioWeb/issues",
    contributorsUrl: "https://github.com/alphasquare404/NuvioWeb/graphs/contributors",
    licenseUrl: "https://github.com/alphasquare404/NuvioWeb/blob/main/LICENSE",
    upstreamRepositoryUrl: "https://github.com/NuvioMedia/NuvioWeb",
    latestReleaseUrl: "https://api.github.com/repos/alphasquare404/NuvioWeb/releases/latest"
  });

  assert.equal(identity.version, "0.1.0");
  assert.equal(identity.upstreamVersion, "0.3.35");
  assert.equal(identity.maintainer, "alphasquare");
  assert.equal(identity.sourceRepositoryUrl, "https://github.com/alphasquare404/NuvioWeb");
  assert.equal(identity.contributorsUrl, "https://github.com/alphasquare404/NuvioWeb/graphs/contributors");
  assert.equal(identity.upstreamRepositoryUrl, "https://github.com/NuvioMedia/NuvioWeb");
});

test("app identity rejects non-HTTPS runtime links", () => {
  const identity = createAppIdentity({ sourceRepositoryUrl: "javascript:alert(1)" });
  assert.equal(identity.sourceRepositoryUrl, "https://github.com/alphasquare404/NuvioWeb");
});
