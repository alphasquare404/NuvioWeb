import { PLAYER_DESIGN_ICONS } from "./browserPlayerIcons.js";

export function playerText(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function playerDesignIcon(name, attributes = "") {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${attributes}>${PLAYER_DESIGN_ICONS[name] || ""}</svg>`;
}

export function playerDesignButton(action, icon, label, classes = "", content = "") {
  return `<button type="button" class="nv-icon player-control-btn ${classes}" data-action="${action}" aria-label="${playerText(label)}" title="${playerText(label)}">${playerDesignIcon(icon)}${content}</button>`;
}

export function playerPanelHead(title, closeAction, backAction = "") {
  return `<header class="nv-panel-head">${backAction ? playerDesignButton(backAction, "chevron-left", "Back") : ""}<strong>${playerText(title)}</strong>${playerDesignButton(closeAction, "x", "Close " + title, "player-panel-close")}</header>`;
}

export function playerChoice({
  label,
  secondary = "",
  selected = false,
  disabled = false,
  attributes = "",
  classes = ""
}) {
  return `<button type="button" class="nv-choice ${classes}" ${attributes} aria-pressed="${selected}" ${disabled ? "disabled" : ""}><span class="nv-check">${selected ? playerDesignIcon("check") : ""}</span><span class="nv-copy">${playerText(label)}${secondary ? `<small>${playerText(secondary)}</small>` : ""}</span></button>`;
}

export function browserPlayerChrome({ title, subtitle, clock = true }) {
  return `<div id="playerControlsOverlay" class="player-controls-overlay nv-chrome">
    <div class="nv-shade"></div>
    <header class="nv-top"><div class="nv-back-slot"></div><div class="nv-identity player-meta"><div class="nv-title player-title">${playerText(title)}</div><div class="nv-episode player-subtitle">${playerText(subtitle)}</div></div><div class="nv-next-slot"></div><div class="nv-clock player-controls-top" ${clock ? "" : "hidden"}><span id="playerClock">--:--</span><small id="playerEndsAt">--:--</small></div></header>
    <div class="nv-center"></div>
    <div class="nv-bottom player-controls-bottom"><div class="nv-portrait-summary">${playerText(subtitle)}</div><div class="nv-time-row"><span class="nv-elapsed" data-player-elapsed>0:00</span><span data-player-duration>/ 0:00</span><span class="nv-remaining" data-player-remaining>−0:00</span><span id="playerTimeLabel" hidden aria-hidden="true"></span></div>
      <div class="nv-progress"><div id="playerProgressShell" class="player-progress-shell focusable" tabindex="0" role="slider" aria-label="Seek" data-player-pointer-action="progress"><div id="playerProgressHover" class="player-progress-hover nv-seek-preview hidden" aria-hidden="true"></div><div class="player-progress-track"><div id="playerProgressBuffered" class="player-progress-buffered"></div><div id="playerProgressFill" class="player-progress-fill"></div></div></div></div>
      <div id="playerControlButtons" class="nv-tools"></div>
    </div>
  </div>`;
}

export function browserPlayerControls({
  controls,
  paused,
  offline,
  volume,
  muted,
  volumeSupported,
  fullscreen,
  fullscreenActive,
  labels
}) {
  const available = (action) => controls.some((c) => c.action === action);
  const play = playerDesignButton(
    "playPause",
    paused ? "play" : "pause",
    paused ? labels.play : labels.pause,
    "nv-main"
  );
  const rewind = playerDesignButton("seekBack10", "rotate-ccw", labels.back10);
  const forward = playerDesignButton("seekForward10", "rotate-cw", labels.forward10);
  const next = available("playNextEpisode")
    ? playerDesignButton("playNextEpisode", "skip-forward", labels.next)
    : "";
  const items = [
    ["subtitleDialog", "captions", labels.subtitle],
    ["audioTrack", "audio-lines", labels.audio],
    ["episodes", "list-video", labels.episode],
    ["source", offline ? "hard-drive" : "layers", offline ? labels.file : labels.stream],
    ["more", "ellipsis", labels.more]
  ];
  const utilities = items
    .filter(([action]) => available(action))
    .map(([action, icon, label]) =>
      playerDesignButton(action, icon, label, "nv-labeled", `<span>${playerText(label)}</span>`)
    )
    .join("");
  const audio = `<div class="nv-volume player-desktop-playback-tools" ${volumeSupported ? "" : "hidden"}><button type="button" class="nv-icon" data-player-desktop-action="mute" aria-label="${playerText(muted ? labels.unmute : labels.mute)}"><span data-player-desktop-mute-icon>${playerDesignIcon(muted ? "volume-x" : "volume-2")}</span></button><input type="range" min="0" max="100" value="${muted ? 0 : Math.round(volume * 100)}" data-player-desktop-volume aria-label="${playerText(labels.volume)}" ${volumeSupported ? "" : "hidden disabled"} /></div>`;
  const expand = fullscreen
    ? `<button type="button" class="nv-icon nv-fullscreen" data-player-desktop-action="fullscreen" aria-label="${playerText(labels.fullscreen)}"><span data-player-desktop-fullscreen-icon>${playerDesignIcon(fullscreenActive ? "minimize" : "maximize")}</span></button>`
    : "";
  return {
    toolbar: `<div class="nv-primary-row">${play}${rewind}${forward}${next}</div>${audio}<div class="nv-utilities">${utilities}${expand}</div>`,
    center:
      playerDesignButton(
        "seekBack10",
        "rotate-ccw",
        labels.back10,
        "nv-skip",
        "<small>10</small>"
      ) +
      play +
      playerDesignButton(
        "seekForward10",
        "rotate-cw",
        labels.forward10,
        "nv-skip",
        "<small>10</small>"
      ),
    next
  };
}

export function browserPlayerLayout({ touch, width, height, preference }) {
  const largeTablet = touch && Math.min(width, height) >= 600;
  return {
    desktop: !touch || largeTablet,
    portrait: touch && preference === "portrait",
    rotate: touch
  };
}
