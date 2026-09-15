const stateMap = new Map();

export const RouteStateStore = {
  get(key) {
    if (!key) return null;
    return stateMap.has(key) ? stateMap.get(key) : null;
  },

  set(key, value) {
    if (!key) return;
    if (value == null) {
      stateMap.delete(key);
      return;
    }
    stateMap.set(key, value);
  },

  clear(key) {
    if (!key) return;
    stateMap.delete(key);
  },

  clearByPrefix(prefix) {
    if (!prefix) return;
    for (const key of stateMap.keys()) {
      if (String(key).startsWith(prefix)) {
        stateMap.delete(key);
      }
    }
  },

  clearByHistoryEntry(index) {
    if (!Number.isInteger(index) || index < 0) return;
    const entryMarker = `:entry:${index}:`;
    for (const key of stateMap.keys()) {
      if (String(key).includes(entryMarker)) {
        stateMap.delete(key);
      }
    }
  },

  clearAll() {
    stateMap.clear();
  }
};
