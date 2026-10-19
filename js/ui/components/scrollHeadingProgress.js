// A sticky heading follows the scroll continuously over this distance. Zero is
// the expanded page title; one is the compact bar. There is no threshold and no
// direction check: scrolling back up unwinds the same progress.
export const HEADING_PROGRESS_RANGE = 96;

export function resolveHeadingProgress(scrollTop, range = HEADING_PROGRESS_RANGE) {
  const position = Number(scrollTop);
  const distance = Number(range);
  if (!Number.isFinite(position) || position <= 0 || !Number.isFinite(distance) || distance <= 0) {
    return 0;
  }
  return Math.min(1, position / distance);
}
