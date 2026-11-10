import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import test from "node:test";

async function unusedPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  server.close();
  await once(server, "close");
  return port;
}

async function waitForServer(baseUrl) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/external-return/health`);
      if (response.ok) return;
    } catch (_) {
      // The child process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Development server did not start");
}

test("npm serve handles one-time external return reports without logging stream URLs", async () => {
  const port = await unusedPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const token = "0123456789abcdef0123456789abcdef";
  let output = "";
  const child = spawn(process.execPath, ["scripts/serve.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      NUVIO_DISABLE_MEDIA_RUNTIME: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
  });
  try {
    await waitForServer(baseUrl);
    const report = await fetch(
      `${baseUrl}/api/external-return/report/${token}?outcome=stopped&position=30&duration=60&url=https%3A%2F%2Fsecret.example%2Fsigned`
    );
    const page = await report.text();
    assert.equal(report.status, 200);
    assert.match(page, /Playback received/);
    assert.match(page, /00:30/);
    assert.match(page, /Return to NuvioWeb/);
    assert.equal(page.includes("secret.example"), false);

    const collected = await fetch(`${baseUrl}/api/external-return/collect/${token}`);
    assert.deepEqual(await collected.json(), {
      found: true,
      outcome: "stopped",
      provider: "outplayer",
      sourceOutcome: "stopped",
      position: 30,
      duration: 60,
      progress: null,
      parameterNames: ["position", "duration"]
    });
    assert.deepEqual(
      await (await fetch(`${baseUrl}/api/external-return/collect/${token}`)).json(),
      { found: false }
    );

    const finishedToken = "11111111111111111111111111111111";
    const finished = await fetch(
      `${baseUrl}/api/external-return/report/${finishedToken}?outcome=stopped&provider=outplayer&sourceOutcome=finished`
    );
    assert.equal(finished.status, 200);
    assert.deepEqual(
      await (await fetch(`${baseUrl}/api/external-return/collect/${finishedToken}`)).json(),
      {
        found: true,
        outcome: "stopped",
        provider: "outplayer",
        sourceOutcome: "finished",
        position: null,
        duration: null,
        progress: null,
        parameterNames: []
      }
    );

    const invalid = await fetch(
      `${baseUrl}/api/external-return/report/not-a-token?outcome=stopped`
    );
    assert.equal(invalid.status, 404);
    assert.equal(output.includes("secret.example"), false);
    assert.equal(output.includes("[external-return]"), false);
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
});

test("runtime remux mode controls local mounting and public endpoints independently of audio transcode", async () => {
  const { runInNewContext } = await import("node:vm");
  for (const [mode, enabled, mounted] of [
    ["client", "true", false],
    ["off", "true", false],
    ["server", "false", true],
    ["invalid", "true", false],
    ["", "true", true]
  ]) {
    const port = await unusedPort(),
      baseUrl = "http://127.0.0.1:" + port;
    const child = spawn(process.execPath, ["scripts/serve.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(port),
        NUVIO_DISABLE_MEDIA_RUNTIME: "1",
        PROBE_MODE: "off",
        REMUX_MODE: mode,
        REMUX_ENABLED: enabled,
        REMUX_ENDPOINT: "",
        REMUX_CLIENT_CACHE_MAX_MIB: "256",
        REMUX_TOKEN: "never-public",
        TRANSCODE_ENABLED: "false"
      },
      stdio: ["ignore", "ignore", "ignore"]
    });
    try {
      await waitForServer(baseUrl);
      const script = await (await fetch(baseUrl + "/nuvio.env.js")).text(),
        context = {};
      runInNewContext(script, context);
      assert.equal(context.__NUVIO_ENV__.REMUX_MODE, mode);
      assert.equal(context.__NUVIO_ENV__.REMUX_CLIENT_CACHE_MAX_MIB, "256");
      assert.equal(context.__NUVIO_ENV__.REMUX_ENDPOINT, mounted ? "/api/remux" : "");
      assert.equal(context.__NUVIO_ENV__.TRANSCODE_ENDPOINT, "");
      assert.ok(!script.includes("never-public"));
      assert.equal((await fetch(baseUrl + "/api/remux/health")).status, mounted ? 200 : 404);
    } finally {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
  }
});

test("static serving blocks private paths and encoded aliases while preserving public assets", async () => {
  const port = await unusedPort();
  const baseUrl = "http://127.0.0.1:" + port;
  const child = spawn(process.execPath, ["scripts/serve.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, HOST: "0.0.0.0", PORT: String(port), NUVIO_DISABLE_MEDIA_RUNTIME: "1" },
    stdio: "ignore"
  });
  try {
    await waitForServer(baseUrl);
    for (const pathname of [
      "/package.json",
      "/pack%61ge.json",
      "/PACKAGE.JSON",
      "/package.json%20",
      "/local.properties",
      "/local%2eproperties",
      "/.env",
      "/%2eenv",
      "/.git/HEAD",
      "/%2egit%2fHEAD",
      "/scripts/serve.mjs",
      "/scripts%2fserve.mjs",
      "/services/remux-bridge/bridge.mjs",
      "/HANDOFF-CLAUDE-CODE.md",
      "/js/%2e%2e%2fpackage.json",
      "/js/%2e%2e%5cpackage.json",
      "/js/../package.json",
      "/package.json%3A%3A%24DATA",
      "/%zz"
    ]) {
      const response = await fetch(baseUrl + pathname);
      await response.arrayBuffer();
      assert.equal(response.status, 404, pathname);
    }
    for (const pathname of [
      "/",
      "/index.html",
      "/boot-guard.js",
      "/css/base.css",
      "/css/b%61se.css",
      "/assets/brand/nuvio-favicon.png",
      "/js/app.js",
      "/res/values/strings.xml",
      "/manifest.webmanifest",
      "/sw.js",
      "/nuvio.env.js",
      "/api/external-return/health"
    ]) {
      const response = await fetch(baseUrl + pathname);
      await response.arrayBuffer();
      assert.equal(response.status, 200, pathname);
    }
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
});
