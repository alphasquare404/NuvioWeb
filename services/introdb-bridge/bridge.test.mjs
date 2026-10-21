import assert from "node:assert/strict";
import test from "node:test";
import { createIntrodbBridgeHandler } from "./bridge.mjs";

function fakeResponse() {
  const captured = { status: 0, headers: null, body: "" };
  return {
    captured,
    writeHead(status, headers) {
      captured.status = status;
      captured.headers = headers;
    },
    end(body) {
      captured.body = String(body ?? "");
    }
  };
}

function fakeRequest(url, method = "GET") {
  return { url, method, headers: { host: "app.example" } };
}

async function call(handler, request) {
  const response = fakeResponse();
  await handler(request, response);
  return response.captured;
}

const upstreamBody = JSON.stringify({
  imdb_id: "tt14688458",
  intro: { start_sec: 343, end_sec: 438 },
  outro: null
});

test("a valid request is relayed and the upstream body is passed through", async () => {
  const seen = [];
  const handler = createIntrodbBridgeHandler({
    fetchImpl: async (url) => {
      seen.push(String(url));
      return { ok: true, status: 200, text: async () => upstreamBody };
    }
  });

  const result = await call(
    handler,
    fakeRequest("/api/introdb/segments?imdb_id=tt14688458&season=2&episode=2")
  );
  assert.equal(result.status, 200);
  assert.equal(result.body, upstreamBody);
  assert.equal(result.headers["Content-Type"], "application/json; charset=utf-8");
  assert.equal(seen.length, 1);
  assert.match(
    seen[0],
    /^https:\/\/api\.introdb\.app\/segments\?imdb_id=tt14688458&season=2&episode=2$/
  );
});

test("only the three known parameters are forwarded, so this cannot become an open proxy", async () => {
  const seen = [];
  const handler = createIntrodbBridgeHandler({
    fetchImpl: async (url) => {
      seen.push(String(url));
      return { ok: true, status: 200, text: async () => "{}" };
    }
  });

  await call(
    handler,
    fakeRequest(
      "/api/introdb/segments?imdb_id=tt14688458&season=1&episode=1&url=https://evil.example&path=/etc/passwd"
    )
  );
  assert.match(seen[0], /season=1/);
  assert.doesNotMatch(seen[0], /evil\.example/);
  assert.doesNotMatch(seen[0], /passwd/);
});

test("a film, a bad id, or a bad episode number is refused without asking upstream", async () => {
  let asked = 0;
  const handler = createIntrodbBridgeHandler({
    fetchImpl: async () => {
      asked += 1;
      return { ok: true, status: 200, text: async () => "{}" };
    }
  });

  for (const url of [
    "/api/introdb/segments?imdb_id=tt14688458&season=0&episode=2",
    "/api/introdb/segments?imdb_id=tt14688458&season=2&episode=0",
    "/api/introdb/segments?imdb_id=not-an-id&season=2&episode=2",
    "/api/introdb/segments?season=2&episode=2",
    "/api/introdb/segments?imdb_id=tt14688458&season=2.5&episode=2"
  ]) {
    const result = await call(handler, fakeRequest(url));
    assert.equal(result.status, 400, url);
    assert.match(result.body, /invalid_request/);
  }
  assert.equal(asked, 0);
});

test("unknown paths and other methods are refused", async () => {
  const handler = createIntrodbBridgeHandler({
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => "{}" })
  });

  assert.equal((await call(handler, fakeRequest("/api/introdb/../debrid/x"))).status, 404);
  assert.equal((await call(handler, fakeRequest("/api/introdb/segments", "POST"))).status, 405);
});

test("the health route answers without touching the upstream", async () => {
  let asked = 0;
  const handler = createIntrodbBridgeHandler({
    fetchImpl: async () => {
      asked += 1;
      return { ok: true, status: 200, text: async () => "{}" };
    }
  });
  const result = await call(handler, fakeRequest("/api/introdb/health"));
  assert.equal(result.status, 200);
  assert.match(result.body, /"ok":true/);
  assert.equal(asked, 0);
});

test("an upstream refusal or an unreachable host becomes a 502, never a crash", async () => {
  const refused = createIntrodbBridgeHandler({
    fetchImpl: async () => ({ ok: false, status: 503 })
  });
  const first = await call(
    refused,
    fakeRequest("/api/introdb/segments?imdb_id=tt14688458&season=2&episode=2")
  );
  assert.equal(first.status, 502);
  assert.match(first.body, /upstream_status_503/);

  const broken = createIntrodbBridgeHandler({
    fetchImpl: async () => {
      throw new TypeError("fetch failed");
    }
  });
  const second = await call(
    broken,
    fakeRequest("/api/introdb/segments?imdb_id=tt14688458&season=2&episode=2")
  );
  assert.equal(second.status, 502);
  assert.match(second.body, /upstream_unreachable/);
});
