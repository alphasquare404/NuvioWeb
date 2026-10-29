import { CacheIndex, cacheBudget } from "./cacheIndex.mjs";
const namespace = "nuvio-remux-cache",
  lockName = "nuvio-remux-cache-v1";
export async function removeOwned(parent, name) {
  if (!/^[a-z0-9-]{1,80}(?:\.bin)?$/.test(name)) throw Error("cache-path-invalid");
  for (let i = 0; i < 10; i++) {
    try {
      await parent.removeEntry(name, { recursive: true });
      return;
    } catch (e) {
      if (e.name === "NotFoundError") return;
      if (i === 9) throw e;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}
async function acquire(locks) {
  if (typeof locks?.request !== "function") return null;
  return new Promise((resolve) => {
    let release;
    const held = new Promise((r) => (release = r));
    const finished = locks
      .request(lockName, { ifAvailable: true }, async (lock) => {
        resolve(lock ? { release, finished: () => finished } : null);
        if (lock) await held;
      })
      .catch(() => resolve(null));
  });
}
export class OpfsCache {
  constructor() {
    this.enabled = false;
    this.reason = "unavailable";
    this.index = new CacheIndex(0);
    this.activeRuns = new Map();
    this.tail = Promise.resolve();
    this.closed = false;
  }
  static async open(
    storage = globalThis.navigator?.storage,
    locks = globalThis.navigator?.locks,
    maxBytes = 512 * 1024 * 1024
  ) {
    const c = new OpfsCache();
    let lease;
    try {
      lease = await acquire(locks);
      if (!lease) {
        c.reason = typeof locks?.request === "function" ? "another-tab" : "locks-unavailable";
        return c;
      }
      c.lease = lease;
      c.root = await storage.getDirectory();
      const owned = await c.root.getDirectoryHandle(namespace, { create: true });
      c.version = await owned.getDirectoryHandle("v1", { create: true });
      for await (const name of c.version.keys()) await removeOwned(c.version, name);
      const budget = Math.min(cacheBudget(await storage.estimate()), maxBytes);
      if (budget < 128 * 1024 * 1024) {
        c.reason = "quota-too-small";
        await c.release();
        return c;
      }
      c.id = crypto.randomUUID();
      c.dir = await c.version.getDirectoryHandle(c.id, { create: true });
      c.index = new CacheIndex(budget);
      c.enabled = true;
      c.reason = null;
    } catch {
      c.reason = "storage-unavailable";
      await c.release();
    }
    return c;
  }
  serial(fn) {
    const next = this.tail.then(fn);
    this.tail = next.catch(() => {});
    return next;
  }
  async release() {
    this.lease?.release();
    await this.lease?.finished();
    this.lease = null;
  }
  async createRun(runId) {
    if (!this.enabled || this.closed) return false;
    await this.dir.getDirectoryHandle(runId, { create: true });
    this.activeRuns.set(runId, null);
    return true;
  }
  setInfo(runId, info) {
    if (this.activeRuns.has(runId)) this.activeRuns.set(runId, structuredClone(info));
  }
  info(runId) {
    return (
      this.activeRuns.get(runId) ||
      [...this.index.entries.values()].find((e) => e.runId === runId && e.kind === "init")?.info
    );
  }
  eof(runId) {
    const e = [...this.index.entries.values()].find((e) => e.runId === runId && e.kind === "init");
    if (e) e.eof = true;
  }
  async file(entry) {
    const run = await this.dir.getDirectoryHandle(entry.runId),
      handle = await run.getFileHandle(`${entry.id}.bin`);
    const file = await handle.getFile();
    if (file.size !== entry.bytes) throw Error("cache-file-invalid");
    return file;
  }
  async erase(entry) {
    if (entry.pins || entry.deleting) throw Error("cache-entry-pinned");
    entry.deleting = true;
    try {
      const run = await this.dir.getDirectoryHandle(entry.runId);
      await removeOwned(run, `${entry.id}.bin`);
      this.index.remove(entry.id);
    } catch (e) {
      if (e.name !== "NotFoundError") throw e;
      this.index.remove(entry.id);
    } finally {
      entry.deleting = false;
    }
  }
  evictUnpinned() {
    return this.serial(async () => {
      for (const e of [...this.index.entries.values()].filter((e) => !e.pins && e.kind === "media"))
        await this.erase(e);
    });
  }
  reserve(value) {
    return this.serial(async () => {
      if (!this.enabled || this.closed || !this.activeRuns.has(value.runId)) return false;
      const e = this.index.descriptor({
        ...value,
        info: value.kind === "init" ? this.info(value.runId) : undefined
      });
      while (!this.index.fits(e)) {
        const victim = this.index.victim();
        if (!victim) return false;
        await this.erase(victim);
        this.index.evictions++;
      }
      return this.index.reserve(e);
    });
  }
  commit(id) {
    return this.serial(async () => {
      const e = this.index.pending.get(id);
      if (!e || this.closed || !this.activeRuns.has(e.runId)) throw Error("cache-job-cancelled");
      await this.file(e);
      const committed = this.index.commit(id);
      // Protect each queued file until the player acknowledges its bounded read.
      this.index.pin(id);
      return committed;
    });
  }
  discard(id) {
    return this.serial(async () => {
      const e = this.index.pending.get(id) || this.index.entries.get(id);
      if (!e) return;
      if (e.pins) throw Error("cache-entry-pinned");
      await this.erase(e);
    });
  }
  async finishRun(runId) {
    this.activeRuns.delete(runId);
    await this.serial(async () => {
      for (const e of [...this.index.pending.values()].filter((e) => e.runId === runId))
        await this.erase(e);
      // Unacknowledged messages from a terminated job must not keep cache pins.
      for (const e of this.index.entries.values()) if (e.runId === runId) e.pins = 0;
      if (![...this.index.entries.values()].some((e) => e.runId === runId && e.kind === "media")) {
        for (const e of [...this.index.entries.values()].filter((e) => e.runId === runId))
          await this.erase(e);
        if (this.dir) await removeOwned(this.dir, runId);
      }
    });
  }
  lookup(time) {
    return this.closed ? null : this.index.lookup(time);
  }
  async invalidateRun(runId) {
    await this.serial(async () => {
      for (const e of [...this.index.entries.values()].filter((e) => e.runId === runId)) {
        if (e.pins) throw Error("cache-entry-pinned");
        await this.erase(e);
      }
    });
  }
  pin(id) {
    return this.index.pin(id);
  }
  unpin(id) {
    this.index.unpin(id);
  }
  stats() {
    return {
      cacheEnabled: this.enabled,
      cacheDisabledReason: this.reason,
      cacheBytes: this.index.bytes,
      cacheReservedBytes: this.index.reserved,
      cachePinnedBytes: [...this.index.entries.values()]
        .filter((e) => e.pins)
        .reduce((n, e) => n + e.bytes, 0),
      cacheLimitBytes: this.index.limit,
      cacheMetadataBytes: this.index.metadataBytes,
      cacheUnits: this.index.entries.size,
      cacheEvictions: this.index.evictions
    };
  }
  disable(reason) {
    this.enabled = false;
    this.reason = reason;
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.enabled = false;
    await this.tail;
    if (this.dir) await removeOwned(this.version, this.id);
    this.index = new CacheIndex(0);
    this.activeRuns.clear();
    await this.release();
  }
}
