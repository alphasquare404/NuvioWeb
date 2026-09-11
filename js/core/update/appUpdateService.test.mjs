import assert from "node:assert/strict";
import test from "node:test";
import { getLatestAppUpdate } from "./appUpdateService.js";

test("update checks use the fork release endpoint and compare fork versions", async () => {
  let requestedUrl = "";
  const update = await getLatestAppUpdate({
    currentVersion: "0.1.0",
    fetchImpl: async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        json: async () => ({ tag_name: "v0.1.1", name: "0.1.1", html_url: "https://example.test/release" })
      };
    }
  });

  assert.equal(requestedUrl, "https://api.github.com/repos/alphasquare404/NuvioWeb/releases/latest");
  assert.equal(update?.tag, "v0.1.1");
});
