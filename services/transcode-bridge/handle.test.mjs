import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { writeFileSync, rmSync } from "node:fs";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import path from "node:path";
import { createTranscodeBridgeServer } from "./bridge.mjs";

// Handler-level tests. The bridge is the only thing between a phone and ffmpeg, so
// the interesting failures are not in its pure helpers: they are what happens on a
// second request, and what happens when the file the first one produced is gone.

/** Stands in for ffmpeg: writes the output file it was asked for, then exits 0. */
function fakeFfmpeg(calls) {
  return (_binary, args) => {
    calls.push(args);
    const target = args[args.length - 1];
    writeFileSync(target, Buffer.alloc(2048, 7));
    const handlers = new Map();
    const stdout = new PassThrough();
    setTimeout(() => handlers.get("close")?.(0), 0);
    return {
      stdout,
      on(event, handler) {
        handlers.set(event, handler);
        return this;
      },
      kill() {}
    };
  };
}

/**
 * The streaming shape: fragments on stdout, the output file does not exist until
 * the bridge has collected them from the pipe.
 */
function fakeStreamingFfmpeg(calls, { fragments = 3, size = 1024, hang = false } = {}) {
  return (_binary, args) => {
    calls.push(args);
    const handlers = new Map();
    const stdout = new PassThrough();
    let index = 0;
    const emit = () => {
      if (index < fragments) {
        index += 1;
        // Respect backpressure: a fake that ignores it keeps the loop busy with
        // timers after the test it belongs to has already finished.
        if (stdout.write(Buffer.alloc(size, 9))) setTimeout(emit, 0);
        else stdout.once("drain", emit);
        return;
      }
      if (hang) return;
      stdout.end();
      setTimeout(() => handlers.get("close")?.(0), 0);
    };
    setTimeout(emit, 0);
    return {
      stdout,
      on(event, handler) {
        handlers.set(event, handler);
        return this;
      },
      kill() {
        calls.kill = (calls.kill || 0) + 1;
        // A killed process closes its stdout. Without that the reader stays open
        // and the test process waits for it long after the assertion passed.
        stdout.destroy();
      }
    };
  };
}

/**
 * The HLS shape: writes an event playlist and one fragment into the directory the
 * command was pointed at, the way ffmpeg does as it goes.
 */
function fakeHlsFfmpeg(calls, { closeDelay = 0 } = {}) {
  return (_binary, args, options = {}) => {
    calls.push({ args, cwd: options.cwd });
    // The command now uses bare names and relies on the working directory, exactly
    // as the real bridge does, so the fake writes there too.
    const dir = options.cwd;
    writeFileSync(path.join(dir, "init.mp4"), Buffer.alloc(128, 1));
    writeFileSync(path.join(dir, "seg00000.m4s"), Buffer.alloc(256, 2));
    writeFileSync(
      path.join(dir, "index.m3u8"),
      [
        "#EXTM3U",
        "#EXT-X-VERSION:7",
        "#EXT-X-TARGETDURATION:4",
        '#EXT-X-MAP:URI="init.mp4"',
        "#EXTINF:4.000000,",
        "seg00000.m4s",
        "#EXT-X-ENDLIST",
        ""
      ].join("\n")
    );
    const handlers = new Map();
    setTimeout(() => handlers.get("close")?.(0), closeDelay);
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
  const workDir = await mkdtemp(path.join(tmpdir(), "nuvio-transcode-test-"));
  const calls = [];
  const server = createTranscodeBridgeServer({
    workDir,
    access: "open",
    spawnImpl: fakeFfmpeg(calls),
    sweepIntervalMs: 60 * 60 * 1000,
    log: { log() {}, warn() {} },
    ...options
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const source = `${base}/api/transcode?u=${encodeURIComponent("https://cdn.test/a.mkv")}`;
  try {
    await run({ url: source, streamUrl: `${source}&stream=1`, base, calls, workDir });
  } finally {
    // An idle keep-alive socket makes close() and the directory removal wait, and
    // on Windows a file the response still holds open cannot be deleted at all.
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    // A streaming job renames its part file into place as it finishes, which can
    // land between the directory listing and the removal.
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

test("a second request is served from the first transcode, not a second ffmpeg run", async () => {
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

test("concurrent requests for one source share a single ffmpeg run", async () => {
  await withServer({}, async ({ url, calls, workDir }) => {
    const responses = await Promise.all([fetch(url), fetch(url), fetch(url)]);
    assert.deepEqual(
      responses.map((response) => response.status),
      [200, 200, 200]
    );
    await Promise.all(responses.map((response) => response.arrayBuffer()));
    assert.equal(calls.length, 1);
    assert.equal((await readdir(workDir)).length, 1);
  });
});

test("a swept output is transcoded again instead of answering 500", async () => {
  // The regression: the sweeper deletes files by age and never the entry that
  // points at one, so the next play of that stream was answered from a file that
  // no longer existed -- ENOENT, 500, and no retry could clear it.
  await withServer({}, async ({ url, calls, workDir }) => {
    const first = await fetch(url);
    assert.equal(first.status, 200);
    await first.arrayBuffer();
    assert.equal(calls.length, 1);

    const [name] = await readdir(workDir);
    rmSync(path.join(workDir, name));

    const second = await fetch(url);
    assert.equal(second.status, 200);
    await second.arrayBuffer();
    assert.equal(calls.length, 2, "ffmpeg should have been asked again");
  });
});

test("the hvc1 attempt is tried first, and a rejected tag falls back", async () => {
  // ffmpeg refuses "-tag:v hvc1" for an H.264 source at header time, so the first
  // attempt of every non-HEVC stream fails immediately and the second one does the
  // work. Both are recorded so the order is part of the contract.
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

test("a failed transcode is not remembered as a success", async () => {
  // ffmpeg exits non-zero: the request fails, and the next one tries again rather
  // than being answered from an empty file. Two attempts per request, because the
  // tag attempt comes first.
  let attempts = 0;
  await withServer(
    {
      spawnImpl: (_binary, args) => {
        attempts += 1;
        void args;
        const handlers = new Map();
        setTimeout(() => handlers.get("close")?.(1), 0);
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
      assert.equal((await fetch(url)).status, 502);
      assert.equal((await fetch(url)).status, 502);
      assert.equal(attempts, 4, "each request tries twice and neither failure is cached");
    }
  );
});

test("progressive mode answers while the job is still running", async () => {
  // The whole point: the client sees the first fragments before the transcode has
  // finished, so a two-hour film no longer has to beat an eighteen second timeout.
  const calls = [];
  await withServer({ spawnImpl: fakeStreamingFfmpeg(calls) }, async ({ streamUrl, workDir }) => {
    const response = await fetch(streamUrl);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-length"), null);
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(body.length, 3 * 1024);
    assert.equal(body[0], 9);

    // The same bytes were kept, so the next play is a plain file with ranges --
    // the shape that can seek.
    const files = await readdir(workDir);
    assert.equal(files.length, 1);
    assert.equal(files[0].endsWith(".mp4"), true);

    const again = await fetch(streamUrl);
    assert.equal(again.status, 200);
    assert.equal(Number(again.headers.get("content-length")), 3 * 1024);
    await again.arrayBuffer();
    assert.equal(calls.length, 1, "the finished file is not transcoded a second time");
  });
});

test("progressive mode sends fragments with the flags a pipe needs", async () => {
  const calls = [];
  await withServer({ spawnImpl: fakeStreamingFfmpeg(calls) }, async ({ streamUrl }) => {
    await (await fetch(streamUrl)).arrayBuffer();
    const args = calls[0];
    assert.equal(args.includes("pipe:1"), true);
    assert.equal(args.includes("frag_keyframe+empty_moov+default_base_moof"), true);
    assert.equal(args.includes("+faststart"), false);
  });
});

test("a client that walks away stops the ffmpeg behind it", async () => {
  // Otherwise closing the player leaves a full-film transcode running for nobody.
  const calls = [];
  await withServer(
    { spawnImpl: fakeStreamingFfmpeg(calls, { fragments: 999, hang: true }) },
    async ({ streamUrl }) => {
      const controller = new AbortController();
      const response = await fetch(streamUrl, { signal: controller.signal });
      assert.equal(response.status, 200);
      const reader = response.body.getReader();
      await reader.read();
      controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.ok(calls.kill > 0, "ffmpeg should have been killed");
    }
  );
});

test("two devices asking for different plans get two files, not one", async () => {
  // The whole point of putting the plan in the key: a device that needs different
  // audio must never be served the file made for another one.
  await withServer({}, async ({ base, workDir }) => {
    const u = `u=${encodeURIComponent("https://cdn.test/a.mkv")}`;
    const stereo = await fetch(`${base}/api/transcode?${u}&v=copy&a=aac&ac=2`);
    assert.equal(stereo.status, 200);
    await stereo.arrayBuffer();
    const mono = await fetch(`${base}/api/transcode?${u}&v=copy&a=aac&ac=1`);
    assert.equal(mono.status, 200);
    await mono.arrayBuffer();

    assert.equal((await readdir(workDir)).length, 2, "one file per plan");
  });
});

test("a plan the bridge cannot perform is refused by name", async () => {
  // A silent copy would ship the very file the device already refused.
  await withServer({}, async ({ base, workDir }) => {
    const u = `u=${encodeURIComponent("https://cdn.test/a.mkv")}`;
    const video = await fetch(`${base}/api/transcode?${u}&v=h264&a=aac`);
    assert.equal(video.status, 501);
    const payload = await video.json();
    assert.equal(payload.error, "plan-not-offered");
    assert.deepEqual(payload.offered, { video: "copy", audio: "aac", audioModes: ["aac", "copy"] });

    assert.equal((await readdir(workDir)).length, 0, "nothing was transcoded");
  });
});

test("a malformed plan is a bad request, not a guess", async () => {
  await withServer({}, async ({ base }) => {
    const u = `u=${encodeURIComponent("https://cdn.test/a.mkv")}`;
    for (const [search, reason] of [
      ["v=vp9", "invalid-video"],
      ["a=mp3", "invalid-audio"],
      ["h=4000", "invalid-height"],
      ["ac=8", "invalid-channels"]
    ]) {
      const response = await fetch(`${base}/api/transcode?${u}&${search}`);
      assert.equal(response.status, 400, search);
      assert.equal((await response.json()).error, reason, search);
    }
  });
});

test("the hls playlist is served while the job is still running", async () => {
  const calls = [];
  await withServer({ spawnImpl: fakeHlsFfmpeg(calls) }, async ({ base }) => {
    const u = `u=${encodeURIComponent("https://cdn.test/a.mkv")}`;
    const response = await fetch(`${base}/api/transcode/hls/index.m3u8?${u}&v=copy&a=aac&ac=2`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/vnd.apple.mpegurl");
    const playlist = await response.text();

    // The key comes out of the URL the playlist is served from, and every URI in it
    // is relative to that URL, so the player's segment requests land on the bridge.
    const key = /([a-f0-9]{32})\/init\.mp4/.exec(playlist)?.[1];
    assert.equal(typeof key, "string");
    assert.equal(playlist.includes("#EXT-X-ENDLIST"), true);
    assert.match(playlist, new RegExp(`${key}/seg00000\\.m4s`));
    assert.equal(playlist.includes("/api/transcode/hls/"), false);

    // A segment is real, is served as media, and answers a range request.
    const segment = await fetch(`${base}/api/transcode/hls/${key}/seg00000.m4s`);
    assert.equal(segment.status, 200);
    assert.equal((await segment.arrayBuffer()).byteLength, 256);

    const ranged = await fetch(`${base}/api/transcode/hls/${key}/seg00000.m4s`, {
      headers: { range: "bytes=0-99" }
    });
    assert.equal(ranged.status, 206);
    assert.equal((await ranged.arrayBuffer()).byteLength, 100);

    const init = await fetch(`${base}/api/transcode/hls/${key}/init.mp4`);
    assert.equal(init.status, 200);
    await init.arrayBuffer();

    assert.equal(calls.length, 1, "one ffmpeg for the whole stream");
  });
});

test("a playlist request reuses the job instead of starting a second one", async () => {
  const calls = [];
  await withServer({ spawnImpl: fakeHlsFfmpeg(calls) }, async ({ base }) => {
    const u = `u=${encodeURIComponent("https://cdn.test/a.mkv")}`;
    const url = `${base}/api/transcode/hls/index.m3u8?${u}`;
    await (await fetch(url)).text();
    await (await fetch(url)).text();
    assert.equal(calls.length, 1);
  });
});

test("a segment nobody produced is a 404, not an empty file", async () => {
  await withServer({}, async ({ base }) => {
    const key = "b".repeat(32);
    const response = await fetch(`${base}/api/transcode/hls/${key}/seg00009.m4s`);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, "segment-not-ready");
  });
});

test("health advertises the delivery the app may ask for", async () => {
  await withServer({}, async ({ base }) => {
    const response = await fetch(`${base}/api/transcode/health`);
    const body = await response.json();
    assert.equal(body.hls, true);
    assert.deepEqual(body.offered, { video: "copy", audio: "aac", audioModes: ["aac", "copy"] });
  });
});

test("the hls playlist obeys the same plan gate as the file delivery", async () => {
  await withServer({}, async ({ base }) => {
    const u = `u=${encodeURIComponent("https://cdn.test/a.mkv")}`;
    const refused = await fetch(`${base}/api/transcode/hls/index.m3u8?${u}&v=h264`);
    assert.equal(refused.status, 501);
    await refused.arrayBuffer();

    const invalid = await fetch(`${base}/api/transcode/hls/index.m3u8?${u}&h=9999`);
    assert.equal(invalid.status, 400);
    await invalid.arrayBuffer();
  });
});

test("embedded text shares HLS access and cannot start or replace a video producer", async () => {
  const calls = [],
    textCalls = [];
  await withServer(
    {
      access: "token",
      token: "secret",
      spawnImpl: fakeHlsFfmpeg(calls),
      readTextTracks: async (url, params) => {
        textCalls.push({ url, action: params.get("text") });
        return { tracks: [{ id: 4, supported: true }] };
      }
    },
    async ({ base }) => {
      const params = new URLSearchParams({
        u: "https://cdn.test/a.mkv",
        v: "copy",
        a: "copy",
        ai: "1",
        token: "secret"
      });
      const text = new URL(base + "/api/transcode?" + params);
      text.searchParams.set("text", "tracks");
      const unauthorized = new URL(text);
      unauthorized.searchParams.delete("token");
      assert.equal((await fetch(unauthorized)).status, 401);
      assert.equal((await fetch(text)).status, 409);
      assert.equal(textCalls.length, 0);
      assert.equal(calls.length, 0);
      const playlist = await fetch(base + "/api/transcode/hls/index.m3u8?" + params);
      assert.equal(playlist.status, 200);
      assert.match(await playlist.text(), /#EXTINF/);
      const before = calls.length;
      const response = await fetch(text);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).tracks[0].id, 4);
      assert.equal(textCalls.length, 1);
      assert.equal(calls.length, before);
      assert.equal(calls[0].args[calls[0].args.indexOf("-c:a") + 1], "copy");
      assert.equal(
        calls[0].args[calls[0].args.indexOf("-map", calls[0].args.indexOf("-map") + 1) + 1],
        "0:a:1"
      );
    }
  );
});

test("overlapping HLS manifest requests join one slow producer under the one-job limit", async () => {
  let release, started;
  const registered = new Promise((resolve) => {
    started = resolve;
  });
  const calls = [];
  const fake = (_binary, args, options) => {
    calls.push(args);
    const handlers = new Map();
    release = () => {
      writeFileSync(path.join(options.cwd, "init.mp4"), Buffer.alloc(128));
      writeFileSync(path.join(options.cwd, "seg00000.m4s"), Buffer.alloc(256));
      writeFileSync(
        path.join(options.cwd, "index.m3u8"),
        "#EXTM3U\n#EXTINF:4,\nseg00000.m4s\n#EXT-X-ENDLIST\n"
      );
      handlers.get("close")?.(0);
    };
    started();
    return {
      on(event, handler) {
        handlers.set(event, handler);
        return this;
      },
      kill() {
        handlers.get("close")?.(1);
      }
    };
  };
  await withServer({ maxConcurrent: 1, perIpConcurrent: 1, spawnImpl: fake }, async ({ base }) => {
    const url =
      base + "/api/transcode/hls/index.m3u8?u=https%3A%2F%2Fcdn.test%2Fa.mkv&v=copy&a=copy&ai=1";
    const first = fetch(url);
    await registered;
    const other = await fetch(url.replace("ai=1", "ai=2"));
    assert.equal(other.status, 429, "different work still respects the host limit");
    const second = fetch(url);
    const timer = setTimeout(() => release(), 200);
    try {
      const [a, b] = await Promise.all([first, second]);
      assert.equal(a.status, 200);
      assert.equal(b.status, 200);
      assert.match(await a.text(), /#EXTINF/);
      assert.match(await b.text(), /#EXTINF/);
      assert.equal(calls.length, 1);
    } finally {
      clearTimeout(timer);
      release();
    }
  });
});

test("alternate audio master and nested playlists share one producer, video, access and default selection", async () => {
  const calls = [];
  const fake = (_binary, args, options) => {
    calls.push(args);
    for (let i = 0; i < 3; i++) {
      writeFileSync(path.join(options.cwd, `init${i}.mp4`), Buffer.alloc(64));
      writeFileSync(path.join(options.cwd, `seg${i}_00000.m4s`), Buffer.alloc(128));
      writeFileSync(
        path.join(options.cwd, `v${i}.m3u8`),
        `#EXTM3U\n#EXT-X-MAP:URI="init${i}.mp4"\n#EXTINF:4,\nseg${i}_00000.m4s\n#EXT-X-ENDLIST\n`
      );
    }
    writeFileSync(
      path.join(options.cwd, "index.m3u8"),
      '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="audio_1",DEFAULT=YES,URI="v1.m3u8"\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="audio_2",DEFAULT=NO,URI="v2.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=100,AVERAGE-BANDWIDTH=-983301119,AUDIO="audio"\nv0.m3u8\n'
    );
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
  await withServer(
    { access: "token", token: "secret", spawnImpl: fake, maxConcurrent: 1 },
    async ({ base }) => {
      const params = new URLSearchParams({
        u: "https://cdn.test/a.mkv",
        v: "copy",
        a: "copy",
        audios: "0,1",
        ai: "0",
        token: "secret"
      });
      let response = await fetch(base + "/api/transcode/hls/index.m3u8?" + params);
      assert.equal(response.status, 200);
      let master = await response.text();
      assert.match(master, /#EXT-X-STREAM-INF/);
      assert.doesNotMatch(master, /AVERAGE-BANDWIDTH/);
      assert.ok(Number(/BANDWIDTH=(\d+)/.exec(master)[1]) > 0);
      const video = master.split("\n").find((line) => line && !line.startsWith("#"));
      const nested = await fetch(new URL(video, base + "/api/transcode/hls/index.m3u8"));
      assert.equal(nested.status, 200);
      assert.match(nested.headers.get("content-type"), /mpegurl/);
      const body = await nested.text();
      const segment = body.split("\n").find((line) => line && !line.startsWith("#"));
      assert.match(segment, /^\/api\/transcode\/hls\/[a-f0-9]{32}\/seg0_00000.m4s\?token=secret$/);
      assert.equal((await fetch(base + segment)).status, 200);
      assert.equal((await fetch(base + segment.replace("?token=secret", ""))).status, 401);
      params.set("ai", "1");
      response = await fetch(base + "/api/transcode/hls/index.m3u8?" + params);
      master = await response.text();
      assert.match(master, /audio_2",DEFAULT=YES/);
      assert.equal(calls.length, 1);
    }
  );
});

test("an unfinished HLS producer is retryable and a later request joins the same job", async () => {
  let release;
  const calls = [];
  const fake = (_binary, args, options) => {
    calls.push(args);
    const handlers = new Map();
    release = () => {
      writeFileSync(path.join(options.cwd, "init.mp4"), Buffer.alloc(128));
      writeFileSync(path.join(options.cwd, "seg00000.m4s"), Buffer.alloc(256));
      writeFileSync(
        path.join(options.cwd, "index.m3u8"),
        "#EXTM3U\n#EXTINF:4,\nseg00000.m4s\n#EXT-X-ENDLIST\n"
      );
      handlers.get("close")?.(0);
    };
    return {
      on(event, handler) {
        handlers.set(event, handler);
        return this;
      },
      kill() {
        handlers.get("close")?.(1);
      }
    };
  };
  await withServer({ spawnImpl: fake }, async ({ base }) => {
    const url =
      base + "/api/transcode/hls/index.m3u8?u=https%3A%2F%2Fcdn.test%2Fslow.mkv&v=copy&a=copy";
    try {
      const pending = await fetch(url);
      assert.equal(pending.status, 503);
      assert.equal(pending.headers.get("retry-after"), "1");
      assert.equal((await pending.json()).error, "playlist-not-ready");
      release();
      const ready = await fetch(url);
      assert.equal(ready.status, 200);
      assert.match(await ready.text(), /#EXTINF/);
      assert.equal(calls.length, 1);
    } finally {
      release?.();
    }
  });
});

for (const exitCode of [0, 1]) {
  test(`HLS producer exit ${exitCode} without media is a real failure, not a pending or playable manifest`, async () => {
    const fake = (_binary, _args, options) => {
      const handlers = new Map();
      writeFileSync(path.join(options.cwd, "index.m3u8"), "#EXTM3U\n#EXT-X-ENDLIST\n");
      setTimeout(() => handlers.get("close")?.(exitCode), 0);
      return {
        on(event, handler) {
          handlers.set(event, handler);
          return this;
        },
        kill() {}
      };
    };
    await withServer({ spawnImpl: fake }, async ({ base }) => {
      const response = await fetch(
        base + "/api/transcode/hls/index.m3u8?u=https%3A%2F%2Fcdn.test%2Fempty.mkv&v=copy&a=copy"
      );
      assert.equal(response.status, 502);
      assert.equal((await response.json()).error, "transcode-failed");
    });
  });
}

test("a completed HLS job whose cache directory disappeared is produced again", async () => {
  const calls = [];
  await withServer({ spawnImpl: fakeHlsFfmpeg(calls) }, async ({ base, workDir }) => {
    const url =
      base + "/api/transcode/hls/index.m3u8?u=https%3A%2F%2Fcdn.test%2Fremoved.mkv&v=copy&a=copy";
    const first = await fetch(url);
    assert.equal(first.status, 200);
    assert.match(await first.text(), /#EXTINF/);
    const [directory] = await readdir(workDir);
    await rm(path.join(workDir, directory), { recursive: true, force: true });
    const second = await fetch(url);
    assert.equal(second.status, 200);
    assert.match(await second.text(), /#EXTINF/);
    assert.equal(calls.length, 2);
  });
});

test("full video HLS holds its concurrency slot after publishing the first segment", async () => {
  const calls = [];
  const ffmpegRuntime = { remux: true, audioTranscoding: true, videoTranscoding: true, hls: true };
  await withServer(
    {
      ffmpegRuntime,
      fullVideoEnabled: true,
      maxConcurrent: 1,
      spawnImpl: fakeHlsFfmpeg(calls, { closeDelay: 750 })
    },
    async ({ base }) => {
      const playlist = (file) =>
        base +
        "/api/transcode/hls/index.m3u8?u=" +
        encodeURIComponent("https://cdn.test/" + file) +
        "&v=h264&a=aac";
      const first = await fetch(playlist("first.mkv"));
      assert.equal(first.status, 200);
      assert.match(await first.text(), /#EXTINF/);
      const second = await fetch(playlist("second.mkv"));
      assert.equal(second.status, 429);
      assert.equal((await second.json()).error, "busy");
      assert.equal(calls.length, 1);
      assert.ok(calls[0].args.includes("libx264"));
    }
  );
});
