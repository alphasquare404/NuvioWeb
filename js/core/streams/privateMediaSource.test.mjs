import assert from "node:assert/strict";
import test from "node:test";
import { buildRemuxUrl } from "../player/remuxSource.js";
import { createStreamProber } from "../player/streamProbe.js";
import { buildTranscodePlaylistUrl, buildTranscodeUrl } from "../player/transcodeSource.js";
import { createClientMediaUrlResolver } from "./clientMediaUrlResolver.js";
import { isPrivateMediaUrl, registerPrivateMediaOrigin } from "./privateMediaSource.js";

test("private playback URLs never use the host resolver, server probe, remux or transcode", async () => {
  registerPrivateMediaOrigin("https://my-jellyfin.example/jellyfin");
  let calls = 0;
  const serverRequest = async () => {
    calls++;
    throw new Error("private URL reached a server helper");
  };
  const resolver = createClientMediaUrlResolver({
    allowHostResolve: true,
    supportsHostUrl: () => true,
    hostResolve: serverRequest
  });
  const prober = createStreamProber({ endpoint: "/api/probe", fetchImpl: serverRequest });
  for (const url of [
    "https://127.1/video.mp4",
    "http://192.168.1.10/video.mp4",
    "https://jellyfin.local/video.mp4",
    "https://[::1]/video.mp4",
    "https://[fd00::1]/video.mp4",
    "https://[::ffff:192.168.1.10]/video.mp4",
    "https://my-jellyfin.example/alternate.mp4",
    "https://unregistered-emby.example/emby/Videos/42/stream?api_key=test"
  ]) {
    assert.equal(isPrivateMediaUrl(url), true, url);
    assert.equal(resolver.canUseHost(url), false);
    assert.equal((await resolver.resolve(url, { skipDirect: true })).ok, false);
    assert.equal(await prober.probe(url), null);
    assert.equal(buildRemuxUrl(url, "/api/remux"), "");
    assert.equal(buildTranscodeUrl(url, { endpoint: "/api/transcode" }), "");
    assert.equal(buildTranscodePlaylistUrl(url, { endpoint: "/api/transcode" }), "");
  }
  assert.equal(calls, 0);
  assert.equal(resolver.canUseHost("https://public.example/movie.mkv"), true);
  assert.equal(isPrivateMediaUrl("https://[2606:4700::1]/video.mp4"), false);
});
