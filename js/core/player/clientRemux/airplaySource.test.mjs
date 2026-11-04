import test from "node:test";
import assert from "node:assert/strict";
import { attachRemuxMediaSources } from "./airplaySource.mjs";

function mockVideo(safari = true) {
  const children = [];
  const video = {
    children,
    attributes: { src: "previous" },
    ownerDocument: {
      createElement: () => ({
        attributes: {},
        setAttribute(key, value) {
          this.attributes[key] = value;
        },
        remove() {
          children.splice(children.indexOf(this), 1);
        }
      })
    },
    append: (...nodes) => children.push(...nodes),
    setAttribute(key, value) {
      this.attributes[key] = value;
    },
    removeAttribute(key) {
      delete this.attributes[key];
    }
  };
  if (safari) video.webkitShowPlaybackTargetPicker = () => {};
  return video;
}

test("Safari keeps local MSE first and the exact original tokenized URL as AirPlay alternative", () => {
  const video = mockVideo();
  const url = "https://cdn.example/stream?token=unchanged&file=1";
  const cleanup = attachRemuxMediaSources(video, "blob:local", url);
  assert.equal(video.attributes.src, undefined, "src must not override child sources");
  assert.equal(video.children.length, 2);
  assert.equal(video.children[0].src, "blob:local");
  assert.equal(video.children[0].type, "video/mp4");
  assert.equal(video.children[1].src, url);
  assert.equal(video.children[1].attributes["data-nuvio-airplay-source"], "");
  assert.equal(video.disableRemotePlayback, false);
  cleanup();
  assert.equal(
    video.children.length,
    0,
    "old stream URLs must be removed before seek or switching"
  );
  attachRemuxMediaSources(video, "blob:second", "https://cdn.example/second");
  assert.equal(video.children.length, 2);
  assert.equal(video.children[1].src, "https://cdn.example/second");
});

test("non-Safari and local-only playback retain the existing single MSE URL", () => {
  for (const [safari, url] of [
    [false, "https://cdn.example/stream"],
    [true, "blob:offline"]
  ]) {
    const video = mockVideo(safari);
    const cleanup = attachRemuxMediaSources(video, "blob:local", url);
    assert.equal(video.src, "blob:local");
    assert.equal(video.children.length, 0);
    assert.equal(video.disableRemotePlayback, true);
    cleanup();
  }
});
