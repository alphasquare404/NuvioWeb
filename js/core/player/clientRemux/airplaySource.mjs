// Safari uses the first source for local MSE playback and the network source
// for AirPlay. A src attribute would override both child sources.
export function attachRemuxMediaSources(video, objectUrl, sourceUrl) {
  if (
    typeof video.webkitShowPlaybackTargetPicker !== "function" ||
    !/^https?:\/\//i.test(String(sourceUrl || ""))
  ) {
    video.disableRemotePlayback = true;
    video.src = objectUrl;
    return () => {};
  }
  const local = video.ownerDocument.createElement("source");
  local.src = objectUrl;
  local.type = "video/mp4";
  const remote = video.ownerDocument.createElement("source");
  remote.src = sourceUrl;
  remote.setAttribute("data-nuvio-airplay-source", "");
  video.removeAttribute("src");
  video.append(local, remote);
  video.disableRemotePlayback = false;
  video.setAttribute("x-webkit-airplay", "allow");
  return () => {
    local.remove();
    remote.remove();
  };
}
