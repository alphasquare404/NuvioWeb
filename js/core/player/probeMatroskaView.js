// Metadata-only view: omit Matroska attachments using a same-size EBML Void.
// File offsets and all media/track bytes stay unchanged. Never inspect payload patterns.
export function probeMatroskaPatches(size, chunks) {
  const byte = (at) => {
    const part = chunks.find((c) => at >= c.start && at < c.start + c.bytes.length);
    return part ? part.bytes[at - part.start] : null;
  };
  const vint = (at, max, keepMarker = false) => {
    const first = byte(at);
    if (!first) return null;
    let width = 1;
    while (width <= max && !(first & (0x80 >> (width - 1)))) width++;
    if (width > max) return null;
    let value = BigInt(keepMarker ? first : first & ((0x80 >> (width - 1)) - 1));
    for (let n = 1; n < width; n++) {
      const next = byte(at + n);
      if (next == null) return null;
      value = (value << 8n) | BigInt(next);
    }
    const unknown = !keepMarker && value === (1n << BigInt(7 * width)) - 1n;
    if (!unknown && value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return { width, value: Number(value), unknown };
  };
  const header = (at, limit) => {
    const id = vint(at, 4, true);
    if (!id) return null;
    const length = vint(at + id.width, 8);
    if (!length) return null;
    const data = at + id.width + length.width;
    const end = length.unknown ? limit : data + length.value;
    if (!Number.isSafeInteger(end) || data > limit || end > limit) return null;
    return { id: id.value, at, data, end, length };
  };
  const ebml = header(0, size);
  if (ebml?.id !== 0x1a45dfa3 || ebml.length.unknown) return [];
  const segment = header(ebml.end, size);
  if (segment?.id !== 0x18538067) return [];
  const patches = [],
    visited = new Set(),
    targets = [segment.data];
  let budget = 512;
  const uint = (element) => {
    if (element.end - element.data > 8) return null;
    let value = 0;
    for (let at = element.data; at < element.end; at++) {
      const next = byte(at);
      if (next == null) return null;
      value = value * 256 + next;
    }
    return Number.isSafeInteger(value) ? value : null;
  };
  const seekHead = (head) => {
    for (let at = head.data; at < head.end && budget-- > 0;) {
      const entry = header(at, head.end);
      if (!entry || entry.length.unknown) break;
      if (entry.id === 0x4dbb) {
        let id = null,
          position = null;
        for (let p = entry.data; p < entry.end && budget-- > 0;) {
          const field = header(p, entry.end);
          if (!field || field.length.unknown) break;
          if (field.id === 0x53ab) id = uint(field);
          if (field.id === 0x53ac) position = uint(field);
          p = field.end;
        }
        if ([0x1941a469, 0x114d9b74].includes(id) && position != null) {
          const at = segment.data + position;
          if (at >= segment.data && at < segment.end) targets.push(at);
        }
      }
      at = entry.end;
    }
  };
  while (targets.length && budget > 0) {
    let at = targets.shift();
    while (at < segment.end && !visited.has(at) && budget-- > 0) {
      visited.add(at);
      const element = header(at, segment.end);
      if (!element || element.length.unknown || element.id === 0x1f43b675) break;
      if (element.id === 0x1941a469 && element.length.width <= 5) {
        const width = element.length.width + 3;
        let value = (1n << BigInt(7 * width)) | BigInt(element.length.value);
        const bytes = new Uint8Array(1 + width);
        bytes[0] = 0xec;
        for (let i = width; i > 0; i--) {
          bytes[i] = Number(value & 255n);
          value >>= 8n;
        }
        patches.push({ start: at, bytes });
      }
      if (element.id === 0x114d9b74) seekHead(element);
      at = element.end;
    }
  }
  return patches;
}
