// Keep playback and device tools fixed; paginate only the middle actions.
export function paginateBrowserToolbar(actions, { width, step = 40, page = 0 } = {}) {
  const slots = Math.max(3, Math.floor(Number(width || 0) / step));
  if (actions.length <= slots) return { actions, page: 0, pages: 1 };
  const size = Math.max(1, slots - 2);
  const pages = Math.ceil(actions.length / size);
  const current = Math.max(0, Math.min(pages - 1, Number(page) || 0));
  return { actions: actions.slice(current * size, (current + 1) * size), page: current, pages };
}
