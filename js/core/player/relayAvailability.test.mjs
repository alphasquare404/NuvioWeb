import test from "node:test";
import assert from "node:assert/strict";
import { resolveRelayAvailability } from "./relayAvailability.js";
const fetchFor = (data) => async () => ({ ok: true, json: async () => data });
test("configured endpoints need a valid health response", async () => {
  assert.equal(await resolveRelayAvailability({ endpoint: "" }), false);
  assert.equal(
    await resolveRelayAvailability({ endpoint: "/api/remux", fetchImpl: fetchFor({ ok: true }) }),
    true
  );
  assert.equal(
    await resolveRelayAvailability({ endpoint: "/api/remux", fetchImpl: fetchFor({}) }),
    null
  );
  assert.equal(
    await resolveRelayAvailability({
      endpoint: "/api/remux",
      fetchImpl: async () => {
        throw Error("offline");
      }
    }),
    false
  );
});
test("audio conversion checks access and does not assume LAN admission", async () => {
  const options = { endpoint: "/api/transcode", transcode: true };
  assert.equal(
    await resolveRelayAvailability({
      ...options,
      fetchImpl: fetchFor({ ok: true, access: "token" })
    }),
    false
  );
  assert.equal(
    await resolveRelayAvailability({
      ...options,
      token: "secret",
      fetchImpl: fetchFor({ ok: true, access: "token" })
    }),
    true
  );
  assert.equal(
    await resolveRelayAvailability({
      ...options,
      fetchImpl: fetchFor({ ok: true, access: "lan" })
    }),
    null
  );
  assert.equal(
    await resolveRelayAvailability({
      ...options,
      fetchImpl: fetchFor({ ok: true, access: "open" })
    }),
    true
  );
});
test("exhausted relay budget is not offered", async () => {
  assert.equal(
    await resolveRelayAvailability({
      endpoint: "/api/remux",
      fetchImpl: fetchFor({ ok: true, dailyBudgetBytes: 100, remainingBytesToday: 0 })
    }),
    false
  );
});
