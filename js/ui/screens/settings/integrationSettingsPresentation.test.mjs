import test from "node:test";
import assert from "node:assert/strict";
import {
  activeIntegrationService,
  integrationControlGroups,
  debridRuleGroups
} from "./integrationSettingsPresentation.js";

test("Integration service defaults follow the wide panel and narrow accordion", () => {
  assert.equal(activeIntegrationService("hub"), null);
  assert.equal(activeIntegrationService("hub", true), "debrid");
  assert.equal(activeIntegrationService("tmdb", true), "tmdb");
  assert.equal(activeIntegrationService("invalid"), null);
});

test("Debrid retains every existing rule, gated row and future control exactly once", () => {
  const attrs = [
    "Resolutions",
    "Qualities",
    "VisualTags",
    "AudioTags",
    "AudioChannels",
    "Encodes",
    "Languages"
  ];
  const rules = attrs
    .flatMap((a) =>
      ["preferred", "required", "excluded"].map((p) => `integration:debrid:pref:${p}${a}`)
    )
    .concat(
      ["requiredReleaseGroups", "excludedReleaseGroups", "futureRule"].map(
        (s) => `integration:debrid:pref:${s}`
      )
    );
  const keys = [
    "integration:back",
    ...[
      "key:torbox",
      "key:premiumize",
      "enabled",
      "cloud",
      "provider",
      "prepareToggle",
      "prepareCount",
      "maxResults",
      "sort",
      "maxPerResolution",
      "maxPerQuality",
      "sizeRange",
      "nameTemplate",
      "descriptionTemplate",
      "resetTemplates",
      "futureControl"
    ].map((s) => "integration:debrid:" + s),
    ...rules
  ];
  const groups = integrationControlGroups(keys, "debrid");
  assert.deepEqual(
    groups.map((g) => g.id),
    ["accounts", "playback", "preferences", "formatting", "additional"]
  );
  const shown = groups.flatMap((g) => g.keys);
  assert.equal(new Set(shown).size, shown.length);
  assert.deepEqual(shown.toSorted(), keys.filter((k) => k !== "integration:back").toSorted());
  assert.deepEqual(
    debridRuleGroups(rules)
      .flatMap((g) => g.keys)
      .toSorted(),
    rules.toSorted()
  );
  assert.equal(debridRuleGroups(rules).find((g) => g.attribute === "ReleaseGroups").keys.length, 2);
});

test("Metadata controls keep their connection, usage and planned groups without mutations", () => {
  for (const [service, suffixes, expected] of [
    [
      "tmdb",
      [
        "enabled",
        "key",
        "modernHome",
        "continueWatching",
        "language",
        "artwork",
        "basic",
        "details",
        "releaseDates",
        "credits",
        "productions",
        "networks",
        "episodes",
        "trailers",
        "moreLikeThis",
        "collections"
      ],
      ["connection", "usage", "information", "more"]
    ],
    [
      "mdblist",
      [
        "enabled",
        "key",
        "imdb",
        "trakt",
        "tmdb",
        "letterboxd",
        "tomatoes",
        "audience",
        "metacritic",
        "mal"
      ],
      ["connection", "ratings"]
    ],
    ["animeskip", ["enabled", "id"], ["planned"]]
  ]) {
    const keys = suffixes.map((s) => `integration:${service}:${s}`),
      before = [...keys],
      groups = integrationControlGroups(keys, service);
    assert.deepEqual(
      groups.map((g) => g.id),
      expected
    );
    assert.deepEqual(
      groups.flatMap((g) => g.keys),
      before
    );
    assert.deepEqual(keys, before);
  }
});
