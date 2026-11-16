import assert from "node:assert/strict";
import test from "node:test";

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) || null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
  clear: () => values.clear()
};

const { AddonRepository } = await import("./addonRepository.js");

async function withFakeNow(now, callback) {
  const original = Date.now;
  let current = now;
  Date.now = () => current;
  try {
    return await callback({
      advance: (ms) => {
        current += ms;
      }
    });
  } finally {
    Date.now = original;
  }
}

function trackedRepository() {
  const repository = new AddonRepository();
  const calls = [];
  repository.fetchAddon = async (url) => {
    calls.push(url);
    return { status: "success", data: { baseUrl: url } };
  };
  repository.invalidateInstalledAddonsCache = () => {};
  return { repository, calls };
}

test("a cached load starts one background sweep, not one per render", async () => {
  const { repository, calls } = trackedRepository();
  repository.scheduleManifestRevalidation(["https://a", "https://b"]);
  repository.scheduleManifestRevalidation(["https://a", "https://b"]);
  repository.scheduleManifestRevalidation(["https://a", "https://b"]);
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, ["https://a", "https://b"]);
});

test("a failed sweep still waits for the next window instead of retrying every render", async () => {
  const { repository, calls } = trackedRepository();
  repository.fetchAddon = async () => ({ status: "failed" });
  await withFakeNow(1_000_000, async ({ advance }) => {
    repository.scheduleManifestRevalidation(["https://a"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    repository.scheduleManifestRevalidation(["https://a"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls.length, 0);
    advance(31 * 60 * 1000);
    let attempts = 0;
    repository.fetchAddon = async () => {
      attempts += 1;
      return { status: "success", data: {} };
    };
    repository.scheduleManifestRevalidation(["https://a"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(attempts, 1);
  });
});

test("nothing is revalidated without configured addons", () => {
  const repository = new AddonRepository();
  let called = false;
  repository.fetchAddon = async () => {
    called = true;
    return { status: "success", data: {} };
  };
  repository.scheduleManifestRevalidation([]);
  assert.equal(called, false);
});
