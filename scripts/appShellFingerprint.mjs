import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export async function appShellFingerprint(directory) {
  const hash = createHash("sha256");
  async function visit(relative = "") {
    const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile() && name !== "sw.js") {
        hash.update(name).update("\0").update(await readFile(path.join(directory, name))).update("\0");
      }
    }
  }
  await visit();
  return hash.digest("hex").slice(0, 16);
}
