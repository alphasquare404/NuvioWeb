import test from "node:test";
import assert from "node:assert/strict";
import { secureMediaUrl } from "./secureMediaUrl.js";

test("HTTPS pages upgrade public media URLs without losing provider query parameters", () => {
  const source = "http://media.test/videos/id/stream?api_key=fake-key&mediaSourceId=id&Static=true";
  const secure = secureMediaUrl(source, "https:");
  assert.equal(secure, source.replace("http:", "https:"));
  assert.equal(new URL(secure).searchParams.get("api_key"), "fake-key");
  assert.equal(secureMediaUrl(source, "http:"), source);
  assert.equal(secureMediaUrl(secure, "https:"), secure);
});
test("LAN, local names, non-network sources and explicit TLS ports keep their meaning", () => {
  for (const source of [
    "http://192.168.1.2:8096/videos/id/stream",
    "http://[::1]:8096/stream",
    "http://localhost:8096/stream",
    "http://media.local/stream",
    "blob:local",
    "magnet:?xt=fake",
    "/relative/stream"
  ])
    assert.equal(secureMediaUrl(source, "https:"), source);
  assert.equal(
    secureMediaUrl("http://media.test:8443/video", "https:"),
    "https://media.test:8443/video"
  );
});
