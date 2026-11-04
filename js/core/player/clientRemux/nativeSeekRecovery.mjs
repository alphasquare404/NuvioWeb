export function isTimeBuffered(video, time) {
  for (let i = 0; i < video.buffered.length; i++)
    if (time >= video.buffered.start(i) - 0.02 && time < video.buffered.end(i) - 0.02) return true;
  return false;
}

export function createNativeSeekRecovery({
  video,
  isActive,
  recover,
  autoplay = true,
  delayMs = 350,
  schedule = setTimeout,
  cancel = clearTimeout
}) {
  let seekTimer = null,
    pauseTimer = null,
    internalTarget = null,
    wantsPlay = autoplay,
    disposed = false;
  const clearSeek = () => {
    if (seekTimer !== null) cancel(seekTimer);
    seekTimer = null;
  };
  const clearPause = () => {
    if (pauseTimer !== null) cancel(pauseTimer);
    pauseTimer = null;
  };
  const onPlay = () => {
    if (!isActive()) return;
    clearPause();
    wantsPlay = true;
  };
  const onPause = () => {
    if (!isActive()) return;
    clearPause();
    // Native scrub controls may pause immediately before their seeking events.
    // A settled explicit pause is retained, while that transient pause is ignored.
    pauseTimer = schedule(() => {
      pauseTimer = null;
      if (!disposed && !seekTimer && !video.seeking) wantsPlay = false;
    }, delayMs);
  };
  const onSeeking = () => {
    if (disposed || !isActive()) return;
    const target = video.currentTime;
    if (internalTarget !== null && Math.abs(target - internalTarget) < 0.05) return;
    internalTarget = null;
    clearPause();
    clearSeek();
    if (!Number.isFinite(target) || target < 0 || isTimeBuffered(video, target)) return;
    if (!video.paused) wantsPlay = true;
    const shouldPlay = wantsPlay,
      rate = video.playbackRate;
    seekTimer = schedule(() => {
      seekTimer = null;
      if (disposed || !isActive() || isTimeBuffered(video, video.currentTime)) return;
      // Re-read the final target after coalescing the stream of slider events.
      const end = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.05) : Infinity;
      recover({ time: Math.min(end, Math.max(0, video.currentTime)), autoplay: shouldPlay, rate });
    }, delayMs);
  };
  const onSeeked = () => {
    internalTarget = null;
  };
  for (const [type, fn] of [
    ["play", onPlay],
    ["pause", onPause],
    ["seeking", onSeeking],
    ["seeked", onSeeked]
  ])
    video.addEventListener(type, fn);
  return {
    get pending() {
      return seekTimer !== null;
    },
    noteInternalSeek(time) {
      internalTarget = time;
      clearSeek();
    },
    dispose() {
      disposed = true;
      clearSeek();
      clearPause();
      for (const [type, fn] of [
        ["play", onPlay],
        ["pause", onPause],
        ["seeking", onSeeking],
        ["seeked", onSeeked]
      ])
        video.removeEventListener(type, fn);
    }
  };
}
