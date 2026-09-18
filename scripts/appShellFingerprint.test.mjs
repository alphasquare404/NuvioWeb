import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { appShellFingerprint } from "./appShellFingerprint.mjs";

test("app-shell cache changes when assets change without a version bump", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "nuvio-shell-"));
  try {
    await mkdir(path.join(directory, "css"));
    await writeFile(path.join(directory, "app.bundle.js"), "original");
    const original = await appShellFingerprint(directory);
    assert.equal(await appShellFingerprint(directory), original);
    await writeFile(path.join(directory, "css", "desktop.css"), "mobile fix");
    const styled = await appShellFingerprint(directory);
    assert.notEqual(styled, original);
    await writeFile(path.join(directory, "app.bundle.js"), "playback fix");
    const updated = await appShellFingerprint(directory);
    assert.notEqual(updated, styled);
    await writeFile(path.join(directory, "sw.js"), "worker");
    assert.equal(await appShellFingerprint(directory), updated);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
