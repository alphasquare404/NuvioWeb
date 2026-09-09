import { Router } from "./router.js";
import { Platform } from "../../platform/index.js";

function buildNormalizedEvent(event) {
  const normalizedKey = Platform.normalizeKey(event);
  const normalizedCode = Number(normalizedKey.keyCode || 0);

  return {
    key: normalizedKey.key,
    code: normalizedKey.code,
    keyName: normalizedKey.keyName,
    target: event?.target || null,
    altKey: Boolean(event?.altKey),
    ctrlKey: Boolean(event?.ctrlKey),
    shiftKey: Boolean(event?.shiftKey),
    metaKey: Boolean(event?.metaKey),
    repeat: Boolean(event?.repeat),
    defaultPrevented: Boolean(event?.defaultPrevented),
    keyCode: normalizedCode,
    which: normalizedCode,
    originalKeyCode: Number(normalizedKey.originalKeyCode || event?.keyCode || 0),
    keyDownDurationMs: 0,
    preventDefault: () => {
      if (typeof event?.preventDefault === "function") {
        event.preventDefault();
      }
    },
    stopPropagation: () => {
      if (typeof event?.stopPropagation === "function") {
        event.stopPropagation();
      }
    },
    stopImmediatePropagation: () => {
      if (typeof event?.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
    }
  };
}

function hasActiveModal() {
  return Boolean(globalThis?.document?.body?.classList?.contains("nuvio-modal-open"));
}

const BACK_DEBOUNCE_MS = 250;

export const FocusEngine = {
  lastBackHandledAt: 0,
  activeKeyDownStartedAt: new Map(),

  init() {
    this.boundHandleKey = this.handleKey.bind(this);
    this.boundHandleKeyUp = this.handleKeyUp.bind(this);
    document.addEventListener("keydown", this.boundHandleKey, true);
    document.addEventListener("keyup", this.boundHandleKeyUp, true);
  },

  handleBack(event, normalizedEvent = buildNormalizedEvent(event)) {
    const now = Date.now();
    const elapsedSinceHandled = now - Number(this.lastBackHandledAt || 0);
    if (normalizedEvent.repeat || elapsedSinceHandled < BACK_DEBOUNCE_MS) {
      normalizedEvent.preventDefault();
      normalizedEvent.stopPropagation();
      normalizedEvent.stopImmediatePropagation();
      Router.consumeRouteReturnBackGuard?.();
      return;
    }
    this.lastBackHandledAt = now;

    normalizedEvent.preventDefault();
    normalizedEvent.stopPropagation();
    normalizedEvent.stopImmediatePropagation();

    if (Router.consumeRouteReturnBackGuard?.()) {
      return;
    }

    const currentScreen = Router.getCurrentScreen();
    const consumeResult = currentScreen?.consumeBackRequest?.();
    if (consumeResult) {
      if (consumeResult === "history") {
        return;
      }
      Router.suppressNextPopstate?.();
      return;
    }

    Router.back();
  },

  handleKey(event) {
    if (event?.target && !document.contains(event.target)) {
      return;
    }

    if (hasActiveModal()) {
      return;
    }

    const normalizedEvent = buildNormalizedEvent(event);
    const keyIdentity = this.getKeyIdentity(normalizedEvent);
    if (keyIdentity && (!normalizedEvent.repeat || !this.activeKeyDownStartedAt.has(keyIdentity))) {
      this.activeKeyDownStartedAt.set(keyIdentity, Date.now());
    }

    if (
      Platform.isBackEvent({
        target: normalizedEvent.target,
        key: normalizedEvent.key,
        code: normalizedEvent.code,
        keyName: normalizedEvent.keyName,
        keyCode: normalizedEvent.keyCode,
        originalKeyCode: normalizedEvent.originalKeyCode
      })
    ) {
      this.handleBack(event, normalizedEvent);
      return;
    }

    const currentScreen = Router.getCurrentScreen();

    if (currentScreen?.onKeyDown) {
      Promise.resolve(currentScreen.onKeyDown(normalizedEvent)).catch((error) => {
        console.warn("Screen keydown handler failed", error);
      });
    }
  },

  handleKeyUp(event) {
    if (event?.target && !document.contains(event.target)) return;

    const normalizedEvent = buildNormalizedEvent(event);
    const keyIdentity = this.getKeyIdentity(normalizedEvent);
    if (hasActiveModal()) {
      if (keyIdentity) {
        this.activeKeyDownStartedAt.delete(keyIdentity);
      }
      return;
    }

    if (keyIdentity) {
      const startedAt = Number(this.activeKeyDownStartedAt.get(keyIdentity) || 0);
      normalizedEvent.keyDownDurationMs = startedAt > 0 ? Math.max(0, Date.now() - startedAt) : 0;
      this.activeKeyDownStartedAt.delete(keyIdentity);
    }

    const currentScreen = Router.getCurrentScreen();
    if (!currentScreen?.onKeyUp) {
      return;
    }
    Promise.resolve(currentScreen.onKeyUp(normalizedEvent)).catch((error) => {
      console.warn("Screen keyup handler failed", error);
    });
  },

  getKeyIdentity(event) {
    const keyCode = Number(event?.keyCode || event?.which || 0);
    if (keyCode) {
      return `code:${keyCode}`;
    }
    const key = String(event?.key || event?.code || event?.keyName || "").trim();
    return key ? `key:${key}` : "";
  }
};
