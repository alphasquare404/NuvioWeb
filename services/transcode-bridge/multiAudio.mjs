import { readFile, stat } from "node:fs/promises";
import path from "node:path";
export function parseAudioIndices(raw, selected) {
  if (!raw) return null;
  if (!/^[0-7](?:,[0-7]){1,7}$/.test(raw)) throw Error("invalid-audio-renditions");
  const list = raw.split(",").map(Number);
  if (new Set(list).size !== list.length || !list.includes(selected))
    throw Error("invalid-audio-renditions");
  return list.sort((a, b) => a - b);
}

// A single input, one video output, one audio-only rendition per requested track.
// No encoder and no duplicate video for each language.
export function multiAudioHlsArgs(source, indices, { videoTag = "" } = {}) {
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", source, "-map", "0:v:0"];
  for (const index of indices) args.push("-map", `0:a:${index}`);
  args.push("-c:v", "copy", "-c:a", "copy");
  if (videoTag) args.push("-tag:v", videoTag);
  return args.concat([
    // Copy does not encode. This metadata hint makes FFmpeg publish CODECS before EOF.
    // The public master replaces the hint with a measured segment estimate below.
    "-b:v",
    "32000000",
    "-f",
    "hls",
    "-hls_time",
    "4",
    "-hls_playlist_type",
    "event",
    "-hls_segment_type",
    "fmp4",
    "-hls_fmp4_init_filename",
    "init%v.mp4",
    "-hls_flags",
    "independent_segments",
    "-var_stream_map",
    [
      "v:0,agroup:audio",
      ...indices.map((_, i) => `a:${i},agroup:audio,default:${i === 0 ? "yes" : "no"}`)
    ].join(" "),
    "-master_pl_name",
    "index.m3u8",
    "-master_pl_publish_rate",
    "1",
    "-hls_segment_filename",
    "seg%v_%05d.m4s",
    "v%v.m3u8"
  ]);
}

export function selectDefaultRendition(text, indices, selected) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (!line.startsWith("#EXT-X-MEDIA:TYPE=AUDIO,")) return line;
      const rendition = /URI="v(\d+)\.m3u8"/.exec(line);
      if (!rendition) return line;
      const index = indices[Number(rendition[1]) - 1];
      return line.replace(/DEFAULT=(YES|NO)/, "DEFAULT=" + (index === selected ? "YES" : "NO"));
    })
    .join("\n");
}

export async function publishEarlyMaster(text, job) {
  if (!job.bandwidthEstimate) {
    const rates = await Promise.all(
      Array.from({ length: job.audioIndices.length + 1 }, async (_, index) => {
        const playlist = await readFile(path.join(job.dir, "v" + index + ".m3u8"), "utf8");
        const first = /#EXTINF:([0-9.]+),[^\n]*\n([^#\r\n]+)/.exec(playlist);
        if (!first || !(Number(first[1]) > 0) || !/^seg[0-9]+_[0-9]+\.m4s$/.test(first[2]))
          throw Error("hls-segment-not-ready");
        return ((await stat(path.join(job.dir, first[2]))).size * 8) / Number(first[1]);
      })
    );
    // One video variant: an explicit initial estimate from completed segments,
    // including the largest audio rendition and 25% headroom, not a bitrate claim.
    job.bandwidthEstimate = Math.max(
      64000,
      Math.ceil((rates[0] + Math.max(...rates.slice(1))) * 1.25)
    );
  }
  return text
    .replace(/,AVERAGE-BANDWIDTH=[^,\r\n]*/g, "")
    .replace(/(#EXT-X-STREAM-INF:BANDWIDTH=)\d+/g, "$1" + job.bandwidthEstimate);
}
