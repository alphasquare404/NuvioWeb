import {
  ALL_FORMATS,
  AudioBufferSink,
  BlobSource,
  CustomSource,
  Input,
  VideoSampleSink
} from "mediabunny";
import { createRangeFetcher, readRange } from "./range.mjs";
import { createSourceReader, LIBRARY_CACHE_BYTES } from "./sourceReader.mjs";
import { ensureAudioDecoder, ensureVideoDecoder } from "./decoderSupport.mjs";

const AUDIO_AHEAD = 0.5;
const START_LEAD = 0.1;
const BUFFER_TIMEOUT_MS = 15000;

export async function openDecodeSource({ url, headers, signal }) {
  let source;
  if (url.startsWith("blob:")) {
    source = new BlobSource(await (await fetch(url, { signal })).blob());
  } else {
    const stats = {};
    const fetcher = createRangeFetcher(url, headers);
    await readRange(url, 0, 1, signal, stats, fetcher);
    source = new CustomSource({
      getSize: () => stats.size,
      read: createSourceReader({ url, signal, stats, fetcher }),
      maxCacheSize: LIBRARY_CACHE_BYTES,
      prefetchProfile: "none"
    });
  }
  return new Input({ source, formats: ALL_FORMATS });
}

export async function createDecodePlayback({
  input,
  canvas,
  chooseAudio,
  onState,
  onFrame = () => {},
  onError
}) {
  const video = await input.getPrimaryVideoTrack();
  if (!video || !(await ensureVideoDecoder(video))) throw Error("Video decoder unavailable");
  if (await video.isLive()) throw Error("Live streams require the browser player");
  const tracks = await input.getAudioTracks();
  if (tracks.length > 32) throw Error("Too many audio tracks");
  const [first, duration, format, audioTracks] = await Promise.all([
    input.getFirstTimestamp([video]),
    input.getDurationFromMetadata([video]),
    input.getFormat(),
    Promise.all(
      tracks.map(async (track, index) => ({
        index,
        language: await track.getLanguageCode(),
        name: await track.getName(),
        default: (await track.getDisposition()).default
      }))
    )
  ]);
  const length = (duration ?? (await video.computeDuration())) - first;
  if (!Number.isFinite(length) || length <= 0) throw Error("Video duration unavailable");
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw Error("Canvas unavailable");
  const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
  const audioContext = new AudioContext();
  const gain = audioContext.createGain();
  gain.connect(audioContext.destination);
  let rate = 1;
  let volume = 1;
  let boost = 1;

  let audioIndex = chooseAudio(audioTracks);
  let position = 0;
  let requestedPlaying = false;
  let ended = false;
  let run = null;
  let disposed = false;
  let lastReport = -Infinity;
  let stalls = 0;
  const snapshot = () => ({
    time:
      run?.anchor != null
        ? Math.min(length, run.start + Math.max(0, (audioContext.currentTime - run.anchor) * rate))
        : position,
    duration: length,
    ended,
    playing: requestedPlaying,
    buffering: Boolean(requestedPlaying && run?.anchor == null),
    audioIndex
  });

  const report = () => onState(snapshot());
  const closeIterator = (iterator) => {
    void iterator?.return().catch(() => {});
  };
  function stopRun() {
    const old = run;
    run = null;
    if (!old) return;
    clearTimeout(old.timeout);
    cancelAnimationFrame(old.frame);
    for (const node of old.nodes) {
      node.onended = null;
      node.stop();
      node.disconnect();
    }
    old.picture?.close();
    closeIterator(old.video);
    closeIterator(old.audio);
  }

  function fail(job, error) {
    if (disposed || run !== job) return;
    position = snapshot().time;
    requestedPlaying = false;
    stopRun();
    report();
    onError(error);
  }

  function schedule(job, chunk) {
    const offset = Math.max(0, job.start + first - chunk.timestamp);
    const when = job.anchor + (chunk.timestamp - job.start - first + offset) / rate;
    const late = Math.max(0, audioContext.currentTime - when);
    if (offset + late * rate >= chunk.buffer.duration) return;
    const node = audioContext.createBufferSource();
    node.buffer = chunk.buffer;
    node.playbackRate.value = rate;
    node.connect(gain);
    job.nodes.add(node);
    node.onended = () => {
      job.nodes.delete(node);
      node.disconnect();
    };
    node.start(Math.max(when, audioContext.currentTime), offset + late * rate);
  }

  function draw(sample) {
    const width = sample.displayWidth;
    const height = sample.displayHeight;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    sample.draw(context, 0, 0, width, height);
    onFrame();
  }

  function readPicture(job) {
    job.videoPending = true;
    void job.video
      .next()
      .then(({ value, done }) => {
        if (run !== job) {
          value?.close();
          return;
        }
        job.videoPending = false;
        job.videoDone = done;
        job.picture = value;
      })
      .catch((error) => fail(job, error));
  }

  function readSound(job) {
    job.audioPending = true;
    void job.audio
      .next()
      .then(({ value, done }) => {
        if (run !== job) return;
        job.audioPending = false;
        job.audioDone = done;
        job.sound = value;
        pumpSound(job, snapshot().time);
      })
      .catch((error) => fail(job, error));
  }

  function pumpSound(job, time) {
    if (job.anchor === null) return;
    if (job.sound && job.sound.timestamp <= time + first + AUDIO_AHEAD) {
      const chunk = job.sound;
      schedule(job, chunk);
      job.sound = null;
      job.audioUntil = chunk.timestamp + chunk.duration;
    }
    if (job.audio && !job.sound && !job.audioPending && !job.audioDone) readSound(job);
  }

  function tick(job, now) {
    if (run !== job) return;
    if (job.anchor === null && (job.picture || job.videoDone) && (job.sound || job.audioDone)) {
      clearTimeout(job.timeout);
      job.anchor = audioContext.currentTime + START_LEAD;
      report();
    }
    if (job.anchor !== null) {
      const time = snapshot().time;
      if (job.picture && job.picture.timestamp <= time + first + 0.01) {
        const sample = job.picture;
        job.picture = null;
        try {
          draw(sample);
        } finally {
          sample.close();
        }
        if (run !== job) return;
      }
      pumpSound(job, time);
      if (time >= length) {
        ended = true;
        position = length;
        requestedPlaying = false;
        stopRun();
        report();
        return;
      }
      const audioStarved = job.audioPending && job.audioUntil < time + first - 0.12;
      const videoStarved = job.videoPending && job.lastPictureTime < time - 0.65;
      if (audioStarved || videoStarved) {
        if (++stalls > 3) fail(job, Error("Decode & Play cannot keep up with this stream"));
        else restart(time);
        return;
      }
    }
    if (!job.picture && !job.videoPending && !job.videoDone) {
      job.lastPictureTime = snapshot().time;
      readPicture(job);
    }
    if (job.audio && !job.sound && !job.audioPending && !job.audioDone) readSound(job);
    if (now - lastReport >= 150) {
      lastReport = now;
      report();
    }
    job.frame = requestAnimationFrame((stamp) => {
      try {
        tick(job, stamp);
      } catch (error) {
        fail(job, error);
      }
    });
  }

  function restart(time) {
    stopRun();
    ended = false;
    position = Math.max(0, Math.min(time, length));
    if (disposed) return;
    const job = { start: position, anchor: null, nodes: new Set(), audioDone: false };
    run = job;
    report();
    if (run !== job) return;
    if (position >= length) {
      requestedPlaying = false;
      report();
      return;
    }
    job.timeout = setTimeout(() => fail(job, Error("Decode & Play timed out")), BUFFER_TIMEOUT_MS);
    void (async () => {
      const start = first + job.start;
      const sink = new VideoSampleSink(video);
      if (!requestedPlaying) {
        const sample = await sink.getSample(start);
        try {
          if (sample && run === job) draw(sample);
        } finally {
          sample?.close();
        }
        clearTimeout(job.timeout);
        return;
      }
      const selected = tracks[audioIndex];
      if (selected && !(await ensureAudioDecoder(selected)))
        throw Error("Audio decoder unavailable");
      if (run !== job) return;
      job.video = sink.samples(start);
      job.audio = selected ? new AudioBufferSink(selected).buffers(start) : null;
      job.audioDone = !selected;
      tick(job, performance.now());
    })().catch((error) => fail(job, error));
  }

  return {
    audioTracks,
    format: format.name,
    sourceStart: first,
    snapshot,
    seek(time) {
      stalls = 0;
      if (Number.isFinite(time)) restart(time);
    },
    selectAudio(index) {
      if (!tracks[index] || index === audioIndex) return;
      stalls = 0;
      audioIndex = index;
      restart(snapshot().time);
    },
    async play() {
      const resumed = audioContext.resume();
      if (
        audioContext.state !== "running" &&
        globalThis.navigator?.userActivation?.isActive === false
      ) {
        void resumed.catch(() => {});
        throw new DOMException("Tap Play to enable audio", "NotAllowedError");
      }
      await resumed;
      if (disposed || requestedPlaying) return;
      if (audioContext.state !== "running")
        throw new DOMException("Tap Play to enable audio", "NotAllowedError");
      stalls = 0;
      requestedPlaying = true;
      restart(position >= length ? 0 : position);
    },
    pause() {
      if (!requestedPlaying) return;
      position = snapshot().time;
      requestedPlaying = false;
      stopRun();
      report();
    },
    setVolume(value) {
      volume = value;
      gain.gain.value = volume * boost;
    },
    setGain(value) {
      boost = value;
      gain.gain.value = volume * boost;
    },
    setRate(value) {
      if (!Number.isFinite(value) || value <= 0 || value === rate) return;
      const time = snapshot().time;
      rate = value;
      if (run) restart(time);
    },
    destroy() {
      disposed = true;
      stopRun();
      input.dispose();
      void audioContext.close().catch(() => {});
    }
  };
}
