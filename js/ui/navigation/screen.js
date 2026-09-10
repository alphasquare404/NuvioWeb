export function isSpatialCardTarget(node) {
  return Boolean(node?.matches?.("article.focusable"));
}

function isScrollable(node, axis) {
  if (!node) return false;
  const style = globalThis.getComputedStyle?.(node);
  const overflow = axis === "x" ? style?.overflowX : style?.overflowY;
  const scrollSize = axis === "x" ? Number(node.scrollWidth || 0) : Number(node.scrollHeight || 0);
  const clientSize = axis === "x" ? Number(node.clientWidth || 0) : Number(node.clientHeight || 0);
  return /auto|scroll|overlay/i.test(String(overflow || "")) && scrollSize > clientSize + 1;
}

function getScrollContainer(node, axis) {
  for (let parent = node?.parentElement || null; parent; parent = parent.parentElement) {
    if (isScrollable(parent, axis)) return parent;
  }
  return globalThis.document?.scrollingElement || globalThis.document?.documentElement || null;
}

function scrollNearest(container, target, axis) {
  if (!container || !target) return;
  const targetRect = target.getBoundingClientRect?.();
  if (!targetRect) return;
  const isDocumentScroll =
    container === globalThis.document?.scrollingElement || container === globalThis.document?.documentElement;
  const viewportRect = isDocumentScroll
    ? {
        left: 0,
        top: 0,
        right: Number(globalThis.innerWidth || globalThis.document?.documentElement?.clientWidth || 0),
        bottom: Number(globalThis.innerHeight || globalThis.document?.documentElement?.clientHeight || 0)
      }
    : container.getBoundingClientRect?.();
  if (!viewportRect) return;

  const before = axis === "x" ? targetRect.left - viewportRect.left : targetRect.top - viewportRect.top;
  const after = axis === "x" ? targetRect.right - viewportRect.right : targetRect.bottom - viewportRect.bottom;
  const inset = axis === "x" ? 16 : 20;
  let adjustment = 0;
  if (before < inset) adjustment = before - inset;
  else if (after > -inset) adjustment = after + inset;
  if (Math.abs(adjustment) <= 1) return;

  const property = axis === "x" ? "scrollLeft" : "scrollTop";
  const max = Math.max(
    0,
    Number(axis === "x" ? container.scrollWidth : container.scrollHeight) -
      Number(axis === "x" ? container.clientWidth : container.clientHeight)
  );
  container[property] = Math.max(0, Math.min(max, Number(container[property] || 0) + adjustment));
}

export function ensureSpatialFocusVisible(node) {
  if (!node) return;
  scrollNearest(getScrollContainer(node, "y"), node, "y");
  scrollNearest(getScrollContainer(node, "x"), node, "x");
}

function focusSpatialTarget(node, { scroll = false } = {}) {
  if (!node) return;
  if (scroll) ensureSpatialFocusVisible(node);
  if (isSpatialCardTarget(node)) return;
  try {
    node.focus({ preventScroll: true });
  } catch (_) {
    try {
      node.focus();
    } catch (_) {}
  }
}

export const ScreenUtils = {
  show(container) {
    if (!container) {
      return;
    }
    if (container.style.display !== "block") {
      container.style.display = "block";
    }
  },

  hide(container) {
    if (!container) {
      return;
    }
    if (container.style.display !== "none") {
      container.style.display = "none";
    }
    if (container.childNodes?.length) {
      if (typeof container.replaceChildren === "function") {
        container.replaceChildren();
      } else {
        container.innerHTML = "";
      }
    }
  },

  setInitialFocus(container, selector = ".focusable") {
    const modalOpen = Boolean(globalThis?.document?.body?.classList?.contains("nuvio-modal-open"));
    if (modalOpen) {
      const existingFocused = container?.querySelector?.(".focusable.focused") || null;
      if (existingFocused instanceof HTMLElement && container?.contains(existingFocused)) {
        focusSpatialTarget(existingFocused);
        return existingFocused;
      }
      return null;
    }
    const existingFocused = container?.querySelector?.(".focusable.focused") || null;
    if (existingFocused instanceof HTMLElement && container?.contains(existingFocused)) {
      focusSpatialTarget(existingFocused);
      return existingFocused;
    }
    const first = container?.querySelector(selector);
    if (!first) {
      return;
    }
    first.classList.add("focused");
    focusSpatialTarget(first);
  },

  moveFocus(container, direction, selector = ".focusable") {
    if (globalThis?.document?.body?.classList?.contains("nuvio-modal-open")) {
      return;
    }
    const list = Array.from(container?.querySelectorAll(selector) || []);
    const current = container?.querySelector(`${selector}.focused`);
    if (!list.length || !current) {
      return;
    }

    const index = Number(current.dataset.index || 0);
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= list.length) {
      return;
    }

    current.classList.remove("focused");
    list[nextIndex].classList.add("focused");
    focusSpatialTarget(list[nextIndex], { scroll: true });
  },

  moveFocusDirectional(container, direction, selector = ".focusable") {
    if (globalThis?.document?.body?.classList?.contains("nuvio-modal-open")) {
      return;
    }
    const list = Array.from(container?.querySelectorAll(selector) || []).filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    if (!list.length) {
      return;
    }

    const current = container?.querySelector(`${selector}.focused`) || list[0];
    if (!current.classList.contains("focused")) {
      list.forEach((node) => node.classList.remove("focused"));
      current.classList.add("focused");
      focusSpatialTarget(current);
      return;
    }

    const currentRect = current.getBoundingClientRect();
    const cx = currentRect.left + currentRect.width / 2;
    const cy = currentRect.top + currentRect.height / 2;

    const candidates = list
      .filter((node) => node !== current)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const nx = rect.left + rect.width / 2;
        const ny = rect.top + rect.height / 2;
        const dx = nx - cx;
        const dy = ny - cy;
        return { node, rect, dx, dy };
      })
      .filter(({ dx, dy }) => {
        if (direction === "up") return dy < -2;
        if (direction === "down") return dy > 2;
        if (direction === "left") return dx < -2;
        if (direction === "right") return dx > 2;
        return false;
      })
      .map((entry) => {
        const primary =
          direction === "up" || direction === "down" ? Math.abs(entry.dy) : Math.abs(entry.dx);
        const secondary =
          direction === "up" || direction === "down" ? Math.abs(entry.dx) : Math.abs(entry.dy);
        const axisTolerance =
          direction === "up" || direction === "down"
            ? Math.max(currentRect.width * 0.7, entry.rect.width * 0.7, 48)
            : Math.max(currentRect.height * 0.7, entry.rect.height * 0.7, 48);
        const aligned =
          direction === "up" || direction === "down"
            ? secondary <= axisTolerance
            : secondary <= axisTolerance;
        return {
          ...entry,
          aligned,
          score: primary * 1000 + secondary
        };
      });

    let target = null;

    if (direction === "up" || direction === "down") {
        const nearestPrimary = candidates.reduce((min, entry) => {
          const primary = Math.abs(entry.dy);
          return Math.min(min, primary);
        }, Number.POSITIVE_INFINITY);
        const rowTolerance = Math.max(currentRect.height * 0.9, 42);
        const nearestRow = candidates.filter((entry) => {
          const primary = Math.abs(entry.dy);
          return primary <= nearestPrimary + rowTolerance;
        });
        const alignedInRow = nearestRow
          .filter((entry) => entry.aligned)
          .sort((left, right) => Math.abs(left.dx) - Math.abs(right.dx));
        const rowSorted = nearestRow.sort((left, right) => {
          const sec = Math.abs(left.dx) - Math.abs(right.dx);
          if (sec !== 0) {
            return sec;
          }
          return Math.abs(left.dy) - Math.abs(right.dy);
        });
        target = alignedInRow[0]?.node || rowSorted[0]?.node || null;
    } else {
      const nearestPrimary = candidates.reduce((min, entry) => {
        const primary = Math.abs(entry.dx);
        return Math.min(min, primary);
      }, Number.POSITIVE_INFINITY);
      const columnTolerance = Math.max(currentRect.width * 0.9, 42);
      const nearestColumn = candidates.filter((entry) => {
        const primary = Math.abs(entry.dx);
        return primary <= nearestPrimary + columnTolerance;
      });
      const alignedInColumn = nearestColumn
        .filter((entry) => entry.aligned)
        .sort((left, right) => Math.abs(left.dy) - Math.abs(right.dy));
      const columnSorted = nearestColumn.sort((left, right) => {
        const sec = Math.abs(left.dy) - Math.abs(right.dy);
        if (sec !== 0) {
          return sec;
        }
        return Math.abs(left.dx) - Math.abs(right.dx);
      });
      target = alignedInColumn[0]?.node || columnSorted[0]?.node || null;
    }
    if (!target) {
      return;
    }

    current.classList.remove("focused");
    target.classList.add("focused");
    focusSpatialTarget(target, { scroll: true });
  },

  handleDpadNavigation(event, container, selector = ".focusable") {
    if (globalThis?.document?.body?.classList?.contains("nuvio-modal-open")) {
      return false;
    }
    const code = Number(event?.keyCode || 0);
    const direction =
      code === 38
        ? "up"
        : code === 40
          ? "down"
          : code === 37
            ? "left"
            : code === 39
              ? "right"
              : null;
    if (!direction) {
      return false;
    }
    if (typeof event?.preventDefault === "function") {
      event.preventDefault();
    }
    this.moveFocusDirectional(container, direction, selector);
    return true;
  },

  indexFocusables(container, selector = ".focusable") {
    const list = Array.from(container?.querySelectorAll(selector) || []);
    list.forEach((node, index) => {
      const indexValue = String(index);
      if (node.dataset.index !== indexValue) {
        node.dataset.index = indexValue;
      }
      if (isSpatialCardTarget(node)) {
        node.removeAttribute?.("tabindex");
      } else if (node.tabIndex !== 0) {
        node.tabIndex = 0;
      }
    });
  }
};
