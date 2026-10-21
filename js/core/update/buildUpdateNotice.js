import { APP_IDENTITY } from "../app/appIdentity.js";
import { I18n } from "../../i18n/index.js";

const LAST_BUILD_KEY = "nuvio:last-build-stamp";
const LAST_COMMIT_KEY = "nuvio:last-build-commit";
const APPLIED_KEY = "nuvio:update-applied";
const TOAST_ATTRIBUTE = "data-nuvio-update-toast";
const TOAST_LIFETIME_MS = 4200;
const TOAST_EXIT_MS = 240;

function t(key, fallback) {
  return I18n.t(key, {}, { fallback });
}

function safeStorage(storage) {
  try {
    return storage || globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function buildUpdateChanged(previousStamp, currentStamp) {
  return Boolean(previousStamp && currentStamp && previousStamp !== currentStamp);
}

export function currentBuildStamp(runtime = globalThis) {
  return String(runtime?.__NUVIO_BUILD_STAMP__ || "").trim();
}

/**
 * GitHub's compare page is the changelog: it is generated from the commits
 * between the build the viewer had and the one that just replaced it. That
 * keeps release notes out of the bundle and works for nightly builds too.
 */
export function buildChangesUrl({
  repositoryUrl = APP_IDENTITY.sourceRepositoryUrl,
  previousCommit = "",
  currentCommit = ""
} = {}) {
  const base = String(repositoryUrl || "")
    .trim()
    .replace(/\/+$/, "");
  if (!base) return "";
  const previous = String(previousCommit || "").trim();
  const current = String(currentCommit || "").trim();
  if (previous && current && previous !== current) {
    return `${base}/compare/${encodeURIComponent(previous)}...${encodeURIComponent(current)}`;
  }
  if (current) {
    return `${base}/commit/${encodeURIComponent(current)}`;
  }
  return `${base}/commits`;
}

/** Mark the reload that the service worker is about to perform. */
export function markBuildUpdateApplied(session = globalThis.sessionStorage) {
  try {
    safeStorage(session)?.setItem(APPLIED_KEY, "1");
  } catch {
    // The build stamp comparison still announces an update when possible.
  }
}

function appendWhenReady(documentRef, buildNode) {
  if (!documentRef?.body) return;
  if (documentRef.readyState === "loading") {
    documentRef.addEventListener("DOMContentLoaded", buildNode, { once: true });
    return;
  }
  buildNode();
}

function dismissNode(node) {
  node?.remove?.();
}

function hideNode(node) {
  if (!node?.classList) {
    dismissNode(node);
    return;
  }
  node.classList.add("is-leaving");
  const remove = () => dismissNode(node);
  node.addEventListener?.("animationend", remove, { once: true });
  globalThis.setTimeout?.(remove, TOAST_EXIT_MS);
}

function text(documentRef, className, value) {
  const node = documentRef.createElement("span");
  node.className = className;
  node.textContent = value;
  return node;
}

/**
 * The update itself is automatic. This only says which build the viewer is
 * now running and offers the exact commit range that produced it.
 */
export function announceBuildUpdate({
  documentRef = globalThis.document,
  storage = globalThis.localStorage,
  session = globalThis.sessionStorage,
  stamp = currentBuildStamp(),
  currentCommit = APP_IDENTITY.commit,
  repositoryUrl = APP_IDENTITY.sourceRepositoryUrl
} = {}) {
  const currentStamp = String(stamp || "").trim();
  if (!currentStamp) return false;

  const store = safeStorage(storage);
  const sessionStore = safeStorage(session);
  let previousStamp = "";
  let previousCommit = "";
  let appliedFromReload = false;
  try {
    previousStamp = String(store?.getItem(LAST_BUILD_KEY) || "").trim();
    previousCommit = String(store?.getItem(LAST_COMMIT_KEY) || "").trim();
    appliedFromReload = sessionStore?.getItem(APPLIED_KEY) === "1";
    sessionStore?.removeItem(APPLIED_KEY);
  } catch {
    previousStamp = "";
    previousCommit = "";
    appliedFromReload = false;
  }

  try {
    store?.setItem(LAST_BUILD_KEY, currentStamp);
    if (currentCommit) store?.setItem(LAST_COMMIT_KEY, currentCommit);
  } catch {
    // A private or full storage area should not stop the app from loading.
  }

  if (!appliedFromReload && !buildUpdateChanged(previousStamp, currentStamp)) {
    return false;
  }

  const changesUrl = buildChangesUrl({
    repositoryUrl,
    previousCommit,
    currentCommit
  });

  appendWhenReady(documentRef, () => {
    if (!documentRef.body) return;
    documentRef.querySelector?.(`[${TOAST_ATTRIBUTE}]`)?.remove?.();
    const toast = documentRef.createElement("section");
    toast.setAttribute(TOAST_ATTRIBUTE, "");
    toast.className = "browser-update-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.append(
      text(
        documentRef,
        "browser-update-title",
        t("update_browser_updated_title", "NuvioWeb updated")
      )
    );

    if (changesUrl) {
      const link = documentRef.createElement("a");
      link.className = "browser-update-link";
      link.href = changesUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = t("update_browser_see_changes", "See changes");
      toast.append(link);
    }

    documentRef.body.appendChild(toast);
    globalThis.setTimeout?.(() => hideNode(toast), TOAST_LIFETIME_MS);
  });
  return true;
}
