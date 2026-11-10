import { readFile } from "node:fs/promises";
import path from "node:path";

// Scoped to the remux worker, never an on-disk edit of node_modules. We do not
// export attachment artwork/fonts and plain-text subtitles use their own reader.
// The pinned demuxer otherwise requests an entire Attachments element at once.
export function omitRemuxAttachments(source) {
  const rules = [
    ["id === EBMLId.Tags || id === EBMLId.Attachments", "id === EBMLId.Tags"],
    [
      "seekEntry.id === EBMLId.Attachments && !segment.attachmentsSeen",
      "false /* remux omits font/artwork attachment payloads */"
    ]
  ];
  for (const [before, after] of rules) {
    if (source.split(before).length !== 2)
      throw Error(
        "Pinned MediaBunny attachment policy no longer matches; review the dependency before building."
      );
    source = source.replace(before, after);
  }
  return source;
}

export function remuxLibraryPolicy({ onModifiedSource } = {}) {
  return {
    name: "remux-no-attachment-payloads",
    setup(build) {
      build.onLoad({ filter: /matroska-demuxer\.js$/ }, async ({ path: file }) => {
        if (!file.replaceAll("\\", "/").includes("/node_modules/mediabunny/")) return;
        const packageFile = path.resolve(path.dirname(file), "../../../../package.json");
        if (JSON.parse(await readFile(packageFile, "utf8")).version !== "1.65.2")
          throw Error("Review MediaBunny attachment policy for this version.");
        const contents = omitRemuxAttachments(await readFile(file, "utf8"));
        await onModifiedSource?.(contents);
        return { contents, loader: "js" };
      });
    }
  };
}
