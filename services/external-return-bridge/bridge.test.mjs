import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createExternalReturnServer, createExternalReturnStore } from "./bridge.mjs";

const TOKEN = "0123456789abcdef0123456789abcdef";

async function withBridge(options, run) {
  const server = createExternalReturnServer(options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("external return stores only accepted stopped fields and collects once", async () => {
  await withBridge({}, async (baseUrl) => {
    const report = await fetch(`${baseUrl}/api/external-return/report/${TOKEN}?outcome=stopped&position=120&duration=300&url=https%3A%2F%2Fsecret.example%2Fsigned`);
    assert.equal(report.status, 200);
    const page = await report.text();
    assert.match(page, /Playback received/);
    assert.match(page, /02:00/);
    assert.match(page, /Return to NuvioWeb/);
    assert.doesNotMatch(page, /window\.close|location\.replace|setTimeout\(/);
    assert.doesNotMatch(page, /Debug|Original callback|Synthetic finish|position present/);
    assert.equal(page.includes("secret.example"), false);

    const collected = await fetch(`${baseUrl}/api/external-return/collect/${TOKEN}`);
    assert.deepEqual(await collected.json(), { found: true, outcome: "stopped", provider: "outplayer", sourceOutcome: "stopped", position: 120, duration: 300, progress: null, parameterNames: ["position", "duration"] });

    const second = await fetch(`${baseUrl}/api/external-return/collect/${TOKEN}`);
    assert.deepEqual(await second.json(), { found: false });
  });
});

test("external return preserves the proven Outplayer finish envelope without duration", async () => {
  await withBridge({}, async (baseUrl) => {
    const finished = await fetch(`${baseUrl}/api/external-return/report/${TOKEN}?outcome=stopped&provider=outplayer&sourceOutcome=finished`);
    assert.equal(finished.status, 200);
    const page = await finished.text();
    assert.match(page, /Playback completed/);
    assert.match(page, /Marked as finished/);
    assert.doesNotMatch(page, /Debug|Original callback|Synthetic finish|position present/);
    assert.deepEqual(await (await fetch(`${baseUrl}/api/external-return/collect/${TOKEN}`)).json(), {
      found: true,
      outcome: "stopped",
      provider: "outplayer",
      sourceOutcome: "finished",
      position: null,
      duration: null,
      progress: null,
      parameterNames: []
    });

    for (const query of ["outcome=stopped&position=-1", "outcome=stopped&duration=nope", "outcome=wrong", "outcome=stopped&position=500&duration=100"]) {
      const response = await fetch(`${baseUrl}/api/external-return/report/${TOKEN}?${query}`);
      assert.equal(response.status, 400);
    }
  });
});

test("Infuse returns only its finite position and never exposes lastPlayedUrl", async () => {
  await withBridge({}, async (baseUrl) => {
    const report = await fetch(`${baseUrl}/api/external-return/report/${TOKEN}?provider=infuse&outcome=stopped&position=840&lastPlayedUrl=https%3A%2F%2Fsecret.example%2Fsigned`);
    assert.equal(report.status, 200);
    const collected = await (await fetch(`${baseUrl}/api/external-return/collect/${TOKEN}`)).json();
    assert.equal(collected.position, 840);
    assert.deepEqual(collected.parameterNames, ["position", "lastPlayedUrl"]);
    assert.equal(JSON.stringify(collected).includes("secret.example"), false);
    const invalid = await fetch(`${baseUrl}/api/external-return/report/${TOKEN}?provider=infuse&outcome=stopped&position=nope`);
    assert.equal(invalid.status, 400);
  });
});

test("Lenna accepts a returned position without exposing lastPlayedUrl", async () => {
  await withBridge({}, async (baseUrl) => {
    const report = await fetch(`${baseUrl}/api/external-return/report/${TOKEN}?provider=lenna&outcome=stopped&sourceOutcome=success&position=30&lastPlayedUrl=https%3A%2F%2Fsecret.example%2Fsigned`);
    const page = await report.text();
    assert.match(page, /Playback received/);
    assert.equal(page.includes("secret.example"), false);
    const collected = await (await fetch(`${baseUrl}/api/external-return/collect/${TOKEN}`)).json();
    assert.deepEqual(collected.parameterNames, ["position", "lastPlayedUrl"]);
  });
});

test("external return expires reports and bounds storage", () => {
  let current = 1_000;
  const store = createExternalReturnStore({ now: () => current, ttlMs: 10, maxRecords: 2 });
  assert.equal(store.put(TOKEN, { outcome: "finished", position: null, duration: null }), true);
  current += 11;
  assert.equal(store.take(TOKEN), null);
  assert.equal(store.put(TOKEN, { outcome: "finished", position: null, duration: null }), true);
  assert.equal(store.put("11111111111111111111111111111111", { outcome: "finished", position: null, duration: null }), true);
  assert.equal(store.put("22222222222222222222222222222222", { outcome: "finished", position: null, duration: null }), true);
  assert.equal(store.size(), 2);
});

test("temporary Push bindings share the bounded handoff lifetime", () => {
  let current = 1_000;
  const store = createExternalReturnStore({ now: () => current, ttlMs: 10, bindingTtlMs: 10, maxRecords: 2 });
  const subscription = (id) => ({ endpoint: `https://push.example/${id}`, keys: { p256dh: "key", auth: "auth" } });
  const first = "a".repeat(32);
  const second = "b".repeat(32);
  const third = "c".repeat(32);

  assert.equal(store.bind(first, subscription("one")), true);
  assert.equal(store.bind(second, subscription("two")), true);
  assert.equal(store.bind(third, subscription("three")), true);
  assert.equal(store.takeBinding(first), null);
  assert.deepEqual(store.takeBinding(second), subscription("two"));
  current += 11;
  assert.equal(store.takeBinding(third), null);
});

test("the callback page offers notifications only where they could have worked", async () => {
  const env = {
    NUVIO_WEB_PUSH_PUBLIC_KEY: "public",
    NUVIO_WEB_PUSH_PRIVATE_KEY: "private",
    NUVIO_WEB_PUSH_SUBJECT: "mailto:nuvio@example.com"
  };
  const subscription = { endpoint: "https://push.example/e", keys: { p256dh: "p", auth: "a" } };

  // Push configured, nothing subscribed: this is the viewer who can act on it.
  await withBridge({ env }, async (baseUrl) => {
    const page = await (
      await fetch(`${baseUrl}/api/external-return/report/${TOKEN}?outcome=stopped&position=120&duration=300`)
    ).text();
    assert.match(page, /class="offer"/);
    assert.match(page, /Settings/);
  });

  // Already subscribed: the notification went out, so there is nothing to offer.
  await withBridge(
    { env, sender: { setVapidDetails() {}, async sendNotification() {} } },
    async (baseUrl) => {
      await fetch(`${baseUrl}/api/external-return/push/bind`, {
        method: "POST",
        body: JSON.stringify({ token: TOKEN, subscription })
      });
      const page = await (
        await fetch(`${baseUrl}/api/external-return/report/${TOKEN}?outcome=stopped&position=120&duration=300`)
      ).text();
      assert.doesNotMatch(page, /class="offer"/);
    }
  );

  // No push on this server at all: the offer would point at something that
  // cannot be turned on, so it is never made.
  await withBridge({ env: {} }, async (baseUrl) => {
    const page = await (
      await fetch(`${baseUrl}/api/external-return/report/${TOKEN}?outcome=stopped&position=120&duration=300`)
    ).text();
    assert.doesNotMatch(page, /class="offer"/);
  });
});

test("an Automation return sends no notification, makes no offer, and closes its own page", async () => {
  const env = {
    NUVIO_WEB_PUSH_PUBLIC_KEY: "public",
    NUVIO_WEB_PUSH_PRIVATE_KEY: "private",
    NUVIO_WEB_PUSH_SUBJECT: "https://nuvio.example"
  };
  const subscription = { endpoint: "https://push.example/e", keys: { p256dh: "p", auth: "a" } };

  // A binding left over from before the person switched must not win: the flag
  // on the report decides, or switching to an Automation would keep sending a
  // notification for the rest of the binding's six hours.
  let sent = 0;
  await withBridge(
    {
      env,
      sender: {
        setVapidDetails() {},
        async sendNotification() {
          sent += 1;
        }
      }
    },
    async (baseUrl) => {
      await fetch(`${baseUrl}/api/external-return/push/bind`, {
        method: "POST",
        body: JSON.stringify({ token: TOKEN, subscription })
      });
      const page = await (
        await fetch(
          `${baseUrl}/api/external-return/report/${TOKEN}?outcome=stopped&position=120&duration=300&return=automation`
        )
      ).text();
      assert.equal(sent, 0, "no notification is sent for an Automation return");
      assert.doesNotMatch(page, /class="offer"/, "no advert for a second way back");
      assert.match(page, /window.close/, "the page left behind in Safari closes itself");
      assert.match(page, /Shortcut is opening NuvioWeb/);
    }
  );

  // The report itself is stored exactly as it would be otherwise: the flag
  // changes what the relay says and sends, never what it keeps.
  await withBridge({ env }, async (baseUrl) => {
    await fetch(
      `${baseUrl}/api/external-return/report/${TOKEN}?outcome=stopped&position=120&duration=300&return=automation`
    );
    const report = await (await fetch(`${baseUrl}/api/external-return/collect/${TOKEN}`)).json();
    assert.equal(report.found, true);
    assert.equal(report.position, 120);
    assert.equal(report.outcome, "stopped");
  });

  // Any other value is not a flag. An unrecognised return mode must fall back
  // to the ordinary page rather than silently suppressing the notification.
  await withBridge({ env }, async (baseUrl) => {
    const page = await (
      await fetch(
        `${baseUrl}/api/external-return/report/${TOKEN}?outcome=stopped&position=120&duration=300&return=something-else`
      )
    ).text();
    assert.match(page, /class="offer"/);
    assert.doesNotMatch(page, /window.close/);
  });
});
