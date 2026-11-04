// A seekable virtual file backed only by the ranges ffprobe actually requests.
// Missing bytes are errors, never zero-filled invented media or full-file buffers.
export function installProbeSparseFile(
  FS,
  { size, chunks, onMissing, patches = [] },
  path = "/probe-input"
) {
  const node = FS.createNode(FS.root, path.slice(1), 0o100444, 0);
  node.node_ops = {
    getattr: () => ({
      dev: 1,
      ino: node.id,
      mode: node.mode,
      nlink: 1,
      uid: 0,
      gid: 0,
      rdev: 0,
      size,
      atime: new Date(0),
      mtime: new Date(0),
      ctime: new Date(0),
      blksize: 4096,
      blocks: Math.ceil(size / 4096)
    })
  };
  node.stream_ops = {
    read(_stream, buffer, offset, length, position) {
      const wanted = Math.min(length, Math.max(0, size - position));
      let copied = 0;
      while (copied < wanted) {
        const at = position + copied;
        const chunk = chunks.find(
          (part) => at >= part.start && at < part.start + part.bytes.length
        );
        if (!chunk) {
          onMissing(at);
          if (copied) return copied;
          throw new FS.ErrnoError(29);
        }
        const from = at - chunk.start,
          count = Math.min(wanted - copied, chunk.bytes.length - from);
        buffer.set(chunk.bytes.subarray(from, from + count), offset + copied);
        for (const patch of patches) {
          const start = Math.max(at, patch.start);
          const end = Math.min(at + count, patch.start + patch.bytes.length);
          if (end > start)
            buffer.set(
              patch.bytes.subarray(start - patch.start, end - patch.start),
              offset + copied + start - at
            );
        }
        copied += count;
      }
      return copied;
    },
    llseek(stream, offset, whence) {
      const position =
        whence === 0
          ? offset
          : whence === 1
            ? stream.position + offset
            : whence === 2
              ? size + offset
              : NaN;
      if (!Number.isSafeInteger(position) || position < 0) throw new FS.ErrnoError(28);
      return position;
    }
  };
  return path;
}
