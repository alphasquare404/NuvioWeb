import test from "node:test";
import assert from "node:assert/strict";
import { parseTorrentioTorboxUrl, resolveTorboxAddonUrl } from "./torboxAddonUrlResolver.js";
const token = "credential-test",
  hash = "a".repeat(40);
const source = `https://torrentio.strem.fun/resolve/torbox/${token}/${hash}/video.mp4/0/video.mp4`;
test("only a known HTTPS Torrentio TorBox URL can supply host resolve credentials", () => {
  assert.deepEqual(parseTorrentioTorboxUrl(source), {
    apiKey: token,
    infoHash: hash,
    fileIdx: 0,
    entry: "video.mp4",
    filename: "video.mp4"
  });
  for (const url of [
    source.replace("https:", "http:"),
    source.replace("torrentio.strem.fun", "evil.test"),
    source.replace("torbox/", "alldebrid/"),
    source.replace(hash, "invalid"),
    source.replace("/0/", "/-1/"),
    source.replace(token, "secret%0aheader")
  ])
    assert.equal(parseTorrentioTorboxUrl(url), null);
});
test("host resolve sends one fixed POST, with the credential only in Authorization", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ success: true, data: "https://cdn.test/signed" }));
  };
  assert.deepEqual(await resolveTorboxAddonUrl(source), { url: "https://cdn.test/signed" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/debrid/torbox/link/from-addon");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${token}`);
  assert.equal(calls[0].options.body.includes(token), false);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    infoHash: hash,
    fileIdx: 0,
    entry: "video.mp4",
    filename: "video.mp4"
  });
});
test("provider failure and abort do not produce a guessed CDN link", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async () => new Response("{}", { status: 502 });
  assert.equal(await resolveTorboxAddonUrl(source), null);
  globalThis.fetch = () => assert.fail("aborted requests must not send credentials");
  assert.equal(await resolveTorboxAddonUrl(source, { signal: AbortSignal.abort() }), null);
});
