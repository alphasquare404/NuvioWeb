// Matches the "essentially finished, start it over" cutoff the resume paths
// already used for a known position.
const RESUME_COMPLETION_FRACTION = 0.9;

/**
 * Where an external player should start.
 *
 * A tracking provider records how far in you are as a percentage, not as a
 * position: SIMKL's playback list carries no runtime at all, so its rows reach
 * Continue Watching with a progress percent and a position of zero. The
 * built-in player copes by deferring the resume until the video element reports
 * its own duration, but an external player has to be told a number up front --
 * so without this it was told zero and started from the beginning, while the
 * same title resumed correctly once it had been played here at least once and
 * had a local row with a real position.
 *
 * The duration to measure the percentage against is the one Continue Watching
 * already resolved from the title's runtime.
 */
export function resolveExternalResumeSeconds({
  positionMs = 0,
  progressPercent = null,
  durationMs = 0
} = {}) {
  const position = Number(positionMs);
  const duration = Number(durationMs);
  const hasDuration = Number.isFinite(duration) && duration > 0;
  if (
    Number.isFinite(position) &&
    position > 0 &&
    (!hasDuration || position < duration * RESUME_COMPLETION_FRACTION)
  ) {
    return position / 1000;
  }
  const percent = Number(progressPercent);
  if (
    hasDuration &&
    Number.isFinite(percent) &&
    percent > 0 &&
    percent < RESUME_COMPLETION_FRACTION * 100
  ) {
    return (percent / 100) * (duration / 1000);
  }
  return 0;
}
