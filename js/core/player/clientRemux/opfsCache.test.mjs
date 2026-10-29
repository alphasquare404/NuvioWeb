import test from "node:test";
import assert from "node:assert/strict";
import { OpfsCache } from "./opfsCache.mjs";
class Directory {
  constructor() {
    this.items = new Map();
  }
  async getDirectoryHandle(name, { create = false } = {}) {
    if (!this.items.has(name) && create) this.items.set(name, new Directory());
    const value = this.items.get(name);
    if (!(value instanceof Directory)) throw new DOMException("missing", "NotFoundError");
    return value;
  }
  async getFileHandle(name) {
    const data = this.items.get(name);
    if (!(data instanceof Uint8Array)) throw new DOMException("missing", "NotFoundError");
    return { getFile: async () => new Blob([data]) };
  }
  async removeEntry(name) {
    if (!this.items.delete(name)) throw new DOMException("missing", "NotFoundError");
  }
  async *keys() {
    yield* this.items.keys();
  }
}
function platform() {
  const root = new Directory();
  let held = false;
  return {
    root,
    storage: {
      getDirectory: async () => root,
      estimate: async () => ({ quota: 8 * 1024 ** 3, usage: 0 })
    },
    locks: {
      async request(_name, _opts, callback) {
        if (held) return callback(null);
        held = true;
        try {
          return await callback({});
        } finally {
          held = false;
        }
      }
    }
  };
}
async function commit(c, id, kind, bytes, seq = 0) {
  const entry = {
    id,
    runId: "run",
    kind,
    bytes,
    seq,
    timing: {
      video: [[seq * 10, seq * 10 + 10]],
      audio: [[seq * 10, seq * 10 + 10]],
      randomAccessPoints: [seq * 10],
      reorderGuardSeconds: 0.1
    }
  };
  assert.ok(await c.reserve(entry));
  const run = await c.dir.getDirectoryHandle("run");
  run.items.set(id + ".bin", new Uint8Array(bytes));
  return c.commit(id);
}
test("one cache owner, safe stale cleanup and close do not delete other storage", async () => {
  const p = platform();
  p.root.items.set("offline-downloads", new Directory());
  const v = await (
    await p.root.getDirectoryHandle("nuvio-remux-cache", { create: true })
  ).getDirectoryHandle("v1", { create: true });
  v.items.set("stale-session", new Directory());
  const c = await OpfsCache.open(p.storage, p.locks);
  assert.equal(c.enabled, true);
  assert.equal(v.items.has("stale-session"), false);
  await c.createRun("run");
  c.setInfo("run", { duration: 30, mime: "video/mp4" });
  await commit(c, "init", "init", 10);
  const second = await OpfsCache.open(p.storage, p.locks);
  assert.equal(second.reason, "another-tab");
  assert.equal(c.index.bytes, 10);
  await c.close();
  assert.equal(v.items.size, 0);
  assert.ok(p.root.items.has("offline-downloads"));
  const third = await OpfsCache.open(p.storage, p.locks);
  assert.equal(third.enabled, true);
  await third.close();
});
test("only closed size-validated files commit; cancellation releases pending reservations", async () => {
  const p = platform(),
    c = await OpfsCache.open(p.storage, p.locks);
  await c.createRun("run");
  await c.reserve({ id: "partial", runId: "run", kind: "init", bytes: 100 });
  assert.equal(c.stats().cacheReservedBytes, 100);
  const run = await c.dir.getDirectoryHandle("run");
  run.items.set("partial.bin", new Uint8Array(99));
  await assert.rejects(c.commit("partial"), /invalid/);
  assert.equal(c.index.entries.size, 0);
  await c.finishRun("run");
  assert.equal(c.stats().cacheReservedBytes, 0);
  assert.equal(c.index.entries.size, 0);
  await c.close();
});
test("LRU evicts unpinned media before admitting a write; a reader remains valid", async () => {
  const p = platform(),
    c = await OpfsCache.open(p.storage, p.locks);
  c.index.limit = 350;
  await c.createRun("run");
  c.setInfo("run", { duration: 30 });
  await commit(c, "init", "init", 50);
  await commit(c, "one", "media", 100, 0);
  c.unpin("one");
  await commit(c, "two", "media", 100, 1);
  assert.ok(
    await c.reserve({
      id: "three",
      runId: "run",
      kind: "media",
      bytes: 150,
      seq: 2,
      timing: {
        video: [[20, 30]],
        audio: [[20, 30]],
        randomAccessPoints: [20],
        reorderGuardSeconds: 0.1
      }
    })
  );
  assert.equal(c.index.entries.has("one"), false);
  assert.equal(c.index.entries.has("two"), true);
  assert.equal((await c.file(c.index.entries.get("two"))).size, 100);
  assert.ok(c.index.bytes + c.index.reserved <= 350);
  await c.finishRun("run");
  await c.close();
});
test("missing capabilities or small quota preserve the non-cache fallback", async () => {
  const p = platform();
  assert.equal((await OpfsCache.open(p.storage, {})).reason, "locks-unavailable");
  const low = await OpfsCache.open(
    { ...p.storage, estimate: async () => ({ quota: 100, usage: 0 }) },
    p.locks
  );
  assert.equal(low.enabled, false);
  assert.equal(low.reason, "quota-too-small");
  const c = await OpfsCache.open(p.storage, p.locks);
  assert.equal(c.enabled, true);
  await c.close();
});

test("host cache cap is a disk limit; zero and insufficient free space disable only warm caching", async () => {
  for (const cap of [0, 64, 128, 256, 512]) {
    const p = platform(),
      cache = await OpfsCache.open(p.storage, p.locks, cap * 1024 ** 2);
    try {
      assert.equal(cache.enabled, cap >= 128);
      if (cache.enabled) assert.equal(cache.index.limit, cap * 1024 ** 2);
    } finally {
      await cache.close();
    }
  }
  const p = platform(),
    cache = await OpfsCache.open(
      { ...p.storage, estimate: async () => ({ quota: 800 * 1024 ** 2, usage: 0 }) },
      p.locks,
      512 * 1024 ** 2
    );
  assert.equal(cache.index.limit, 200 * 1024 ** 2);
  await cache.close();
});
