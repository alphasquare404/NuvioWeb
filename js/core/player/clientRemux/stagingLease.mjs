import { removeOwned } from "./opfsCache.mjs";
const prefix = "nuvio-remux-staging-";
export async function holdStaging(id) {
  const locks = globalThis.navigator?.locks;
  if (!locks?.request) return { release() {}, finished: () => Promise.resolve() };
  return new Promise((resolve, reject) => {
    let release;
    const held = new Promise((r) => (release = r));
    const finished = locks.request(prefix + id, { ifAvailable: true }, async (lock) => {
      if (!lock) throw Error("staging-in-use");
      resolve({ release, finished: () => finished });
      await held;
    });
    finished.catch(reject);
  });
}
export async function cleanOrphanStaging() {
  const locks = globalThis.navigator?.locks;
  if (!locks?.request) return;
  const root = await navigator.storage.getDirectory(),
    dir = await root.getDirectoryHandle("nuvio-remux-staging", { create: true });
  for await (const name of dir.keys()) {
    if (!/^[a-z0-9-]{1,80}$/.test(name)) continue;
    await locks.request(prefix + name, { ifAvailable: true }, async (lock) => {
      if (lock) await removeOwned(dir, name);
    });
  }
}
