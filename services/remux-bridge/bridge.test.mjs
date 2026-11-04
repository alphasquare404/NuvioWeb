import assert from "node:assert/strict";
import test from "node:test";
import { parseByteRange, parseRemuxSource } from "./bridge.mjs";

test("only an http(s) source without embedded credentials is accepted", () => {
  assert.equal(parseRemuxSource("https://cdn.test/a.mkv").ok, true);
  assert.equal(parseRemuxSource("http://cdn.test/a.mkv").ok, true);
  assert.equal(parseRemuxSource("file:///etc/passwd").reason, "unsupported-scheme");
  assert.equal(parseRemuxSource("blob:https://app.test/1").reason, "unsupported-scheme");
  assert.equal(parseRemuxSource("").reason, "missing-source");
  assert.equal(parseRemuxSource("not a url").reason, "invalid-url");
  assert.equal(
    parseRemuxSource("https://user:pass@cdn.test/a.mkv").reason,
    "credentials-not-allowed"
  );
});

test("the same source always hashes to the same cache key", () => {
  const first = parseRemuxSource("https://cdn.test/a.mkv");
  const second = parseRemuxSource("https://cdn.test/a.mkv");
  const other = parseRemuxSource("https://cdn.test/b.mkv");
  assert.equal(first.key, second.key);
  assert.notEqual(first.key, other.key);
});

test("a host allowlist matches the host and its subdomains only", () => {
  const allowHosts = ["tb-cdn.io", "example.com"];
  assert.equal(parseRemuxSource("https://store-1.wnam.tb-cdn.io/a.mkv", { allowHosts }).ok, true);
  assert.equal(parseRemuxSource("https://example.com/a.mkv", { allowHosts }).ok, true);
  assert.equal(
    parseRemuxSource("https://evil.test/a.mkv", { allowHosts }).reason,
    "host-not-allowed"
  );
  // A suffix that merely looks similar must not pass.
  assert.equal(
    parseRemuxSource("https://nottb-cdn.io.evil.test/a.mkv", { allowHosts }).reason,
    "host-not-allowed"
  );
});

test("byte ranges are clamped to the file, and nonsense is refused", () => {
  assert.deepEqual(parseByteRange("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(parseByteRange("bytes=900-", 1000), { start: 900, end: 999 });
  assert.deepEqual(parseByteRange("bytes=-100", 1000), { start: 900, end: 999 });
  // An end past the file is clamped rather than trusted.
  assert.deepEqual(parseByteRange("bytes=0-5000", 1000), { start: 0, end: 999 });
  assert.equal(parseByteRange("bytes=2000-3000", 1000), null);
  assert.equal(parseByteRange("bytes=abc", 1000), null);
  assert.equal(parseByteRange("", 1000), null);
  assert.equal(parseByteRange("bytes=0-10", 0), null);
});

test("audio track selection belongs in the remux identity and rejects invalid indices", () => {
  const first = parseRemuxSource("https://cdn.test/a.mkv");
  const second = parseRemuxSource("https://cdn.test/a.mkv", { audioIndex: 1 });
  assert.notEqual(first.key, second.key);
  assert.equal(second.audioIndex, 1);
  for (const audioIndex of [-1, 1.5, 128, "bad"])
    assert.equal(parseRemuxSource("https://cdn.test/a.mkv", { audioIndex }).ok, false);
});
