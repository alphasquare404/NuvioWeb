import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function readRepositoryFile(path) {
  return readFile(new URL(path, root), "utf8");
}

test("GHCR publishing uses main and v tags with consistent release aliases", async () => {
  const workflow = await readRepositoryFile(".github/workflows/publish-ghcr.yml");

  assert.match(workflow, /branches:\s*\n\s*- main/);
  assert.match(workflow, /tags:\s*\n\s*- "v\*"/);
  assert.doesNotMatch(workflow, /branches:\s*\n\s*- desktop/);
  assert.match(workflow, /type=raw,value=latest/);
  assert.match(workflow, /type=raw,value=desktop/);
  assert.match(workflow, /type=semver,pattern=\{\{version\}\}/);
  assert.match(workflow, /type=sha,format=short,prefix=sha-/);
  assert.match(workflow, /steps\.frontend-meta\.outputs\.tags/);
  assert.match(workflow, /steps\.trakt-meta\.outputs\.tags/);
  assert.match(workflow, /steps\.debrid-meta\.outputs\.tags/);
});

test("Compose pins every production service to the same 0.1.0 release", async () => {
  const compose = await readRepositoryFile("docker-compose.yml");

  assert.match(compose, /ghcr\.io\/alphasquare404\/nuvioweb:0\.1\.0/);
  assert.match(compose, /ghcr\.io\/alphasquare404\/nuvioweb-trakt-auth-bridge:0\.1\.0/);
  assert.match(compose, /ghcr\.io\/alphasquare404\/nuvioweb-debrid-api-bridge:0\.1\.0/);
  assert.doesNotMatch(compose, /ghcr\.io\/alphasquare404\/nuvioweb(?:-trakt-auth-bridge|-debrid-api-bridge)?:desktop/);
});
