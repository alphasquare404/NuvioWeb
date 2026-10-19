// Which layout a device gets is a question with two halves, and they are not the
// same half.
//
// The shell is built around a width: below a line it is a phone layout, above it
// the wide one. That stays true and is the default -- this module does not take
// the decision away from the viewport.
//
// What the viewport cannot answer is what kind of device it is looking at, and the
// navigation does care: a tablet held upright can carry a rail or a top bar just
// as well as a desktop, while the same width on a phone is still a phone. So the
// device class is inferred once and published, and the layout resolves as:
//
//   - a tablet with the navigation at the bottom or the rail   -> mobile
//   - the viewport is wide enough for the wide layout           -> desktop
//   - the device is a desktop, and the window is wide enough   -> desktop
//   - a phone or tablet, with the navigation at the top, and
//     the viewport wide enough to survive the wide layout      -> desktop
//   - everything else                                          -> mobile
//
// `navPlacement` is the placement actually in force ("top" | "bottom" |
// "sidebar"), not the stored preference, so the rule follows what is on screen.

const MIN_DESKTOP_WIDTH = 700;
const WIDE_VIEWPORT = 1024;

export const DEVICE_CLASSES = Object.freeze(["phone", "tablet", "desktop"]);
export const LAYOUTS = Object.freeze(["mobile", "desktop"]);

/**
 * Best-effort device class from what a browser is willing to say.
 *
 * iPadOS reports a Macintosh user agent, so touch points are what separates an
 * iPad from a Mac. Android tablets usually omit "Mobile"; that is the only hint
 * the platform gives, and it is used as one rather than as proof.
 */
export function resolveDeviceClass(navigatorLike = globalThis?.navigator) {
  if (!navigatorLike) {
    return "desktop";
  }
  const userAgent = String(navigatorLike.userAgent || "");
  const platform = String(navigatorLike.userAgentData?.platform || navigatorLike.platform || "");
  const touchPoints = Number(navigatorLike.maxTouchPoints || 0);

  if (/ipad/i.test(userAgent) || (platform === "MacIntel" && touchPoints > 1)) {
    return "tablet";
  }
  if (/iphone|ipod/i.test(userAgent)) {
    return "phone";
  }
  if (/android/i.test(userAgent)) {
    return /mobile/i.test(userAgent) ? "phone" : "tablet";
  }
  if (navigatorLike.userAgentData?.mobile === true) {
    return "phone";
  }
  return "desktop";
}

/**
 * The layout the shell should use right now.
 *
 * `navPlacement` is optional: when the caller does not know it yet, the width and
 * the device class alone decide, which is the old behaviour.
 */
export function resolveLayout({
  width = Number(globalThis?.innerWidth || 0),
  deviceClass = "desktop",
  navPlacement = ""
} = {}) {
  const viewportWidth = Number(width) || 0;
  // A tablet with the bar at the bottom or the rail has chosen the touch shell,
  // and that answer does not expire at the wide breakpoint. Top still follows
  // the width, because the top bar is the placement the wide shell is built for.
  if (deviceClass === "tablet" && (navPlacement === "bottom" || navPlacement === "sidebar")) {
    return "mobile";
  }
  if (viewportWidth >= WIDE_VIEWPORT) {
    return "desktop";
  }
  if (deviceClass === "desktop") {
    return viewportWidth >= MIN_DESKTOP_WIDTH ? "desktop" : "mobile";
  }
  // A phone or tablet: only the wide layout's floor matters, and only when the
  // navigation has been moved to the top. The tablet's rail and bottom bar have
  // already returned above.
  if (navPlacement === "top") {
    return "desktop";
  }
  return "mobile";
}

let lastApplied = null;

function currentNavPlacement() {
  const root = globalThis?.document?.documentElement;
  return String(root?.dataset?.navPlacement || "");
}

/**
 * Publish the device class and the resolved layout on the root element.
 *
 * Written once at boot and again whenever the viewport changes, because a tablet
 * rotation or a resized window moves the width without changing the device.
 */
export function applyDeviceLayout(options = {}) {
  const root = globalThis?.document?.documentElement;
  if (!root) {
    return null;
  }
  const deviceClass = options.deviceClass || resolveDeviceClass();
  const width = Number(options.width ?? globalThis.innerWidth ?? 0);
  const navPlacement = options.navPlacement ?? currentNavPlacement();
  const layout = resolveLayout({ width, deviceClass, navPlacement });

  root.dataset.device = deviceClass;
  root.dataset.layout = layout;
  lastApplied = { deviceClass, width, navPlacement, layout };
  return lastApplied;
}

/** Re-derive the layout; used on resize and after a navigation change. */
export function refreshDeviceLayout() {
  return applyDeviceLayout();
}

export function getAppliedLayoutState() {
  return lastApplied;
}

export function installDeviceLayoutWatcher() {
  if (typeof globalThis.addEventListener !== "function") {
    return () => {};
  }
  let frame = 0;
  const schedule = () => {
    if (frame) {
      return;
    }
    const request = globalThis.requestAnimationFrame?.(() => {
      frame = 0;
      applyDeviceLayout();
    });
    if (request) {
      frame = request;
    } else {
      applyDeviceLayout();
    }
  };
  globalThis.addEventListener("resize", schedule, { passive: true });
  globalThis.addEventListener("orientationchange", schedule, { passive: true });

  // The placement is written by the layout preferences, which apply after boot.
  // Until it exists the layout cannot know whether the navigation is at the top,
  // so the resolution is redone when that attribute changes.
  let observer = null;
  const root = globalThis?.document?.documentElement;
  if (root && typeof globalThis.MutationObserver === "function") {
    observer = new globalThis.MutationObserver(schedule);
    observer.observe(root, { attributes: true, attributeFilter: ["data-nav-placement"] });
  }

  return () => {
    globalThis.removeEventListener("resize", schedule);
    globalThis.removeEventListener("orientationchange", schedule);
    observer?.disconnect();
  };
}
