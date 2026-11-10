import assert from "node:assert/strict";
import test from "node:test";
import { chooseClientVideoEncoding } from "./transcodePipeline.mjs";

const dimensions = ({ width, height }) => [width, height];

test("client transcode preserves supported source size up to UHD without upscaling", async () => {
  const supports = async () => true;
  assert.deepEqual(dimensions(await chooseClientVideoEncoding(640, 360, supports)), [640, 360]);
  assert.deepEqual(dimensions(await chooseClientVideoEncoding(1920, 1080, supports)), [1920, 1080]);
  assert.deepEqual(dimensions(await chooseClientVideoEncoding(3840, 2160, supports)), [3840, 2160]);
  assert.deepEqual(dimensions(await chooseClientVideoEncoding(7680, 4320, supports)), [3840, 2160]);
  assert.deepEqual(dimensions(await chooseClientVideoEncoding(2160, 3840, supports)), [2160, 3840]);
});

test("client transcode only steps down when the device rejects the larger configuration", async () => {
  const attempts = [];
  const result = await chooseClientVideoEncoding(3840, 2160, async (codec, config) => {
    assert.equal(codec, "avc");
    attempts.push(config);
    return config.height <= 1080;
  });
  assert.deepEqual(attempts.map(dimensions), [
    [3840, 2160],
    [2560, 1440],
    [1920, 1080]
  ]);
  assert.deepEqual(dimensions(result), [1920, 1080]);
  assert.ok(attempts[0].bitrate > result.bitrate);
  assert.equal(await chooseClientVideoEncoding(640, 360, async () => false), null);
});

test("client video transcode tries a playable alternate codec before shrinking", async () => {
  const result = await chooseClientVideoEncoding(
    3840,
    2160,
    async (codec, { width }) => codec === "vp9" && width === 3840,
    ["avc", "vp9"]
  );
  assert.equal(result.codec, "vp9");
  assert.deepEqual(dimensions(result), [3840, 2160]);
});
