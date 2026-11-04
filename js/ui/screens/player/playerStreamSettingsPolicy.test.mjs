import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as policy from "../../../core/streams/playerStreamPolicy.js";
import * as labelPolicy from "../../../core/streams/streamLabelPolicy.js";
import * as selector from "../../../core/streams/streamAutoPlaySelector.js";
import {
  withinStreamSelectionDeadline,
  resolveAutoPlayStream,
  reportAutoPlaySelection,
  streamSelectionDeadline
} from "../../../core/streams/streamAutoResolve.js";
import { classifyPlayback } from "../../../core/player/playbackMethod.js";
import { streamProbeIdentity } from "../../../core/player/streamProbe.js";
const source = await readFile(new URL("./playerScreen.js", import.meta.url), "utf8");
const names = [
  "selectNextEpisodeStreamByAutoPlayPolicy",
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
    resolveAutoPlayStream,
    reportAutoPlaySelection,
    streamSelectionDeadline,
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

test("Next Episode evaluates a ready permitted addon at deadline even when another addon stalls", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 10000 });
  let complete;
  const s = screen({
    screen: {
      getPlayableStreamsForVideo: async (_id, _type, { onChunk }) => {
        onChunk([{ ...row("forbidden"), addonName: "B" }, fixtures[0]]);
        return new Promise((resolve) => {
          complete = resolve;
        });
      }
    }
  });
  const pending = s.resolveNextEpisodeStreamByAutoPlayPolicy(episode, "series", {
    ...base,
    streamAutoPlaySource: "INSTALLED_ADDONS_ONLY",
    streamAutoPlaySelectedAddons: ["A"]
  });
  await flush();
  t.mock.timers.tick(1000);
  await flush();
  const result = await pending;
  assert.equal(result.selectedStream.id, "first");
  assert.equal(result.timedOut, false);
  complete([row("late")]);
  await flush();
  assert.equal(result.selectedStream.id, "first");
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

test("Back stops next-episode discovery without waiting for its original timeout", async () => {
  const s = screen({ screen: { getPlayableStreamsForVideo: () => new Promise(() => {}) } });
  const pending = s.resolveNextEpisodeStreamByAutoPlayPolicy(episode, "series", base);
  await flush();
  assert.equal(typeof s._nextSourceDiscoveryCancel, "function");
  s._nextSourceDiscoveryCancel();
  const result = await pending;
  assert.equal(result.selectedStream, null);
  assert.equal(s._nextSourceDiscoveryCancel, null);
});

test("Unlimited does not release Next Episode early for a matching binge group", async () => {
  let complete,
    finished = false;
  const matching = { ...row("same"), behaviorHints: { bingeGroup: "g" } };
  const s = screen({
    screen: {
      getCurrentStreamBingeGroup: () => "g",
      getPlayableStreamsForVideo: async (_id, _type, { onChunk }) => {
        onChunk([matching]);
        return new Promise((r) => {
          complete = r;
        });
      }
    }
  });
  const pending = s
    .resolveNextEpisodeStreamByAutoPlayPolicy(episode, "series", {
      ...base,
      streamAutoPlayTimeoutSeconds: 2147483647,
      streamAutoPlayPreferBingeGroupForNextEpisode: true
    })
    .then((r) => {
      finished = true;
      return r;
    });
  await flush();
  assert.equal(finished, false);
  complete([matching]);
  await flush();
  assert.equal((await pending).selectedStream.id, "same");
});
