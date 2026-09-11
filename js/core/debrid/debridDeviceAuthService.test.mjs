import assert from "node:assert/strict";
import test from "node:test";

import {
  DEBRID_DEVICE_AUTH_STATUS,
  isDeviceAuthorizationExpired,
  parseTorboxDeviceTokenResult
} from "./debridDeviceAuthService.js";

test("TorBox documented success:false pending response remains pending for the next poll", () => {
  const result = parseTorboxDeviceTokenResult({
    ok: false,
    status: 400,
    data: { ok: false, error: "authorization_pending", status: 400 }
  });

  assert.deepEqual(result, { status: DEBRID_DEVICE_AUTH_STATUS.PENDING });
});

test("TorBox authorization completes only when the existing token envelope is returned", () => {
  const result = parseTorboxDeviceTokenResult({
    ok: true,
    status: 200,
    data: { success: true, data: { access_token: "test-token" } }
  });

  assert.deepEqual(result, {
    status: DEBRID_DEVICE_AUTH_STATUS.AUTHORIZED,
    accessToken: "test-token"
  });
});

test("TorBox expiry and real failures stop polling instead of being treated as pending", () => {
  const expired = parseTorboxDeviceTokenResult({
    ok: false,
    status: 400,
    data: { ok: false, error: "authorization_expired", status: 400 }
  });
  const failed = parseTorboxDeviceTokenResult({
    ok: false,
    status: 400,
    data: { ok: false, error: "provider_request_failed", status: 400 }
  });

  assert.equal(expired.status, DEBRID_DEVICE_AUTH_STATUS.EXPIRED);
  assert.equal(failed.status, DEBRID_DEVICE_AUTH_STATUS.FAILED);
});

test("device authorization expires from the start response timestamp without another redeem call", () => {
  assert.equal(isDeviceAuthorizationExpired("2030-01-01T00:00:00Z", Date.parse("2029-12-31T23:59:59Z")), false);
  assert.equal(isDeviceAuthorizationExpired("2030-01-01T00:00:00Z", Date.parse("2030-01-01T00:00:00Z")), true);
  assert.equal(isDeviceAuthorizationExpired("not-a-date", Date.now()), false);
});
