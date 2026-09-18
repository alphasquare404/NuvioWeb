import assert from "node:assert/strict";
import test from "node:test";

const { continueWatchingEnrichmentSignatureFor } = await import(
  "./continueWatchingEnrichmentSignature.js"
);

const ON = {
  enabled: true,
  enrichContinueWatching: true,
  language: "en",
  useArtwork: true,
  useBasicInfo: true,
  useDetails: true,
  useReleaseDates: false,
  useEpisodes: true
};

test("enrichment that cannot run shares one signature, whatever the reason", () => {
  const off = "tmdb:off";
  assert.equal(continueWatchingEnrichmentSignatureFor({ ...ON, enabled: false }, true), off);
  assert.equal(
    continueWatchingEnrichmentSignatureFor({ ...ON, enrichContinueWatching: false }, true),
    off
  );
  assert.equal(continueWatchingEnrichmentSignatureFor(ON, false), off, "no API key means no work");
});

test("turning enrichment on changes the signature, so cached entries are re-enriched", () => {
  const before = continueWatchingEnrichmentSignatureFor({ ...ON, enrichContinueWatching: false }, true);
  const after = continueWatchingEnrichmentSignatureFor(ON, true);
  assert.notEqual(before, after);
});

test("settings that change the enriched result change the signature", () => {
  const base = continueWatchingEnrichmentSignatureFor(ON, true);
  for (const patch of [
    { language: "id" },
    { useArtwork: false },
    { useBasicInfo: false },
    { useDetails: false },
    { useReleaseDates: true },
    { useEpisodes: false }
  ]) {
    assert.notEqual(
      continueWatchingEnrichmentSignatureFor({ ...ON, ...patch }, true),
      base,
      `${Object.keys(patch)[0]} must invalidate cached entries`
    );
  }
});

test("settings Continue Watching never consults leave the signature alone", () => {
  const base = continueWatchingEnrichmentSignatureFor(ON, true);
  for (const patch of [
    { useCredits: false },
    { useProductions: false },
    { useNetworks: false },
    { useTrailers: false },
    { useMoreLikeThis: false },
    { useCollections: false },
    { modernHomeEnabled: true }
  ]) {
    assert.equal(
      continueWatchingEnrichmentSignatureFor({ ...ON, ...patch }, true),
      base,
      `${Object.keys(patch)[0]} must not force every item to be re-enriched`
    );
  }
});

test("an entry cached before this existed has no signature and counts as stale", () => {
  const cachedEntryWithoutSignature = {};
  assert.notEqual(
    cachedEntryWithoutSignature.enrichmentSignature,
    continueWatchingEnrichmentSignatureFor(ON, true)
  );
});
