import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRemuxBridgeServer } from "./bridge.mjs";

// Handler-level tests, for the same reason the transcode bridge has them: the
// interesting failures are not in the helpers, they are in what the second request
// does, and in what happens when the file the first one produced has been swept.

function fakeFfmpeg(calls) {
  return (_binary, args) => {
    calls.push(args);
    writeFileSync(args[args.length - 1], Buffer.alloc(2048, 7));
    const handlers = new Map();
    setTimeout(() => handlers.get("close")?.(0), 0);
    return {
      on(event, handler) {
        handlers.set(event, handler);
        return this;
      },
      kill() {}
    };
  };
}

async function withServer(options, run) {
  const workDir = await mkdtemp(path.join(tmpdir(), "nuvio-remux-test-"));
  const calls = [];
  const server = createRemuxBridgeServer({
    workDir,
    spawnImpl: fakeFfmpeg(calls),
    sweepIntervalMs: 60 * 60 * 1000,
    ...options
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/remux?u=${encodeURIComponent("https://cdn.test/a.mkv")}`;
  try {
    await run({ url, calls, workDir });
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    // Windows can still be releasing a handle when the removal runs.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rm(workDir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  }
}

test("a second request is served from the first remux", async () => {
  await withServer({}, async ({ url, calls }) => {
    const first = await fetch(url);
    assert.equal(first.status, 200);
    assert.equal((await first.arrayBuffer()).byteLength, 2048);
    const second = await fetch(url);
    assert.equal(second.status, 200);
    await second.arrayBuffer();
    assert.equal(calls.length, 1);
  });
});

test("a swept output is remuxed again instead of answering 500", async () => {
  // The directory sweep judges a file by its own timestamp, so it can remove one
  // whose cache entry still looks recently used. The entry used to be handed back
  // anyway, and every later play of that stream failed with ENOENT until restart.
  await withServer({}, async ({ url, calls, workDir }) => {
    const first = await fetch(url);
    assert.equal(first.status, 200);
    await first.arrayBuffer();

    const [name] = await readdir(workDir);
    rmSync(path.join(workDir, name));

    const second = await fetch(url);
    assert.equal(second.status, 200);
    await second.arrayBuffer();
    assert.equal(calls.length, 2, "ffmpeg should have been asked again");
  });
});

test("an hvc1 tag rejected by ffmpeg falls back to the plain copy", async () => {
  // The first attempt asks for the tag Safari needs; an H.264 source refuses it at
  // header time, and the second attempt is the one that produces the file.
  let attempts = 0;
  await withServer(
    {
      spawnImpl: (_binary, args) => {
        attempts += 1;
        const tagged = args.includes("-tag:v");
        if (!tagged) writeFileSync(args[args.length - 1], Buffer.alloc(1024, 3));
        const handlers = new Map();
        setTimeout(() => handlers.get("close")?.(tagged ? 1 : 0), 0);
        return {
          on(event, handler) {
            handlers.set(event, handler);
            return this;
          },
          kill() {}
        };
      }
    },
    async ({ url }) => {
      const response = await fetch(url);
      assert.equal(response.status, 200);
      await response.arrayBuffer();
      assert.equal(attempts, 2);
    }
  );
});

test("a busy deployment answers 429 instead of queueing forever", async () => {
  // A slow relay: the file appears only when released, so the second request arrives
  // while the first is genuinely running.
  let release = null;
  const gate = new Promise((resolve) => (release = resolve));
  await withServer(
    {
      maxConcurrent: 1,
      spawnImpl: (_binary, args) => {
        const handlers = new Map();
        void gate.then(() => {
          writeFileSync(args[args.length - 1], Buffer.alloc(512, 9));
          handlers.get("close")?.(0);
        });
        return {
          on(event, handler) {
            handlers.set(event, handler);
            return this;
          },
          kill() {}
        };
      }
    },
    async ({ url }) => {
      const first = fetch(url);
      // Different source, so it cannot join the running job.
      const other = url.replace(
        encodeURIComponent("https://cdn.test/a.mkv"),
        encodeURIComponent("https://cdn.test/b.mkv")
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      const second = await fetch(other);
      assert.equal(second.status, 429);
      assert.equal(second.headers.get("retry-after"), "5");
      const body = await second.json();
      assert.equal(body.error, "busy");
      assert.equal(body.maxConcurrent, 1);
      release();
      const served = await first;
      assert.equal(served.status, 200);
      await served.arrayBuffer();
    }
  );
});

test("a source above the size limit is refused before any work starts", async () => {
  await withServer(
    {
      maxSourceBytes: 1000,
      sourceSize: async () => 5000
    },
    async ({ url, calls }) => {
      const response = await fetch(url);
      assert.equal(response.status, 413);
      const body = await response.json();
      assert.equal(body.error, "source-too-large");
      assert.equal(body.size, 5000);
      assert.equal(calls.length, 0, "ffmpeg must not be started");
    }
  );
});

test("an exhausted daily budget answers 503 with a retry hint", async () => {
  await withServer({ dailyBudgetBytes: 1 }, async ({ url }) => {
    const first = await fetch(url);
    assert.equal(first.status, 200);
    await first.arrayBuffer();
    // The first relay used 2048 bytes of a 1-byte budget.
    const other = url.replace(
      encodeURIComponent("https://cdn.test/a.mkv"),
      encodeURIComponent("https://cdn.test/c.mkv")
    );
    const second = await fetch(other);
    assert.equal(second.status, 503);
    assert.equal(second.headers.get("retry-after"), "3600");
    const body = await second.json();
    assert.equal(body.error, "quota-exhausted");
    assert.equal(body.dailyBudgetBytes, 1);
  });
});

test("health advertises the limits the client is held to", async () => {
  await withServer(
    { maxConcurrent: 2, maxSourceBytes: 4096, dailyBudgetBytes: 100000 },
    async ({ url }) => {
      const health = await fetch(
        url.replace("/api/remux?u=", "/api/remux/health?u=").split("?")[0]
      );
      const body = await health.json();
      assert.equal(body.maxConcurrent, 2);
      assert.equal(body.active, 0);
      assert.equal(body.busy, false);
      assert.equal(body.maxSourceBytes, 4096);
      assert.equal(body.dailyBudgetBytes, 100000);
      assert.equal(body.remainingBytesToday, 100000);
    }
  );
});
