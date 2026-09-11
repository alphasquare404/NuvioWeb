export const BROWSER_PICTURE_IN_PICTURE_STANDARD = "standard";
export const BROWSER_PICTURE_IN_PICTURE_WEBKIT = "webkit";

export function getBrowserPictureInPictureCapability(video, documentRef = globalThis.document) {
  if (!video) return null;

  if (
    documentRef?.pictureInPictureEnabled !== false &&
    typeof video.requestPictureInPicture === "function" &&
    typeof documentRef?.exitPictureInPicture === "function"
  ) {
    return BROWSER_PICTURE_IN_PICTURE_STANDARD;
  }

  if (typeof video.webkitSetPresentationMode !== "function") {
    return null;
  }

  try {
    return typeof video.webkitSupportsPresentationMode !== "function" ||
      video.webkitSupportsPresentationMode("picture-in-picture")
      ? BROWSER_PICTURE_IN_PICTURE_WEBKIT
      : null;
  } catch (_) {
    return null;
  }
}

export function isBrowserPictureInPictureActive(video, documentRef = globalThis.document) {
  const capability = getBrowserPictureInPictureCapability(video, documentRef);
  if (capability === BROWSER_PICTURE_IN_PICTURE_STANDARD) {
    return documentRef?.pictureInPictureElement === video;
  }
  return capability === BROWSER_PICTURE_IN_PICTURE_WEBKIT && video.webkitPresentationMode === "picture-in-picture";
}

export async function enterBrowserPictureInPicture(video, documentRef = globalThis.document) {
  const capability = getBrowserPictureInPictureCapability(video, documentRef);
  if (capability === BROWSER_PICTURE_IN_PICTURE_STANDARD) {
    await video.requestPictureInPicture();
    return true;
  }
  if (capability === BROWSER_PICTURE_IN_PICTURE_WEBKIT) {
    video.webkitSetPresentationMode("picture-in-picture");
    return true;
  }
  return false;
}

export async function exitBrowserPictureInPicture(video, documentRef = globalThis.document) {
  if (!isBrowserPictureInPictureActive(video, documentRef)) return false;
  if (getBrowserPictureInPictureCapability(video, documentRef) === BROWSER_PICTURE_IN_PICTURE_STANDARD) {
    await documentRef.exitPictureInPicture();
  } else {
    video.webkitSetPresentationMode("inline");
  }
  return true;
}

export function shouldMarkBrowserPictureInPictureUnavailable(error) {
  return error?.name === "NotSupportedError";
}

export function isBrowserPictureInPictureUnavailableForSession({
  video,
  session,
  unavailableVideo,
  unavailableSession
} = {}) {
  return Boolean(video) && video === unavailableVideo && session === unavailableSession;
}
