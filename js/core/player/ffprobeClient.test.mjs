import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserProbeRunner, createBrowserProbePool } from "./ffprobeClient.js";
const facts = { container: "mp4", videoCodec: "h264", audioCodec: "aac" };
test("a two-worker pool starts two jobs, never three, and drains its queue", async () => {
  let created = 0,
    active = 0,
    peak = 0;
  const finishes = [],
    events = [];
  const pool = createBrowserProbePool({
    concurrency: 2,
    fetchImpl: async (_url, options) => {
      const [, a, b] = /bytes=(\d+)-(\d+)/.exec(options.headers.Range);
      return new Response(new Uint8Array(+b - +a + 1), {
        status: 206,
        headers: { "Content-Range": `bytes ${a}-${b}/2097152` }
      });
    },
    onEvent: (event, data) => events.push({ event, ...data }),
    makeWorker: () => {
      created++;
      return {
        terminate() {},
        postMessage(message) {
          active++;
          peak = Math.max(peak, active);
          finishes.push(() => {
            active--;
            this.onmessage({ data: { id: message.id, type: "result", result: facts } });
          });
        }
      };
    }
  });
  const first = pool.probe("https://cdn.test/first");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(created, 1, "only one cold Worker before the first result");
  assert.equal(pool.parallelReady, false);
  finishes.shift()();
  assert.deepEqual(await first, facts);
  assert.equal(pool.parallelReady, true);
  const requests = [1, 2, 3, 4].map((i) => pool.probe("https://cdn.test/" + i));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(created, 2);
  assert.equal(active, 2);
  finishes.shift()();
  finishes.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(active, 2);
  finishes.shift()();
  finishes.shift()();
  assert.deepEqual(await Promise.all(requests), Array(4).fill(facts));
  assert.equal(created, 2);
  assert.equal(peak, 2);
  assert.deepEqual([...new Set(events.map((entry) => entry.slot))], [1, 2]);
});
const fetchRange = async (_url, options) => {
  const [, a, b] = /bytes=(\d+)-(\d+)/.exec(options.headers.Range);
  return new Response(new Uint8Array(+b - +a + 1), {
    status: 206,
    headers: { "Content-Range": "bytes " + a + "-" + b + "/2097152" }
  });
};
test("a failed first source does not unlock a second Worker just because WASM loaded", async () => {
  let created = 0;
  const pool = createBrowserProbePool({
    concurrency: 2,
    fetchImpl: fetchRange,
    makeWorker: () => {
      created++;
      return {
        terminate() {},
        postMessage(message) {
          if (message.type === "release") return;
          queueMicrotask(() => {
            this.onmessage({ data: { id: message.id, type: "stage", stage: "metadata" } });
            this.onmessage({
              data:
                message.id === 1
                  ? { id: message.id, type: "range", position: 4194304 }
                  : { id: message.id, type: "result", result: facts }
            });
          });
        }
      };
    }
  });
  assert.equal(await pool.probe("https://cdn.test/failed"), null);
  assert.equal(pool.parallelReady, false);
  assert.deepEqual(await pool.probe("https://cdn.test/valid"), facts);
  assert.equal(created, 1);
  assert.equal(pool.parallelReady, true);
});

test("after all cores go idle, the pool protects the first result again", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let created = 0;
  const pool = createBrowserProbePool({
    concurrency: 2,
    fetchImpl: fetchRange,
    makeWorker: () => {
      created++;
      return {
        terminate() {},
        postMessage(message) {
          queueMicrotask(() =>
            this.onmessage({ data: { id: message.id, type: "result", result: facts } })
          );
        }
      };
    }
  });
  await pool.probe("https://cdn.test/first");
  await Promise.all([pool.probe("https://cdn.test/a"), pool.probe("https://cdn.test/b")]);
  assert.equal(created, 2);
  assert.equal(pool.parallelReady, true);
  t.mock.timers.tick(30000);
  assert.equal(pool.parallelReady, false);
  await pool.probe("https://cdn.test/after-idle");
  assert.equal(created, 3);
});
test("a source byte-budget failure releases that job and reuses the initialized worker", async () => {
  let created = 0,
    terminated = 0,
    released = 0,
    bytes = 0;
  const runner = createBrowserProbeRunner({
    fetchImpl: async (_url, options) => {
      const [, start, end] = /bytes=(\d+)-(\d+)/.exec(options.headers.Range);
      bytes += +end - Number(start) + 1;
      return new Response(new Uint8Array(+end - +start + 1), {
        status: 206,
        headers: { "Content-Range": `bytes ${start}-${end}/16777216` }
      });
    },
    makeWorker: () => {
      created++;
      return {
        terminate() {
          terminated++;
        },
        postMessage(message) {
          if (message.type === "release") {
            released++;
            return;
          }
          queueMicrotask(() =>
            this.onmessage({
              data:
                message.id === 1
                  ? {
                      id: message.id,
                      type: "range",
                      position: message.chunk.start + message.chunk.bytes.length
                    }
                  : { id: message.id, type: "result", result: facts }
            })
          );
        }
      };
    }
  });
  assert.equal(await runner.probe("https://cdn.test/budget"), null);
  assert.equal(bytes, 13 * 1024 * 1024);
  assert.equal(released, 1);
  assert.equal(terminated, 0);
  assert.deepEqual(await runner.probe("https://cdn.test/playable"), facts);
  assert.equal(created, 1);
});

test("a worker error still destroys the core before another source is probed", async () => {
  let created = 0,
    terminated = 0;
  const runner = createBrowserProbeRunner({
    fetchImpl: fetchRange,
    makeWorker: () => {
      const instance = ++created;
      return {
        terminate() {
          terminated++;
        },
        postMessage(message) {
          queueMicrotask(() =>
            instance === 1
              ? this.onerror()
              : this.onmessage({
                  data: { id: message.id, type: "result", result: facts }
                })
          );
        }
      };
    }
  });
  assert.equal(await runner.probe("https://cdn.test/first"), null);
  assert.equal(terminated, 1);
  assert.deepEqual(await runner.probe("https://cdn.test/next"), facts);
  assert.equal(created, 2);
});
test("one client worker handles serial probes and on-demand byte ranges", async () => {
  let workers = 0,
    active = 0,
    peak = 0,
    requests = 0;
  const worker = {
    onmessage: null,
    onerror: null,
    terminate() {},
    postMessage(message) {
      if (message.type === "start") {
        active++;
        peak = Math.max(peak, active);
      }
      queueMicrotask(() => {
        if (message.type === "start")
          this.onmessage({ data: { id: message.id, type: "range", position: 1048576 } });
        else {
          active--;
          this.onmessage({ data: { id: message.id, type: "result", result: facts } });
        }
      });
    }
  };
  const runner = createBrowserProbeRunner({
    makeWorker: () => {
      workers++;
      return worker;
    },
    fetchImpl: async (...args) => {
      requests++;
      return fetchRange(...args);
    }
  });
  const result = await Promise.all([
    runner.probe("https://cdn.test/1"),
    runner.probe("https://cdn.test/2")
  ]);
  assert.deepEqual(result, [facts, facts]);
  assert.equal(workers, 1);
  assert.equal(peak, 1);
  assert.equal(requests, 4);
});
test("CORS or missing Range support fails before loading the WASM worker", async () => {
  let workers = 0;
  const runner = createBrowserProbeRunner({
    makeWorker: () => {
      workers++;
      throw Error("must not load");
    },
    fetchImpl: async () => new Response("not partial", { status: 200 })
  });
  assert.equal(await runner.probe("https://cdn.test/file"), null);
  assert.equal(workers, 0);
});
test("timeout terminates a stuck worker and queued expired probes do no work", async () => {
  let terminations = 0,
    requests = 0;
  const events = [];
  const runner = createBrowserProbeRunner({
    onEvent: (event, facts) => events.push({ event, ...facts }),
    makeWorker: () => ({
      postMessage() {},
      terminate() {
        terminations++;
      }
    }),
    fetchImpl: async (...args) => {
      requests++;
      return fetchRange(...args);
    }
  });
  const results = await Promise.all([
    runner.probe("https://cdn.test/a", { timeoutMs: 50 }),
    runner.probe("https://cdn.test/b", { timeoutMs: 5 })
  ]);
  assert.deepEqual(results, [null, null]);
  assert.equal(terminations, 1);
  assert.equal(requests, 1);
  assert.equal(
    events.find((entry) => entry.id === 1 && entry.event === "failure").reason,
    "timeout"
  );
  assert.equal(
    events.find((entry) => entry.id === 2 && entry.event === "failure").reason,
    "queue-timeout"
  );
});

test("client probe diagnostics are opt-in and omit signed URLs and exception messages", async () => {
  const previousFlag = globalThis.__NUVIO_CLIENT_PROBE_DEBUG__;
  const previousWarn = console.warn;
  const logs = [];
  console.warn = (message) => logs.push(message);
  try {
    const runner = createBrowserProbeRunner({
      fetchImpl: async () => {
        throw new TypeError("https://private.test/token-secret");
      }
    });
    globalThis.__NUVIO_CLIENT_PROBE_DEBUG__ = false;
    assert.equal(await runner.probe("https://private.test/token-secret"), null);
    assert.equal(logs.length, 0);
    globalThis.__NUVIO_CLIENT_PROBE_DEBUG__ = true;
    assert.equal(await runner.probe("https://private.test/token-secret"), null);
    assert.equal(logs.length, 3);
    assert.ok(logs.some((line) => line.includes('"stage":"source-range-or-head"')));
    assert.ok(logs.some((line) => line.includes('"reason":"source-or-worker-failed"')));
    assert.equal(logs.join(" ").includes("private.test"), false);
    assert.equal(logs.join(" ").includes("token-secret"), false);
  } finally {
    console.warn = previousWarn;
    if (previousFlag === undefined) delete globalThis.__NUVIO_CLIENT_PROBE_DEBUG__;
    else globalThis.__NUVIO_CLIENT_PROBE_DEBUG__ = previousFlag;
  }
});

test("worker loading and metadata stages are preserved in diagnostic events", async () => {
  const events = [];
  const runner = createBrowserProbeRunner({
    fetchImpl: fetchRange,
    onEvent: (event, facts) => events.push({ event, ...facts }),
    makeWorker: () => ({
      terminate() {},
      postMessage(message) {
        queueMicrotask(() => {
          for (const stage of ["worker-script", "wasm-loading", "metadata"])
            this.onmessage({ data: { id: message.id, type: "stage", stage } });
          this.onmessage({ data: { id: message.id, type: "result", result: facts } });
        });
      }
    })
  });
  assert.deepEqual(await runner.probe("https://cdn.test/private"), facts);
  assert.deepEqual(
    events.filter((entry) => entry.event === "stage").map((entry) => entry.stage),
    ["worker-script", "wasm-loading", "metadata"]
  );
  const success = events.find((entry) => entry.event === "success");
  assert.equal(success.ranges, 1);
  assert.equal(success.mediaBytes, 262144);
  assert.equal(success.fileBytes, 2097152);
});

test("idle client workers release WASM memory and the next probe starts a fresh worker", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let created = 0,
    terminated = 0;
  const runner = createBrowserProbeRunner({
    fetchImpl: fetchRange,
    makeWorker: () => {
      created++;
      return {
        terminate() {
          terminated++;
        },
        postMessage(message) {
          queueMicrotask(() =>
            this.onmessage({ data: { id: message.id, type: "result", result: facts } })
          );
        }
      };
    }
  });
  assert.deepEqual(await runner.probe("https://cdn.test/a"), facts);
  t.mock.timers.tick(29999);
  assert.equal(terminated, 0);
  t.mock.timers.tick(1);
  assert.equal(terminated, 1);
  assert.deepEqual(await runner.probe("https://cdn.test/b"), facts);
  assert.equal(created, 2);
  t.mock.timers.tick(30000);
  assert.equal(terminated, 2);
});

test("background resolve has a separate bounded budget; auto-select keeps its hard timeout", async () => {
  const makeRunner = () =>
    createBrowserProbeRunner({
      urlResolver: {
        cached: () => null,
        canUseHost: () => true,
        remember() {},
        resolve: async (_url, { signal }) => {
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, 300);
            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true }
            );
          });
          return { ok: !signal.aborted, url: "https://cdn.test/movie" };
        }
      },
      fetchImpl: fetchRange,
      makeWorker: () => ({
        terminate() {},
        postMessage(message) {
          setTimeout(
            () => this.onmessage?.({ data: { id: message.id, type: "result", result: facts } }),
            70
          );
        }
      })
    });
  assert.deepEqual(
    await makeRunner().probe("https://addon.test/movie", { timeoutMs: 200, resolveTimeoutMs: 600 }),
    facts
  );
  assert.equal(await makeRunner().probe("https://addon.test/movie", { timeoutMs: 200 }), null);
});

test("cold WASM initialization does not consume a background file's probe timeout", async () => {
  let created = 0,
    terminated = 0,
    cold = true;
  const runner = createBrowserProbeRunner({
    fetchImpl: fetchRange,
    makeWorker: () => {
      created++;
      return {
        terminate() {
          terminated++;
        },
        postMessage(message) {
          const delay = cold ? 300 : 0;
          cold = false;
          setTimeout(() => {
            this.onmessage?.({ data: { id: message.id, type: "stage", stage: "metadata" } });
            setTimeout(
              () => this.onmessage?.({ data: { id: message.id, type: "result", result: facts } }),
              30
            );
          }, delay);
        }
      };
    }
  });
  assert.deepEqual(
    await runner.probe("https://cdn.test/cold", {
      timeoutMs: 200,
      resolveTimeoutMs: 500,
      initializationTimeoutMs: 600
    }),
    facts
  );
  assert.deepEqual(
    await runner.probe("https://cdn.test/warm", {
      timeoutMs: 200,
      resolveTimeoutMs: 500,
      initializationTimeoutMs: 600
    }),
    facts
  );
  assert.equal(created, 1);
  assert.equal(terminated, 0);
});

test("a stuck background initialization has its own finite timeout", async () => {
  let terminated = 0;
  const events = [];
  const runner = createBrowserProbeRunner({
    fetchImpl: fetchRange,
    onEvent: (event, facts) => events.push({ event, ...facts }),
    makeWorker: () => ({
      postMessage() {},
      terminate() {
        terminated++;
      }
    })
  });
  assert.equal(
    await runner.probe("https://cdn.test/stuck", {
      timeoutMs: 100,
      resolveTimeoutMs: 100,
      initializationTimeoutMs: 25
    }),
    null
  );
  assert.equal(terminated, 1);
  assert.equal(events.at(-1).reason, "wasm-initialization-timeout");
});

test("an unlimited foreground probe can be cancelled during cold WASM startup", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = new AbortController();
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  let terminated = false;
  const runner = createBrowserProbeRunner({
    fetchImpl: fetchRange,
    makeWorker: () => ({
      postMessage: started,
      terminate: () => {
        terminated = true;
      }
    })
  });
  const pending = runner.probe("https://cdn.test/foreground", {
    timeoutMs: Infinity,
    signal: controller.signal
  });
  await ready;
  t.mock.timers.tick(60000);
  assert.equal(terminated, false);
  controller.abort();
  assert.equal(await pending, null);
  assert.equal(terminated, true);
});

test("auto-selection cannot extend its hard deadline for cold WASM", async () => {
  const runner = createBrowserProbeRunner({
    fetchImpl: fetchRange,
    makeWorker: () => ({
      terminate() {},
      postMessage(message) {
        setTimeout(
          () => this.onmessage?.({ data: { id: message.id, type: "stage", stage: "metadata" } }),
          150
        );
      }
    })
  });
  assert.equal(
    await runner.probe("https://cdn.test/selection", {
      timeoutMs: 40,
      initializationTimeoutMs: 1000
    }),
    null
  );
});

test("a slow second WASM core initializes once and remains reusable", async () => {
  let created = 0,
    terminated = 0;
  const pool = createBrowserProbePool({
    concurrency: 2,
    fetchImpl: fetchRange,
    makeWorker: () => {
      const slot = ++created;
      let first = true;
      return {
        terminate() {
          terminated++;
        },
        postMessage(message) {
          const delay = first && slot === 2 ? 300 : 0;
          first = false;
          setTimeout(() => {
            this.onmessage?.({ data: { id: message.id, type: "stage", stage: "metadata" } });
            setTimeout(
              () => this.onmessage?.({ data: { id: message.id, type: "result", result: facts } }),
              30
            );
          }, delay);
        }
      };
    }
  });
  const options = { timeoutMs: 200, resolveTimeoutMs: 500, initializationTimeoutMs: 600 };
  assert.deepEqual(await pool.probe("https://cdn.test/first", options), facts);
  assert.deepEqual(
    await Promise.all([
      pool.probe("https://cdn.test/second", options),
      pool.probe("https://cdn.test/third", options)
    ]),
    [facts, facts]
  );
  assert.deepEqual(
    await Promise.all([
      pool.probe("https://cdn.test/fourth", options),
      pool.probe("https://cdn.test/fifth", options)
    ]),
    [facts, facts]
  );
  assert.equal(created, 2);
  assert.equal(terminated, 0);
});

test("aborting active browser probing terminates its worker and skips cancelled queued jobs", async () => {
  let stopped = 0,
    created = 0;
  const runner = createBrowserProbeRunner({
    onEvent() {},
    fetchImpl: async (_url, options) => {
      const [, a, b] = /bytes=(\d+)-(\d+)/.exec(options.headers.Range);
      return new Response(new Uint8Array(+b - +a + 1), {
        status: 206,
        headers: { "Content-Range": `bytes ${a}-${b}/2097152` }
      });
    },
    makeWorker: () => {
      created++;
      return {
        postMessage() {},
        terminate() {
          stopped++;
        }
      };
    }
  });
  const controller = new AbortController();
  const first = runner.probe("https://media.test/first", { signal: controller.signal });
  const second = runner.probe("https://media.test/second", { signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  assert.deepEqual(await Promise.all([first, second]), [null, null]);
  assert.equal(stopped, 1);
  assert.equal(created, 1);
});
