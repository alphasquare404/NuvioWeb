import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const packageJsonPath = path.join(rootDir, "package.json");

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function readAppMetadata() {
  const packageJson = await readJson(packageJsonPath);
  return {
    name: String(packageJson?.name || "").trim(),
    version: String(packageJson?.version || "0.0.0").trim() || "0.0.0"
  };
}

export async function syncVersionFiles() {
  const { version } = await readAppMetadata();
  return version;
}
