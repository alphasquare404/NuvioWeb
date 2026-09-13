import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function readRepositoryFile(path) {
  return readFile(new URL(path, root), "utf8");
}

function metadataTagBlocks(workflow) {
  return [...workflow.matchAll(/id: (?:frontend|trakt|debrid|external-return)-meta[\s\S]*?tags: \|\r?\n((?:\s+type=.*\r?\n)+)/g)].map((match) =>
    match[1]
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

test("GHCR publishing separates web development and release channels consistently", async () => {
  const workflow = await readRepositoryFile(".github/workflows/publish-ghcr.yml");

  assert.match(workflow, /branches:\s*\n\s*- web/);
  assert.match(workflow, /tags:\s*\n\s*- "v\*"/);
  assert.doesNotMatch(workflow, /branches:\s*\n\s*- main/);
  assert.doesNotMatch(workflow, /branches:\s*\n\s*- desktop/);
  assert.doesNotMatch(workflow, /type=raw,value=web/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/web'/);
  const tagBlocks = metadataTagBlocks(workflow);
  const expectedTags = [
    "type=raw,value=nightly,enable=${{ github.ref == 'refs/heads/web' }}",
    "type=raw,value=latest",
    "type=raw,value=desktop",
    "type=raw,value=stable,enable=${{ startsWith(github.ref, 'refs/tags/v') }}",
    "type=semver,pattern={{version}},enable=${{ startsWith(github.ref, 'refs/tags/v') }}",
    "type=sha,format=short,prefix=sha-",
  ];

  assert.equal(tagBlocks.length, 4);
  assert.deepEqual(tagBlocks, [expectedTags, expectedTags, expectedTags, expectedTags]);
  assert.match(workflow, /steps\.frontend-meta\.outputs\.tags/);
  assert.match(workflow, /steps\.trakt-meta\.outputs\.tags/);
  assert.match(workflow, /steps\.debrid-meta\.outputs\.tags/);
  assert.match(workflow, /steps\.external-return-meta\.outputs\.tags/);
});

test("Compose defaults every production service to stable without a tag environment variable", async () => {
  const compose = await readRepositoryFile("docker-compose.yml");

  assert.match(compose, /ghcr\.io\/alphasquare404\/nuvioweb:stable/);
  assert.match(compose, /ghcr\.io\/alphasquare404\/nuvioweb-trakt-auth-bridge:stable/);
  assert.match(compose, /ghcr\.io\/alphasquare404\/nuvioweb-debrid-api-bridge:stable/);
  assert.match(compose, /ghcr\.io\/alphasquare404\/nuvioweb-external-return-bridge:stable/);
  assert.doesNotMatch(compose, /NUVIO_TAG/);
});

test("Docker Quick Deploy documents hosted defaults and server-only Trakt configuration", async () => {
  const [environmentTemplate, readme, environmentDocs] = await Promise.all([
    readRepositoryFile(".env.example"),
    readRepositoryFile("README.md"),
    readRepositoryFile("docs/environment.md"),
  ]);
  const dockerSection = readme.split("## Self-host with Docker", 2)[1];

  assert.match(environmentTemplate, /NUVIO_SUPABASE_URL=https:\/\/api\.nuvio\.tv/);
  assert.match(environmentTemplate, /NUVIO_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1Ni/);
  assert.match(environmentTemplate, /NUVIO_SUPABASE_FALLBACK_URL=https:\/\/api-two\.nuvioapp\.space/);
  assert.match(environmentTemplate, /TRAKT_CLIENT_SECRET=/);
  assert.match(environmentTemplate, /Server-only Trakt bridge values/);
  assert.doesNotMatch(environmentTemplate, /service[_-]?role/i);
  assert.match(readme, /### Quick Deploy with Docker/);
  assert.match(readme, /raw\.githubusercontent\.com\/alphasquare404\/NuvioWeb\/web\/docker-compose\.yml/);
  assert.match(readme, /raw\.githubusercontent\.com\/alphasquare404\/NuvioWeb\/web\/\.env\.example/);
  assert.match(readme, /docs\/environment\.md/);
  assert.doesNotMatch(dockerSection, /git clone/);
  assert.match(environmentDocs, /Frontend-only self-hosting \(recommended\)/);
  assert.match(environmentDocs, /Full self-hosting \(advanced\)/);
  assert.match(environmentDocs, /TRAKT_CLIENT_SECRET.*Server-only/s);
});
