import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as policy from "../../../core/streams/playerStreamPolicy.js";
import * as labelPolicy from "../../../core/streams/streamLabelPolicy.js";
import * as selector from "../../../core/streams/streamAutoPlaySelector.js";
import { withinStreamSelectionDeadline } from "../../../core/streams/streamAutoResolve.js";
import { classifyPlayback } from "../../../core/player/playbackMethod.js";
import { streamProbeIdentity } from "../../../core/player/streamProbe.js";
const source = await readFile(new URL("./playerScreen.js", import.meta.url), "utf8");
const names = [
  "selectNextEpisodeStreamByAutoPlayPolicy",
  "selectDirectPlayableCandidates",
  "resolveNextEpisodeStreamByAutoPlayPolicy"
];
const methods = names.map(
  (name) => source.match(new RegExp("async " + name + "\\([\\s\\S]*?\\n {2}\\},", "m"))?.[0]
);
assert.ok(methods.every(Boolean));
const facts = {
  container: "mp4",
  videoCodec: "h264",
  audioCodec: "aac",
  audioChannels: 2,
  colorTransfer: "bt709"
};
const row = (id) => ({
  id,
  addonName: "A",
  url: "https://fixture.test/" + id + ".mp4",
  name: "Film.H264.AAC.mp4"
});
const fixtures = [row("first"), row("second"), row("third")];
const base = {
  streamAutoPlayMode: "FIRST_STREAM",
  streamAutoPlayTimeoutSeconds: 1,
  autoplayNextEpisode: true,
  streamAutoPlayHdrPreference: "ANY"
};
function screen(overrides = {}) {
  const dependencies = {
    ...labelPolicy,
    ...policy,
    ...selector,
    withinStreamSelectionDeadline,
    classifyPlayback,
    streamProbeIdentity,
    PlayerSettingsStore: { get: () => base },
    StreamBadgeSettingsStore: {
      snapshot: () => ({ showPlaybackLabels: true, labelAddons: ["A"], clientLabelLimit: 3 })
    },
    addonRepository: { getInstalledAddons: async () => [{ name: "A" }] },
    PROBE_MODE: "client",
    PROBE_ENDPOINT: "",
    PROBE_CLIENT_CONCURRENCY: 2,
    NEXT_EPISODE_SOURCE_RESOLVE_TIMEOUT_MS: 45000,
    getDeviceCapabilities: () => ({ h264: true, aac: true, containers: { mp4: true } }),
    assessPlaybackCapabilities: () => ({}),
    createStreamProber: () => ({ enabled: true, probe: async () => facts }),
    ...overrides.dependencies
  };
  const compiled = new Function(
    "d",
    "const {" + Object.keys(dependencies).join(",") + "}=d;return ({" + methods.join("\n") + "});"
  )(dependencies);
  return Object.assign(
    compiled,
    {
      getCurrentStreamBingeGroup: () => "",
      _nextEpisodeProbeResults: new Map(),
      getPlayableStreamsForVideo: async (_id, _type, { onChunk }) => {
        onChunk(fixtures);
        return fixtures;
      }
    },
    overrides.screen
  );
}
const episode = { videoId: "series:1:2", season: 1, episode: 2 };
const flush = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};

test("Prefer Binge Group falls back without hints or matching groups, retaining matching priority", async () => {
  const s = screen();
  const settings = {
    ...base,
    streamAutoPlayMode: "MANUAL",
    streamAutoPlayPreferBingeGroupForNextEpisode: true
  };
  const options = { installedAddonNames: new Set(["A"]) };
  assert.equal(
    (await s.selectNextEpisodeStreamByAutoPlayPolicy(fixtures, settings, options)).id,
    "first"
  );
  s.getCurrentStreamBingeGroup = () => "same-group";
  assert.equal(
    (await s.selectNextEpisodeStreamByAutoPlayPolicy(fixtures, settings, options)).id,
    "first"
  );
  const matching = [fixtures[0], { ...fixtures[1], behaviorHints: { bingeGroup: "same-group" } }];
  assert.equal(
    (await s.selectNextEpisodeStreamByAutoPlayPolicy(matching, settings, options)).id,
    "second"
  );
  assert.equal(
    await s.selectNextEpisodeStreamByAutoPlayPolicy(fixtures, settings, {
      ...options,
      bingeGroupOnly: true
    }),
    null,
    "a provisional preferred-only lookup can still wait"
  );
  assert.equal(
    await s.selectNextEpisodeStreamByAutoPlayPolicy(
      fixtures,
      {
        ...settings,
        autoplayNextEpisode: false,
        streamAutoPlayPreferBingeGroupForNextEpisode: false
      },
      options
    ),
    null,
    "Manual without auto-next remains manual"
  );
});

test("Next Episode deadline rejects late selection and never starts duplicate concurrent selection", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 10000 });
  let release,
    attempts = 0,
    lastOptions;
  const s = screen({
    screen: {
      selectNextEpisodeStreamByAutoPlayPolicy: async (_rows, _settings, options) => {
        attempts++;
        lastOptions = options;
        return new Promise((r) => {
          release = r;
        });
      }
    }
  });
  const pending = s.resolveNextEpisodeStreamByAutoPlayPolicy(episode, "series", base);
  await flush();
  assert.equal(attempts, 1);
  t.mock.timers.tick(1000);
  await flush();
  const result = await pending;
  assert.equal(result.selectedStream, null);
  assert.equal(result.timedOut, true);
  assert.equal(result.error, null);
  assert.equal(lastOptions.cancelled(), true);
  release(fixtures[0]);
  await flush();
  assert.equal(result.selectedStream, null);
  assert.equal(attempts, 1);
});

test("deadline includes addon lookup and does not start fetching sources after expiry", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 10000 });
  let fetches = 0;
  const s = screen({
    dependencies: { addonRepository: { getInstalledAddons: () => new Promise(() => {}) } },
    screen: {
      getPlayableStreamsForVideo: async () => {
        fetches++;
        return fixtures;
      }
    }
  });
  const pending = s.resolveNextEpisodeStreamByAutoPlayPolicy(episode, "series", base);
  await flush();
  t.mock.timers.tick(1000);
  await flush();
  assert.equal((await pending).timedOut, true);
  assert.equal(fetches, 0);
});

test("Instant selects a partial arrival and Unlimited does not expire at the former 45 second cap", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 10000 });
  let complete;
  const instant = screen({
    screen: {
      getPlayableStreamsForVideo: async (_id, _type, { onChunk }) => {
        onChunk(fixtures);
        return new Promise((r) => {
          complete = r;
        });
      }
    }
  });
  const first = instant.resolveNextEpisodeStreamByAutoPlayPolicy(episode, "series", {
    ...base,
    streamAutoPlayTimeoutSeconds: 0
  });
  await flush();
  assert.equal((await first).selectedStream.id, "first");
  complete(fixtures);
  await flush();
  let completeUnlimited,
    finished = false;
  const unlimited = screen({
    screen: {
      getPlayableStreamsForVideo: () =>
        new Promise((r) => {
          completeUnlimited = r;
        })
    }
  });
  const waiting = unlimited
    .resolveNextEpisodeStreamByAutoPlayPolicy(episode, "series", {
      ...base,
      streamAutoPlayTimeoutSeconds: 2147483647
    })
    .then((r) => {
      finished = true;
      return r;
    });
  await flush();
  t.mock.timers.tick(45001);
  await flush();
  assert.equal(finished, false);
  completeUnlimited(fixtures);
  await flush();
  assert.equal((await waiting).selectedStream.id, "first");
});

test("Only Direct keeps a verified candidate at the deadline and ignores a later probe result", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 10000 });
  const requests = [];
  let late;
  const s = screen({
    dependencies: {
      createStreamProber: () => ({
        enabled: true,
        probe: async (url, options) => {
          requests.push({ url, timeoutMs: options.timeoutMs });
          if (requests.length === 1) return facts;
          return new Promise((r) => {
            late = r;
          });
        }
      })
    }
  });
  const pending = s.resolveNextEpisodeStreamByAutoPlayPolicy(episode, "series", {
    ...base,
    showOnlyDirectStreams: true
  });
  await flush();
  assert.equal(requests.length, 2);
  assert.ok(requests.every((r) => r.timeoutMs <= 1000));
  t.mock.timers.tick(1000);
  await flush();
  const result = await pending;
  assert.equal(result.selectedStream.id, "first");
  assert.equal(result.timedOut, false);
  late(facts);
  await flush();
  assert.equal(requests.length, 2, "third probe cannot start after the deadline");
  assert.equal(s._nextEpisodeProbeResults.size, 1);
});

test("Instant Only Direct selects the first eligible file without probing the rest", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 10000 });
  let probes = 0;
  const s = screen({
    dependencies: {
      createStreamProber: () => ({
        enabled: true,
        probe: async () => {
          probes++;
          return facts;
        }
      })
    }
  });
  const pending = s.resolveNextEpisodeStreamByAutoPlayPolicy(episode, "series", {
    ...base,
    showOnlyDirectStreams: true,
    streamAutoPlayTimeoutSeconds: 0
  });
  await flush();
  assert.equal((await pending).selectedStream.id, "first");
  assert.equal(probes, 1);
});

test("Next Episode filename Only Direct performs no probe or metadata initialization", async () => {
  const s = screen({
    dependencies: {
      StreamBadgeSettingsStore: {
        snapshot: () => ({
          showPlaybackLabels: true,
          labelAddons: ["A"],
          playbackLabelSource: "FILE_NAME"
        })
      },
      createStreamProber: () => {
        throw Error("filename mode must not initialize probes");
      }
    }
  });
  const rows = [{ ...row("bad"), name: "Film.HEVC.AAC.mp4" }, row("good")];
  const chosen = await s.selectNextEpisodeStreamByAutoPlayPolicy(
    rows,
    { ...base, showOnlyDirectStreams: true },
    { installedAddonNames: new Set(["A"]) }
  );
  assert.equal(chosen.id, "good");
  assert.equal(s._nextEpisodeProbeResults.size, 0);
});

test("Next Episode ignores a stale Only Direct flag when labels are disabled", async () => {
  const s = screen({
    dependencies: {
      StreamBadgeSettingsStore: {
        snapshot: () => ({ showPlaybackLabels: false, labelAddons: ["A"] })
      },
      createStreamProber: () => {
        throw Error("disabled labels must not initialize probes");
      }
    }
  });
  assert.equal(
    (
      await s.selectNextEpisodeStreamByAutoPlayPolicy(
        fixtures,
        { ...base, showOnlyDirectStreams: true },
        { installedAddonNames: new Set(["A"]) }
      )
    ).id,
    "first"
  );
});
