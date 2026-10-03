import assert from "node:assert/strict";
import test from "node:test";

// Two devices sharing one cloud, running the real sync service rather than the
// merge alone. The reconciliation rules were only ever exercised as pure
// functions, and every question left about them -- whether a completion made on
// one device retires a partial left on the other, whether a rewatch survives,
// whether either depends on the devices' clocks agreeing -- is about the round
// trip through baselines, push signatures and deletions, not about the merge in
// isolation. Answering those by hand meant staging an offline session across two
// physical devices for each one.
//
// The seams are `fetch` and `localStorage`. Both are read per call, so a device
// is a storage map plus its own module instance, and the cloud is a Map.

function createStorage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear()
  };
}

function createCloud() {
  const progress = new Map();
  const watched = new Map();
  // Keyed the way the rows identify themselves, so what comes back out is what
  // went in -- the contract each mapper has to satisfy anyway.
  const watchedKey = (item) =>
    [item.content_id ?? item.contentId, item.season ?? "", item.episode ?? ""].join("::");
  return {
    progress,
    watched,
    handle(procedure, body) {
      if (procedure === "sync_push_watch_progress") {
        (body?.p_entries || []).forEach((entry) => progress.set(entry.progress_key, entry));
        return [];
      }
      if (procedure === "sync_pull_watch_progress") return [...progress.values()];
      if (procedure === "sync_delete_watch_progress") {
        (body?.p_keys || body?.p_progress_keys || []).forEach((key) => progress.delete(key));
        return [];
      }
      if (procedure === "sync_push_watched_items") {
        (body?.p_items || []).forEach((item) => watched.set(watchedKey(item), item));
        return [];
      }
      if (procedure === "sync_pull_watched_items") return [...watched.values()];
      if (procedure === "sync_delete_watched_items") {
        (body?.p_items || body?.p_keys || []).forEach((item) =>
          watched.delete(typeof item === "string" ? item : watchedKey(item))
        );
        return [];
      }
      return [];
    }
  };
}

const PROFILE_ID = "1";

// Cloud syncs are queued on timers, so some of a device's work lands after its
// turn is over. A standing default keeps that from throwing on its way out.
globalThis.localStorage = createStorage();

// `reopen` gives a device a fresh module instance over the storage it already
// has: the app being closed and opened again. It matters because the guards that
// stop a needless push live in module state and do not survive that, while the
// stored baseline does.
async function createDevice(name, cloud, { reopen = null } = {}) {
  const storage = reopen ? reopen.storage : createStorage();
  // A cache-busting specifier gives this device its own copy of the service's
  // module state -- push signatures and backoffs are per device, not shared.
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = storage;
  const { WatchProgressSyncService } = await import(`./watchProgressSyncService.js?device=${name}`);
  const { AuthManager } = await import("../auth/authManager.js");
  const { AuthState } = await import("../auth/authState.js");
  AuthManager.setState(AuthState.AUTHENTICATED);
  globalThis.localStorage = previousStorage;

  const device = {
    name,
    storage,
    service: WatchProgressSyncService,
    async run(fn) {
      const outer = globalThis.localStorage;
      globalThis.localStorage = storage;
      globalThis.fetch = async (url, init) => {
        const procedure = String(url).split("/rpc/")[1] || "";
        const body = init?.body ? JSON.parse(init.body) : {};
        const result = cloud.handle(procedure, body);
        return {
          ok: true,
          status: 200,
          headers: { get: () => "application/json" },
          json: async () => result,
          text: async () => JSON.stringify(result)
        };
      };
      try {
        return await fn(device.service);
      } finally {
        globalThis.localStorage = outer;
      }
    },
    // What this device believes right now, without going near the network.
    async localProgress() {
      const outer = globalThis.localStorage;
      globalThis.localStorage = storage;
      try {
        const { watchProgressRepository } =
          await import("../../data/repository/watchProgressRepository.js");
        return await watchProgressRepository.getAll();
      } finally {
        globalThis.localStorage = outer;
      }
    }
  };

  device.storage.setItem("activeProfileId", JSON.stringify(PROFILE_ID));
  device.storage.setItem("profiles", JSON.stringify([{ id: PROFILE_ID, isPrimary: true }]));
  return device;
}

// Playing something, as far as reconciliation is concerned: a progress row this
// device wrote at this position.
async function play(device, item) {
  await device.run(async () => {
    const { watchProgressRepository } =
      await import("../../data/repository/watchProgressRepository.js");
    await watchProgressRepository.saveProgress(item);
  });
}

// Finishing something: the progress row goes, a watched record arrives. The
// absence is how the completion reaches the other device.
async function finish(device, item) {
  await device.run(async () => {
    const { watchProgressRepository } =
      await import("../../data/repository/watchProgressRepository.js");
    const { watchedItemsRepository } =
      await import("../../data/repository/watchedItemsRepository.js");
    await watchedItemsRepository.mark(
      {
        contentId: item.contentId,
        contentType: item.contentType,
        season: item.season ?? null,
        episode: item.episode ?? null,
        title: item.title || item.contentId
      },
      { skipTrackingWrite: true }
    );
    await watchProgressRepository.removeProgress(item.contentId, item.videoId || null);
    // Marking queues its cloud push on a timer. Sending it here is what the
    // timer would do a moment later, without the test racing it.
    const { WatchedItemsSyncService } = await import("./watchedItemsSyncService.js");
    await WatchedItemsSyncService.push();
  });
}

// Take in whatever the other device has recorded as finished. On a real device
// this rides along with the progress pull; here it is stated so a failure points
// at reconciliation rather than at ordering, which has its own tests.
async function pullWatched(device) {
  await device.run(async () => {
    const { WatchedItemsSyncService } = await import("./watchedItemsSyncService.js");
    await WatchedItemsSyncService.pull();
  });
}

const RUNTIME_MS = 7_200_000;

// Positions are given as a fraction of the runtime, because a small millisecond
// count is ambiguous with a second count and gets rewritten by the heuristic
// that rescues legacy rows.
const movie = (fraction) => ({
  contentId: "tt1375666",
  contentType: "movie",
  videoId: null,
  season: null,
  episode: null,
  positionMs: Math.round(RUNTIME_MS * fraction),
  durationMs: RUNTIME_MS,
  title: "Inception"
});

const at = (fraction) => Math.round(RUNTIME_MS * fraction);

const positionsFor = (items, contentId) =>
  items.filter((item) => item.contentId === contentId).map((item) => item.positionMs);

test("the harness reaches the real service and a shared cloud", async () => {
  const cloud = createCloud();
  const deviceA = await createDevice("probe", cloud);
  const pulled = await deviceA.run((service) => service.pull());
  assert.equal(Array.isArray(pulled), true);
});

test("a row this device pushes is what the other device pulls", async () => {
  const cloud = createCloud();
  const a = await createDevice("rt-a", cloud);
  const b = await createDevice("rt-b", cloud);
  await play(a, movie(0.3));
  await a.run((service) => service.push());
  await b.run((service) => service.pull());
  assert.deepEqual(positionsFor(await b.localProgress(), "tt1375666"), [at(0.3)]);
});

// The scenario issue #47 opens with, played out through the service rather than
// the merge: both devices know 30%, one goes offline and reaches 60%, the other
// reaches 80% online.
test("an offline partial does not overwrite further progress made elsewhere", async () => {
  const cloud = createCloud();
  const a = await createDevice("far-a", cloud);
  const b = await createDevice("far-b", cloud);

  await play(a, movie(0.3));
  await a.run((service) => service.push());
  await b.run((service) => service.pull());

  // A is offline: it writes locally and never reaches the cloud.
  await play(a, movie(0.6));
  await play(b, movie(0.8));
  await b.run((service) => service.push());

  await a.run((service) => service.pull());
  assert.deepEqual(positionsFor(await a.localProgress(), "tt1375666"), [at(0.8)]);
});

// Finishing deletes the row rather than setting it to 100%, so the other device
// sees only an absence -- and used to answer it by pushing its partial back.
test("a partial left behind is retired by a finish made elsewhere", async () => {
  const cloud = createCloud();
  const a = await createDevice("fin-a", cloud);
  const b = await createDevice("fin-b", cloud);

  await play(a, movie(0.3));
  await a.run((service) => service.push());
  await b.run((service) => service.pull());

  await play(a, movie(0.6));
  await finish(b, movie(0.6));
  await b.run((service) => service.push());

  await pullWatched(a);
  await a.run((service) => service.pull());
  assert.deepEqual(positionsFor(await a.localProgress(), "tt1375666"), []);
});

// And having retired it, this device must not put it back on the next round.
test("the retired row does not return to the cloud", async () => {
  const cloud = createCloud();
  const a = await createDevice("gone-a", cloud);
  const b = await createDevice("gone-b", cloud);

  await play(a, movie(0.3));
  await a.run((service) => service.push());
  await b.run((service) => service.pull());
  await play(a, movie(0.6));
  await finish(b, movie(0.6));
  await b.run((service) => service.push());
  await pullWatched(a);
  await a.run((service) => service.syncAfterReconnect("test"));

  await b.run((service) => service.pull());
  assert.deepEqual(positionsFor(await b.localProgress(), "tt1375666"), []);
});

// Starting it again afterwards is ordinary viewing, and has to survive.
test("watching it again after the finish is kept", async () => {
  const cloud = createCloud();
  const a = await createDevice("re-a", cloud);
  const b = await createDevice("re-b", cloud);

  await play(a, movie(0.3));
  await a.run((service) => service.push());
  await b.run((service) => service.pull());
  await finish(b, movie(0.3));
  await b.run((service) => service.push());
  await pullWatched(a);
  await a.run((service) => service.pull());

  await play(a, movie(0.05));
  await a.run((service) => service.push());
  await a.run((service) => service.pull());
  assert.deepEqual(positionsFor(await a.localProgress(), "tt1375666"), [at(0.05)]);
});

// The mirror image of the offline case above, and the one that actually bites:
// this device watched offline while another device watched the same title
// further, online. Coming back, the push owed from the offline session fires on
// its own debounce -- before anything has pulled -- and publishes a position the
// cloud has already moved past. The further viewing is gone, this device keeps
// showing the shorter one because the cloud now agrees with it, and only some
// other device pushing again puts the real position back.

// First: the merge itself is not at fault. Pull before push and the further
// position wins, which is what makes the ordering the whole story.
test("pulling before pushing keeps the further position", async () => {
  const cloud = createCloud();
  const a = await createDevice("order-a", cloud);
  const b = await createDevice("order-b", cloud);

  await play(a, movie(0.1));
  await a.run((service) => service.push());
  await b.run((service) => service.pull());

  await play(a, movie(0.3)); // offline on A
  await play(b, movie(0.7));
  await b.run((service) => service.push());

  await a.run((service) => service.pull());
  await a.run((service) => service.push());
  assert.deepEqual(positionsFor(await a.localProgress(), "tt1375666"), [at(0.7)]);
});

test("an offline device does not publish over further viewing done elsewhere", async () => {
  const cloud = createCloud();
  const a = await createDevice("stale-a", cloud);
  const b = await createDevice("stale-b", cloud);

  // Both know 10%.
  await play(a, movie(0.1));
  await a.run((service) => service.push());
  await b.run((service) => service.pull());

  // A goes offline and reaches 30%. Nothing leaves the device.
  await play(a, movie(0.3));

  // B, online throughout, reaches 70% and publishes it.
  await play(b, movie(0.7));
  await b.run((service) => service.push());

  // A's network returns. This is what the reconnect listener does first, before
  // it awaits anything -- and before the owed push can get out.
  const { noteWatchProgressReconnectPullOwed } = await import(
    `./watchProgressSyncService.js?device=stale-a`
  );
  noteWatchProgressReconnectPullOwed();

  // The debounced push from the offline session fires now. It must not leave.
  await a.run((service) => service.push());
  assert.deepEqual(
    positionsFor(await b.localProgress(), "tt1375666"),
    [at(0.7)],
    "the owed push must not reach the cloud before this device has reconciled"
  );

  // Then the reconnect sequence runs properly: pull, then push.
  await a.run((service) => service.syncAfterReconnect("test"));

  assert.deepEqual(
    positionsFor(await a.localProgress(), "tt1375666"),
    [at(0.7)],
    "the further position must survive the returning device's owed push"
  );

  // And the cloud must still carry it, or every other device loses it too.
  await b.run((service) => service.pull());
  assert.deepEqual(positionsFor(await b.localProgress(), "tt1375666"), [at(0.7)]);
});

// The debt must never outlive the attempt that recorded it: a push blocked
// forever would strand this device's own viewing instead.
test("a reconnect that cannot run releases the push it was holding", async () => {
  const cloud = createCloud();
  const a = await createDevice("debt-a", cloud);
  const { noteWatchProgressReconnectPullOwed } = await import(
    `./watchProgressSyncService.js?device=debt-a`
  );

  await play(a, movie(0.4));
  noteWatchProgressReconnectPullOwed();
  await a.run((service) => service.syncAfterReconnect("test"));
  await a.run((service) => service.push());

  assert.deepEqual(positionsFor(await a.localProgress(), "tt1375666"), [at(0.4)]);
  const pushed = [...cloud.progress.values()];
  assert.equal(pushed.length, 1, "the device's own viewing still reaches the cloud");
});

// The scenario as it actually happened: the cloud kept the further position the
// whole time -- a third device was showing 70% -- and this one still sat at 30%
// and never moved again. Nothing was overwritten; this device had simply
// recorded a baseline it never took in, and from then on every pull looked like
// "only I moved".
test("a device that fell behind catches up on its next pull", async () => {
  const cloud = createCloud();
  const a = await createDevice("behind-a", cloud);
  const b = await createDevice("behind-b", cloud);

  await play(a, movie(0.1));
  await a.run((service) => service.push());
  await b.run((service) => service.pull());

  await play(a, movie(0.3)); // offline on A
  await play(b, movie(0.7));
  await b.run((service) => service.push());

  // A's baseline already agrees with the cloud while its own row does not --
  // the state a pull leaves behind when it writes the baseline and then does
  // not store its merged rows.
  await a.run(async (service) => {
    await service.pull();
    await service.pull();
  });

  assert.deepEqual(positionsFor(await a.localProgress(), "tt1375666"), [at(0.7)]);

  // And the cloud still carries it, so no other device loses anything.
  await b.run((service) => service.pull());
  assert.deepEqual(positionsFor(await b.localProgress(), "tt1375666"), [at(0.7)]);
});

// Rewinding to watch something again, end to end: the cloud is further along,
// this device deliberately goes back, and the rewind has to survive coming back
// online rather than snapping forward to where the cloud was.
test("a deliberate rewind made offline survives coming back online", async () => {
  const cloud = createCloud();
  const a = await createDevice("rewind-a", cloud);
  const b = await createDevice("rewind-b", cloud);

  await play(b, movie(0.7));
  await b.run((service) => service.push());
  await a.run((service) => service.pull());
  assert.deepEqual(positionsFor(await a.localProgress(), "tt1375666"), [at(0.7)]);

  // Offline on A: back to 50% to watch it again.
  await play(a, { ...movie(0.5), updatedAt: Date.now() + 1000 });

  await a.run((service) => service.pull());
  await a.run((service) => service.push());
  assert.deepEqual(
    positionsFor(await a.localProgress(), "tt1375666"),
    [at(0.5)],
    "the rewind must hold rather than snapping back to the cloud's position"
  );

  // And it reaches the other device rather than being quietly dropped.
  await b.run((service) => service.pull());
  assert.deepEqual(positionsFor(await b.localProgress(), "tt1375666"), [at(0.5)]);
});

// Finishing something offline deletes its row here, but the matching delete
// call fails for want of a network and nothing retries it. The push that
// follows then rewrites the baseline from local, dropping the only record that
// the row was ever deleted -- so the cloud's surviving copy reads as a new row
// from another device and is adopted straight back. The title returns to
// Continue Watching part-watched, on this device and on every other one.
test("a title finished offline stays finished once the network returns", async () => {
  const cloud = createCloud();
  const a = await createDevice("fin-off-a", cloud);
  const b = await createDevice("fin-off-b", cloud);

  await play(a, movie(0.6));
  await a.run((service) => service.push());
  await b.run((service) => service.pull());
  assert.deepEqual(positionsFor(await b.localProgress(), "tt1375666"), [at(0.6)]);

  // Offline on A: watched to the end. The row goes; the cloud never hears.
  await a.run(async () => {
    const { watchProgressRepository } =
      await import("../../data/repository/watchProgressRepository.js");
    const { watchedItemsRepository } =
      await import("../../data/repository/watchedItemsRepository.js");
    await watchedItemsRepository.mark(
      { contentId: "tt1375666", contentType: "movie", title: "Inception" },
      { skipTrackingWrite: true }
    );
    await watchProgressRepository.removeProgress("tt1375666", null);
  });

  // Back online: pull, then push, the way the reconnect sequence runs it.
  await a.run((service) => service.pull());
  await a.run((service) => service.push());
  await a.run((service) => service.pull());

  assert.deepEqual(
    positionsFor(await a.localProgress(), "tt1375666"),
    [],
    "the finished title must not come back from the cloud"
  );
  // The mechanism, not just the outcome: the deletion owed from the offline
  // session is what has to reach the cloud, or every device re-adopts the row.
  assert.equal(cloud.progress.size, 0, "the deletion must have been published");

  // And the completion reaches the other device rather than dying here.
  await pullWatched(b);
  await b.run((service) => service.pull());
  assert.deepEqual(positionsFor(await b.localProgress(), "tt1375666"), []);
});

// --- Three devices ---------------------------------------------------------
//
// Two devices answer "does the merge reconcile?". Three answer a different
// question: does a device that was not part of an exchange still arrive at the
// same answer as the two that were. A rule that resolves A against B correctly
// can still leave C holding something neither of them has, because C's baseline
// records a cloud that has moved twice since it last looked.

test("a completion on one device reaches both of the others", async () => {
  const cloud = createCloud();
  const a = await createDevice("tri-a", cloud);
  const b = await createDevice("tri-b", cloud);
  const c = await createDevice("tri-c", cloud);

  await play(a, movie(0.3));
  await a.run((service) => service.push());
  await b.run((service) => service.pull());
  await c.run((service) => service.pull());
  assert.deepEqual(positionsFor(await c.localProgress(), "tt1375666"), [at(0.3)]);

  await finish(a, { contentId: "tt1375666", contentType: "movie", title: "Inception" });
  await a.run((service) => service.push());

  for (const device of [b, c]) {
    await pullWatched(device);
    await device.run((service) => service.pull());
    assert.deepEqual(
      positionsFor(await device.localProgress(), "tt1375666"),
      [],
      device.name + " kept a partial the completion retired"
    );
  }
});

test("the device that sat out an exchange still lands on the same position", async () => {
  const cloud = createCloud();
  const a = await createDevice("sat-a", cloud);
  const b = await createDevice("sat-b", cloud);
  const c = await createDevice("sat-c", cloud);

  // All three agree at 30%.
  await play(a, movie(0.3));
  await a.run((service) => service.push());
  await b.run((service) => service.pull());
  await c.run((service) => service.pull());

  // A and B trade twice while C is not looking.
  await play(b, movie(0.5));
  await b.run((service) => service.push());
  await a.run((service) => service.pull());
  await play(a, movie(0.7));
  await a.run((service) => service.push());
  await b.run((service) => service.pull());

  // C catches up in one pull, and must not publish its own stale 30% doing it.
  await c.run((service) => service.pull());
  await c.run((service) => service.push());
  assert.deepEqual(positionsFor(await c.localProgress(), "tt1375666"), [at(0.7)]);

  for (const device of [a, b]) {
    await device.run((service) => service.pull());
    assert.deepEqual(
      positionsFor(await device.localProgress(), "tt1375666"),
      [at(0.7)],
      device.name + " was dragged backwards by the device that caught up"
    );
  }
});

test("a device offline through two exchanges does not undo either of them", async () => {
  const cloud = createCloud();
  const a = await createDevice("off-a", cloud);
  const b = await createDevice("off-b", cloud);
  const c = await createDevice("off-c", cloud);

  await play(a, movie(0.2));
  await a.run((service) => service.push());
  await b.run((service) => service.pull());
  await c.run((service) => service.pull());

  // C goes offline and keeps watching: local writes, no network.
  await play(c, movie(0.4));

  // Meanwhile A watches further and B finishes it.
  await play(a, movie(0.6));
  await a.run((service) => service.push());
  await b.run((service) => service.pull());
  await finish(b, { contentId: "tt1375666", contentType: "movie", title: "Inception" });
  await b.run((service) => service.push());

  // C comes back: pull, push, pull -- the reconnect sequence.
  await pullWatched(c);
  await c.run((service) => service.pull());
  await c.run((service) => service.push());
  await c.run((service) => service.pull());

  assert.deepEqual(
    positionsFor(await c.localProgress(), "tt1375666"),
    [],
    "the offline device resurrected a title finished elsewhere"
  );
  assert.equal(cloud.progress.size, 0, "the offline device republished the retired row");

  await a.run((service) => service.pull());
  assert.deepEqual(
    positionsFor(await a.localProgress(), "tt1375666"),
    [],
    "the completion was undone for the device that never went offline"
  );
});

// The race that cost a completion on a device, played across two of them: A
// finishes while B's pull is already in flight. B's merge has to read its own
// store as it is when the rows land, not as it was when the request left.
test("a completion made while another device is mid-pull is not pushed back", async () => {
  const cloud = createCloud();
  const a = await createDevice("race-a", cloud);
  const b = await createDevice("race-b", cloud);

  await play(a, movie(0.3));
  await a.run((service) => service.push());
  await b.run((service) => service.pull());

  // B is holding the partial. A finishes and publishes while B pulls.
  await finish(a, { contentId: "tt1375666", contentType: "movie", title: "Inception" });
  await a.run((service) => service.push());

  await pullWatched(b);
  await b.run((service) => service.pull());
  await b.run((service) => service.push());

  assert.deepEqual(positionsFor(await b.localProgress(), "tt1375666"), []);
  assert.equal(cloud.progress.size, 0, "B pushed its stale partial back over the completion");

  await a.run((service) => service.pull());
  assert.deepEqual(
    positionsFor(await a.localProgress(), "tt1375666"),
    [],
    "A's own completion came back from the cloud"
  );
});

// Reported from a real pair of devices: A watched to 20 minutes with no network,
// B then watched the same film to 5 minutes online, and after A reconnected the
// two could not agree. The rule is the one the person would state themselves --
// whichever was watched last is where the film is -- and it does not care which
// direction that moves the position. Under the further-wins rule this replaced,
// A's 20 minutes were permanent: B's 5 could not survive a pull, so starting the
// film again was impossible on either device.
//
// The sibling case, an offline rewind that is itself the newest write, is
// "a deliberate rewind made offline survives coming back online" above.
test("the device that watched last wins, even when that moves the position back", async () => {
  const cloud = createCloud();
  const a = await createDevice("late-a", cloud);
  const b = await createDevice("late-b", cloud);
  const now = Date.now();

  await play(a, { ...movie(0.3), updatedAt: now });
  await a.run((service) => service.push());
  await b.run((service) => service.pull());

  // A is offline and gets further. B is online and deliberately starts over.
  await play(a, { ...movie(0.6), updatedAt: now + 1000 });
  await play(b, { ...movie(0.05), updatedAt: now + 2000 });
  await b.run((service) => service.push());

  // A reconnects.
  await a.run((service) => service.pull());
  assert.deepEqual(positionsFor(await a.localProgress(), "tt1375666"), [at(0.05)]);

  // And A does not talk B back out of it on the next round trip.
  await a.run((service) => service.push());
  await b.run((service) => service.pull());
  assert.deepEqual(positionsFor(await b.localProgress(), "tt1375666"), [at(0.05)]);
});

// What a device holds as finished, without going near the network.
async function localWatched(device, contentId) {
  return device.run(async () => {
    const { watchedItemsRepository } =
      await import("../../data/repository/watchedItemsRepository.js");
    return (await watchedItemsRepository.listLocal()).filter(
      (item) => item.contentId === contentId
    );
  });
}

// Reported from two devices: a title finished with no network advanced Continue
// Watching on the device that watched it and reached the other one not at all.
// The completion is a watched record, not a progress row, and the reconnect
// sequence only ever *pulled* those -- its push was the progress push. The
// completion's own push had failed on its 250ms timer while offline, and nothing
// after that tried again, so it sat on the device until something else happened
// to write a watched record.
test("a completion made with no network reaches the other device on reconnect", async () => {
  const cloud = createCloud();
  const a = await createDevice("owed-a", cloud);
  const b = await createDevice("owed-b", cloud);

  await play(a, movie(0.6));
  await a.run((service) => service.push());
  await b.run((service) => service.pull());

  // Offline on A: finished. The local row goes, the watched record arrives, and
  // the cloud hears nothing -- no push is run here at all, which is the point.
  await a.run(async () => {
    const { watchProgressRepository } =
      await import("../../data/repository/watchProgressRepository.js");
    const { watchedItemsRepository } =
      await import("../../data/repository/watchedItemsRepository.js");
    await watchedItemsRepository.mark(
      { contentId: "tt1375666", contentType: "movie", title: "Inception" },
      { skipTrackingWrite: true }
    );
    await watchProgressRepository.removeProgress("tt1375666", null);
  });
  assert.equal((await localWatched(a, "tt1375666")).length, 1);
  assert.deepEqual(await localWatched(b, "tt1375666"), []);

  // A's network returns and the reconnect sequence runs.
  await a.run((service) => service.syncAfterReconnect("test"));

  // B catches up the way it would on its next foreground.
  await pullWatched(b);
  await b.run((service) => service.pull());

  assert.equal(
    (await localWatched(b, "tt1375666")).length,
    1,
    "the other device has to learn the title was finished"
  );
  assert.deepEqual(
    positionsFor(await b.localProgress(), "tt1375666"),
    [],
    "and its partial has to retire rather than becoming next up again"
  );
});

// Un-marking an episode: the row goes here and its cloud row is deleted, so the
// other device learns by the absence. Reported from two devices as some episodes
// still showing watched on the second one afterwards.
//
// The merge decides whether a local row the cloud lacks was deleted elsewhere or
// simply not pushed yet, and it asked the last successful *push*. A row this
// device received *from* the cloud is known to the cloud whatever its own push
// history says -- and its watchedAt is whenever it was originally watched, which
// on the receiving device is newer than its own last push. So it read as "mine,
// not sent yet", survived, and went back up.
test("an episode un-marked on one device does not come back from the other", async () => {
  const cloud = createCloud();
  const a = await createDevice("un-a", cloud);
  const b = await createDevice("un-b", cloud);

  const watched = {
    contentId: "tt1196946",
    contentType: "series",
    season: 1,
    episode: 4,
    title: "The Mentalist"
  };

  // A finishes it and publishes. A second title keeps the cloud non-empty
  // throughout: a cloud that answers with nothing at all is treated as a failed
  // read rather than as everything having been deleted, which is its own
  // safeguard and not what this is about.
  await a.run(async () => {
    const { watchedItemsRepository } =
      await import("../../data/repository/watchedItemsRepository.js");
    await watchedItemsRepository.mark(
      {
        contentId: "tt0903747",
        contentType: "series",
        season: 1,
        episode: 1,
        title: "Breaking Bad"
      },
      { skipTrackingWrite: true }
    );
    await watchedItemsRepository.mark(watched, { skipTrackingWrite: true });
    const { WatchedItemsSyncService } = await import("./watchedItemsSyncService.js");
    await WatchedItemsSyncService.push();
  });

  // B takes it in. B has pushed nothing of its own.
  await pullWatched(b);
  assert.equal((await localWatched(b, "tt1196946")).length, 1);

  // A un-marks it. The local row goes and the cloud row is deleted.
  await a.run(async () => {
    const { watchedItemsRepository } =
      await import("../../data/repository/watchedItemsRepository.js");
    await watchedItemsRepository.unmark("tt1196946", { season: 1, episode: 4 });
    // The cloud delete rides behind the local removal now. It has to land while
    // this device"s storage and network are still the ones in place.
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assert.deepEqual(await localWatched(a, "tt1196946"), []);

  // B pulls again and has to let it go.
  await pullWatched(b);
  assert.deepEqual(
    await localWatched(b, "tt1196946"),
    [],
    "the other device must not keep an episode that was un-marked"
  );

  // And B must not put it back on its next push.
  await b.run(async () => {
    const { WatchedItemsSyncService } = await import("./watchedItemsSyncService.js");
    await WatchedItemsSyncService.push();
  });
  await pullWatched(a);
  assert.deepEqual(await localWatched(a, "tt1196946"), []);
});
