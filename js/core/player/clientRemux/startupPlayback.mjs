// Startup must not flush a partially appended fragment by seeking into it.
// This gate owns only initial ordering; normal playback/seek controls stay with runtime.
export const STARTUP_AHEAD_SECONDS = 4;
// Use the contiguous intersection exposed by the media element, not a later
// disjoint range or total cached bytes. Keep a small end-of-film tolerance.
export function startupWindow(video, target) {
  const required =
    Number.isFinite(video.duration) && video.duration > 0
      ? Math.min(STARTUP_AHEAD_SECONDS, Math.max(0, video.duration - target - 0.05))
      : STARTUP_AHEAD_SECONDS;
  for (let i = 0; i < video.buffered.length; i++) {
    if (video.buffered.start(i) <= target + 0.02 && video.buffered.end(i) > target + 0.02)
      return { ahead: video.buffered.end(i) - target, required };
  }
  return { ahead: 0, required };
}
export function createStartupPlayback({
  video,
  target,
  isActive,
  wantsPlay,
  noteSeek,
  onPhase,
  onBlocked
}) {
  let prepared = false,
    settled = false,
    disposed = false;
  const play = () => {
    if (disposed || !isActive() || !prepared || !settled || !wantsPlay()) return;
    onPhase("play-requested");
    try {
      video.play()?.catch((error) => {
        if (!disposed && isActive()) onBlocked(error);
      });
    } catch (error) {
      onBlocked(error);
    }
  };
  const seeked = () => {
    if (disposed || !isActive() || !prepared || Math.abs(video.currentTime - target) > 0.05) return;
    settled = true;
    video.removeEventListener("seeked", seeked);
    onPhase("seek-settled");
    play();
  };
  video.addEventListener("seeked", seeked);
  return {
    get ready() {
      return prepared && settled;
    },
    completeBoundary(last) {
      if (!last || prepared || disposed || !isActive()) return;
      const window = startupWindow(video, target);
      if (window.ahead <= 0 || window.ahead + 0.002 < window.required) {
        onPhase("buffering-startup", window);
        return;
      }
      prepared = true;
      onPhase("target-buffered", window);
      noteSeek(target);
      if (Math.abs(video.currentTime - target) > 0.001) {
        onPhase("seeking");
        video.currentTime = target;
      }
      if (!video.seeking) seeked();
    },
    dispose() {
      disposed = true;
      video.removeEventListener("seeked", seeked);
    }
  };
}
