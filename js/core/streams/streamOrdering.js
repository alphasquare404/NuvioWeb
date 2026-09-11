const UNKNOWN_SOURCE_RANK = Number.MAX_SAFE_INTEGER;

function finiteSourceRank(value) {
  const rank = Number(value);
  return Number.isFinite(rank) && rank >= 0 && rank < UNKNOWN_SOURCE_RANK ? rank : null;
}

function normalizedName(value) {
  return String(value || "").trim();
}

function streamAddonOrderIndex(stream = {}) {
  return finiteSourceRank(stream?.addonOrderIndex) ?? finiteSourceRank(stream?.streamOrigin?.addonOrderIndex);
}

function streamSourceKind(stream = {}) {
  const originKind = normalizedName(stream?.streamOrigin?.kind).toLowerCase();
  if (originKind) return originKind;
  return streamAddonOrderIndex(stream) != null ? "addon" : "plugin";
}

function streamSourceGroupKey(stream = {}, index = 0) {
  const origin = stream?.streamOrigin || {};
  const kind = streamSourceKind(stream);
  const identity =
    kind === "plugin"
      ? origin.sourceProviderId || stream.sourceProviderId || origin.addonName || stream.addonName
      : origin.addonId ||
        stream.addonId ||
        origin.addonBaseUrl ||
        stream.addonBaseUrl ||
        origin.addonName ||
        stream.addonName;
  return `${kind}:${normalizedName(identity) || `index-${index}`}`;
}

function buildAddonRanks(streams, sourceChips) {
  const ranks = new Map();
  const pluginNames = new Set(
    (Array.isArray(streams) ? streams : [])
      .filter((stream) => streamSourceKind(stream) === "plugin")
      .map((stream) => normalizedName(stream?.addonName))
      .filter(Boolean)
  );
  (Array.isArray(sourceChips) ? sourceChips : []).forEach((chip, index) => {
    const name = normalizedName(chip?.name);
    if (!name || pluginNames.has(name)) return;
    const rank = finiteSourceRank(chip?.orderIndex) ?? index;
    if (!ranks.has(name) || rank < ranks.get(name)) ranks.set(name, rank);
  });
  (Array.isArray(streams) ? streams : []).forEach((stream) => {
    if (streamSourceKind(stream) === "plugin") return;
    const name = normalizedName(stream?.addonName);
    const rank = streamAddonOrderIndex(stream);
    if (name && rank != null && !ranks.has(name)) ranks.set(name, rank);
  });
  return ranks;
}

/** Keeps direct-debrid groups first, addon groups in configured order, and plugin groups last. */
export function orderStreamsByAddonOrder(
  streams = [],
  sourceChips = [],
  { isDirectDebrid = () => false } = {}
) {
  const list = (Array.isArray(streams) ? streams : []).filter(Boolean);
  if (list.length <= 1) return list.slice();
  const addonRanks = buildAddonRanks(list, sourceChips);
  const groups = [];
  const groupsByKey = new Map();
  list.forEach((stream, index) => {
    const key = streamSourceGroupKey(stream, index);
    let group = groupsByKey.get(key);
    if (!group) {
      group = { firstIndex: index, items: [], isDirectDebrid: false };
      groupsByKey.set(key, group);
      groups.push(group);
    }
    group.items.push(stream);
    try {
      group.isDirectDebrid = group.isDirectDebrid || Boolean(isDirectDebrid(stream));
    } catch (_) {
      // A malformed resolver marker must not prevent the source list loading.
    }
  });
  const groupRank = (group) => {
    if (group.isDirectDebrid) return { bucket: 0, rank: 0 };
    const addonName = normalizedName(group.items[0]?.addonName);
    if (addonRanks.has(addonName)) {
      return { bucket: 1, rank: addonRanks.get(addonName) };
    }
    return { bucket: 2, rank: 0 };
  };
  groups.sort((left, right) => {
    const leftRank = groupRank(left);
    const rightRank = groupRank(right);
    if (leftRank.bucket !== rightRank.bucket) return leftRank.bucket - rightRank.bucket;
    if (leftRank.rank !== rightRank.rank) return leftRank.rank - rightRank.rank;
    return left.firstIndex - right.firstIndex;
  });
  return groups.flatMap((group) => group.items);
}

export function orderSourceNames(streams = [], sourceChips = [], { isDirectDebrid = () => false } = {}) {
  const ordered = [];
  orderStreamsByAddonOrder(streams, sourceChips, { isDirectDebrid }).forEach((stream) => {
    const name = normalizedName(stream?.addonName);
    if (name && !ordered.includes(name)) ordered.push(name);
  });
  (Array.isArray(sourceChips) ? sourceChips : [])
    .slice()
    .sort(
      (left, right) =>
        (finiteSourceRank(left?.orderIndex) ?? UNKNOWN_SOURCE_RANK) -
        (finiteSourceRank(right?.orderIndex) ?? UNKNOWN_SOURCE_RANK)
    )
    .forEach((chip) => {
      const name = normalizedName(chip?.name);
      if (name && !ordered.includes(name)) ordered.push(name);
    });
  return ordered;
}
