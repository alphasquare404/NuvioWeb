import assert from "node:assert/strict";
import test from "node:test";
import { buildRemuxUrl } from "./remuxSource.js";

const ENDPOINT = "/api/remux";

test("the explicit remux URL preserves the source query", () => {
  const source = "https://cdn.test/a.mkv?token=1&x=2";
  const url = buildRemuxUrl(source, ENDPOINT);
  assert.equal(new URL(url, "https://app.test").searchParams.get("u"), source);
  assert.equal(buildRemuxUrl(source, "/api/remux?v=2").includes("?v=2&u="), true);
  assert.equal(buildRemuxUrl(source, ""), "");
});

test("explicit remux preserves the chosen audio track for any source container", () => {
  for (const extension of ["mkv", "mp4", "webm"]) {
    const source = `https://cdn.test/a.${extension}`;
    const url = new URL(buildRemuxUrl(source, ENDPOINT, { audioIndex: 2 }), "https://app.test");
    assert.equal(url.searchParams.get("u"), source);
    assert.equal(url.searchParams.get("ai"), "2");
  }
});
