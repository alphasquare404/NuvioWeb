export function playerLocalPoint(event, orientation) {
  const x = Number(event?.clientX || 0),
    y = Number(event?.clientY || 0);
  if (!orientation?.rotated) return { x, y };
  return orientation.rotation === -90
    ? { x: orientation.width - y, y: x }
    : { x: y, y: orientation.height - x };
}
export function playerLocalRect(node, orientation) {
  const r = node?.getBoundingClientRect?.();
  if (!r || !orientation?.rotated) return r;
  if (orientation.rotation === -90) {
    return {
      left: orientation.width - r.bottom,
      top: r.left,
      right: orientation.width - r.top,
      bottom: r.right,
      width: r.height,
      height: r.width,
      x: orientation.width - r.bottom,
      y: r.left
    };
  }
  return {
    left: r.top,
    top: orientation.height - r.right,
    right: r.bottom,
    bottom: orientation.height - r.left,
    width: r.height,
    height: r.width,
    x: r.top,
    y: orientation.height - r.right
  };
}
export function bindRotatedPlayerScroll(body, state) {
  let active = null,
    suppressClickUntil = 0,
    scrolledNode = null;
  const down = (event) => {
    if (
      !state.rotated ||
      !["touch", "pen"].includes(event.pointerType) ||
      event.isPrimary === false
    ) {
      active = null;
      return;
    }
    let node = event.target?.closest?.(
      ".player-subtitle-rail, .player-audio-track-list, .player-audio-controls-list, .player-dialog-list, .player-sources-list, .player-episode-list, .player-episode-stream-list, .desktop-external-player-actions, .player-subtitle-overlay-grid, .player-audio-overlay-grid, .player-more-body, .player-playback-info, .nv-panel-body"
    );
    const scrollSelector =
      ".player-subtitle-overlay-grid, .player-audio-overlay-grid, .player-more-body, .player-playback-info, .nv-panel-body";
    while (node && node.scrollHeight <= node.clientHeight)
      node = node.parentElement?.closest?.(scrollSelector);
    if (!node) return;
    active = {
      node,
      id: event.pointerId,
      y: playerLocalPoint(event, state).y,
      x: playerLocalPoint(event, state).x,
      top: node.scrollTop,
      moved: false
    };
  };
  const move = (event) => {
    if (!active || event.pointerId !== active.id) return;
    const point = playerLocalPoint(event, state);
    const dy = point.y - active.y;
    if (!active.moved && Math.hypot(point.x - active.x, dy) < 6) return;
    active.moved = true;
    active.node.scrollTop = Math.max(
      0,
      Math.min(active.node.scrollHeight - active.node.clientHeight, active.top - dy)
    );
    event.preventDefault();
    try {
      active.node.setPointerCapture?.(event.pointerId);
    } catch {}
  };
  const end = (event) => {
    if (!active || event.pointerId !== active.id) return;
    if (active.moved) {
      suppressClickUntil = Date.now() + 400;
      scrolledNode = active.node;
    }
    try {
      active.node.releasePointerCapture?.(event.pointerId);
    } catch {}
    active = null;
  };
  const click = (event) => {
    if (Date.now() >= suppressClickUntil) return;
    suppressClickUntil = 0;
    if (event.target !== scrolledNode && !scrolledNode?.contains?.(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const listeners = [
    ["pointerdown", down],
    ["pointermove", move],
    ["pointerup", end],
    ["pointercancel", end],
    ["click", click]
  ];
  for (const [name, handler] of listeners)
    body.addEventListener?.(name, handler, { capture: true, passive: false });
  return () => {
    for (const [name, handler] of listeners) body.removeEventListener?.(name, handler, true);
    active = null;
  };
}

export function createPlayerOrientation(
  container,
  { scope = globalThis, preference = "landscape", onChange = () => {}, manageBody = true } = {}
) {
  const pointer = scope.matchMedia?.("(pointer: coarse)");
  const mobile = pointer
    ? Boolean(pointer.matches)
    : Number(scope.navigator?.maxTouchPoints || 0) > 0;
  let destroyed = false;
  const physicalOrientation = () => {
    const type = scope.screen?.orientation?.type;
    const legacyAngle = scope.orientation;
    const angle = Number(scope.screen?.orientation?.angle ?? legacyAngle ?? 0);
    const mode = type?.startsWith("landscape")
      ? "landscape"
      : type?.startsWith("portrait")
        ? "portrait"
        : typeof legacyAngle === "number"
          ? Math.abs(legacyAngle) === 90
            ? "landscape"
            : "portrait"
          : scope.innerWidth >= scope.innerHeight
            ? "landscape"
            : "portrait";
    return {
      key: type ? type + ":" + angle : typeof legacyAngle === "number" ? String(legacyAngle) : mode,
      mode,
      angle: ((angle % 360) + 360) % 360
    };
  };
  let physical = physicalOrientation();
  const state = { rotated: false, rotation: 0, width: 0, height: 0, preference, mobile };
  const clearScroll =
    mobile && manageBody ? bindRotatedPlayerScroll(scope.document.body, state) : () => {};
  const sync = () => {
    if (destroyed || !mobile) return;
    const w = scope.innerWidth,
      h = scope.innerHeight;
    const viewportMode = w >= h ? "landscape" : "portrait";
    const nextPhysical = physicalOrientation();
    // iOS can publish orientation before the viewport has rotated. Wait for
    // matching bounds so the old viewport is not briefly rotated a second time.
    if (nextPhysical.key !== physical.key && nextPhysical.mode === viewportMode) {
      physical = nextPhysical;
      state.preference = physical.mode;
    }
    state.rotated = state.preference !== viewportMode;
    state.rotation = !state.rotated
      ? 0
      : state.preference === "portrait" && physical.angle !== 270
        ? -90
        : 90;
    state.width = state.rotated ? h : w;
    state.height = state.rotated ? w : h;
    container.classList.toggle("browser-player-rotated", state.rotated);
    container.dataset.playerOrientation = state.preference;
    container.dataset.playerToolbarSize =
      state.width <= 360 ? "small" : state.width <= 600 ? "compact" : "regular";
    const body = scope.document.body;
    if (manageBody) body.classList.toggle("browser-player-stage-rotated", state.rotated);
    const values = {
      "--player-canvas-width": state.width + "px",
      "--player-canvas-height": state.height + "px",
      "--player-canvas-left": (state.rotation === 90 ? w : 0) + "px",
      "--player-canvas-top": (state.rotation === -90 ? h : 0) + "px",
      "--player-canvas-rotation": state.rotation + "deg"
    };
    for (const [key, value] of Object.entries(values)) {
      container.style.setProperty(key, value);
      if (manageBody) body.style.setProperty(key, value);
    }
    const style = scope.getComputedStyle(body);
    const sides = ["top", "right", "bottom", "left"];
    for (let i = 0; i < 4; i++) {
      if (state.rotated)
        container.style.setProperty(
          "--browser-safe-area-" + sides[i],
          style.getPropertyValue(
            "--browser-safe-area-" + sides[(i + (state.rotation === -90 ? 3 : 1)) % 4]
          ) || "0px"
        );
      else container.style.removeProperty("--browser-safe-area-" + sides[i]);
    }
    onChange(state);
  };
  state.setPreference = (value) => {
    if (!["portrait", "landscape"].includes(value) || value === state.preference) return;
    state.preference = value;
    sync();
  };
  state.toggle = () => {
    state.preference = state.preference === "landscape" ? "portrait" : "landscape";
    sync();
  };
  state.destroy = () => {
    clearScroll();
    destroyed = true;
    scope.removeEventListener?.("resize", sync);
    scope.removeEventListener?.("orientationchange", sync);
    scope.screen?.orientation?.removeEventListener?.("change", sync);
    scope.visualViewport?.removeEventListener("resize", sync);
    container.classList.remove("browser-player-rotated");
    delete container.dataset.playerOrientation;
    delete container.dataset.playerToolbarSize;
    if (manageBody) scope.document.body.classList.remove("browser-player-stage-rotated");
    for (const side of ["top", "right", "bottom", "left"])
      container.style.removeProperty("--browser-safe-area-" + side);
    for (const key of [
      "--player-canvas-width",
      "--player-canvas-height",
      "--player-canvas-left",
      "--player-canvas-top",
      "--player-canvas-rotation"
    ]) {
      container.style.removeProperty(key);
      if (manageBody) scope.document.body.style.removeProperty(key);
    }
  };
  if (mobile) {
    scope.addEventListener("resize", sync);
    scope.addEventListener("orientationchange", sync);
    scope.screen?.orientation?.addEventListener?.("change", sync);
    scope.visualViewport?.addEventListener("resize", sync);
    sync();
  }
  return state;
}
