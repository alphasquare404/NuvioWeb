import assert from "node:assert/strict";
import test from "node:test";

const { buildChangesUrl, buildUpdateChanged } = await import("./buildUpdateNotice.js");

test("a build change needs both stamps and a different value", () => {
  assert.equal(buildUpdateChanged("build-a", "build-b"), true);
  assert.equal(buildUpdateChanged("build-a", "build-a"), false);
  assert.equal(buildUpdateChanged("", "build-b"), false);
  assert.equal(buildUpdateChanged("build-a", ""), false);
});

test("See changes compares the build the viewer had with the new one", () => {
  assert.equal(
    buildChangesUrl({
      repositoryUrl: "https://github.com/example/NuvioWeb/",
      previousCommit: "abc1234",
      currentCommit: "def5678"
    }),
    "https://github.com/example/NuvioWeb/compare/abc1234...def5678"
  );
});

test("See changes falls back to one commit and then the commit list", () => {
  assert.equal(
    buildChangesUrl({
      repositoryUrl: "https://github.com/example/NuvioWeb",
      currentCommit: "def5678"
    }),
    "https://github.com/example/NuvioWeb/commit/def5678"
  );
  assert.equal(
    buildChangesUrl({
      repositoryUrl: "https://github.com/example/NuvioWeb",
      previousCommit: "",
      currentCommit: ""
    }),
    "https://github.com/example/NuvioWeb/commits"
  );
});
