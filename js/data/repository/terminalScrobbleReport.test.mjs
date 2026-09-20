import assert from "node:assert/strict";
import test from "node:test";

const { terminalScrobbleReportKey } = await import("./terminalScrobbleReport.js");

const episode = {
  contentId: "tt26545992",
  contentType: "series",
  seasonNumber: 1,
  episodeNumber: 3,
  progressPercent: 42.2
};

test("the same episode at the same position reports once", () => {
  // A phone switching away from an open player fires a lifecycle report every
  // time; without this each one would post the identical position again.
  assert.equal(terminalScrobbleReportKey(episode), terminalScrobbleReportKey({ ...episode }));
});

test("jitter between two reads of currentTime is not a new position", () => {
  assert.equal(
    terminalScrobbleReportKey(episode),
    terminalScrobbleReportKey({ ...episode, progressPercent: 42.2041 })
  );
});

test("real progress since the last report is a new position", () => {
  assert.notEqual(
    terminalScrobbleReportKey(episode),
    terminalScrobbleReportKey({ ...episode, progressPercent: 42.9 })
  );
});

test("the next episode at the same percentage is not the previous one", () => {
  assert.notEqual(
    terminalScrobbleReportKey(episode),
    terminalScrobbleReportKey({ ...episode, episodeNumber: 4 })
  );
  assert.notEqual(
    terminalScrobbleReportKey(episode),
    terminalScrobbleReportKey({ ...episode, seasonNumber: 2 })
  );
});

test("a film and a series sharing an id stay distinct", () => {
  assert.notEqual(
    terminalScrobbleReportKey({ contentId: "x", contentType: "movie", progressPercent: 10 }),
    terminalScrobbleReportKey({ contentId: "x", contentType: "series", progressPercent: 10 })
  );
});

test("a context with nothing to identify it yields no key, so it is never sent", () => {
  assert.equal(terminalScrobbleReportKey({ progressPercent: 50 }), "");
  assert.equal(terminalScrobbleReportKey(null), "");
  assert.equal(terminalScrobbleReportKey(undefined), "");
});

test("a missing progress is treated as zero rather than throwing", () => {
  assert.equal(
    terminalScrobbleReportKey({ contentId: "x", contentType: "movie" }),
    terminalScrobbleReportKey({ contentId: "x", contentType: "movie", progressPercent: 0 })
  );
});

const { shouldSendTerminalScrobbleReport } = await import("./terminalScrobbleReport.js");

const midEpisode = {
  contentId: "tt26545992",
  contentType: "series",
  seasonNumber: 1,
  episodeNumber: 3,
  positionMs: 30 * 60 * 1000,
  durationMs: 60 * 60 * 1000
};

test("a mid-episode position is reported", () => {
  assert.equal(shouldSendTerminalScrobbleReport(midEpisode), true);
});

test("past our own completion mark nothing is reported", () => {
  // Beyond this there is no position left to preserve, only a completion, and
  // that has its own path.
  assert.equal(
    shouldSendTerminalScrobbleReport({ ...midEpisode, positionMs: 54 * 60 * 1000 }),
    false
  );
  assert.equal(
    shouldSendTerminalScrobbleReport({ ...midEpisode, positionMs: 60 * 60 * 1000 }),
    false
  );
});

test("the band a stop cannot carry is reported as a pause instead", async () => {
  // The reported failure: stopping at 85% reached the provider as nothing at
  // all -- too far along for a stop, which would have finished the title, and
  // not far enough to count as finished.
  const { terminalScrobbleAction } = await import("./terminalScrobbleReport.js");
  const at = (percent) => ({ ...midEpisode, positionMs: percent * 60 * 60 * 1000 });
  assert.equal(shouldSendTerminalScrobbleReport(at(0.85)), true, "85% is reported");
  assert.equal(terminalScrobbleAction(at(0.85)), "pause");
  assert.equal(terminalScrobbleAction(at(0.8)), "pause", "exactly at the threshold");
  assert.equal(terminalScrobbleAction(at(0.79)), "stop");
  assert.equal(terminalScrobbleAction(at(0.3)), "stop");
});

test("a few seconds of a stream that never got going is not reported", () => {
  assert.equal(shouldSendTerminalScrobbleReport({ ...midEpisode, positionMs: 30 * 1000 }), false);
});

test("a series episode the provider cannot address is not reported", () => {
  assert.equal(shouldSendTerminalScrobbleReport({ ...midEpisode, episodeNumber: null }), false);
});

test("a film needs no episode number", () => {
  assert.equal(
    shouldSendTerminalScrobbleReport({
      contentId: "tt1130884",
      contentType: "movie",
      positionMs: 30 * 60 * 1000,
      durationMs: 100 * 60 * 1000
    }),
    true
  );
});

test("an explicit progress percentage is honoured when no duration is known", () => {
  assert.equal(
    shouldSendTerminalScrobbleReport({
      ...midEpisode,
      positionMs: 0,
      durationMs: 0,
      progressPercent: 42
    }),
    true
  );
});

test("a malformed context is never reported", () => {
  assert.equal(shouldSendTerminalScrobbleReport(null), false);
  assert.equal(shouldSendTerminalScrobbleReport({}), false);
});
