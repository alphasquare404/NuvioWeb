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
  const sourceRepositoryUrl = String(packageJson?.repository?.url || "")
    .trim()
    .replace(/^git\+/, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  const fork = packageJson?.nuvioFork || {};
  const sourceUrl = sourceRepositoryUrl || "https://github.com/alphasquare404/NuvioWeb";
  const version = String(packageJson?.version || "0.0.0").trim() || "0.0.0";
  return {
    name: String(packageJson?.name || "").trim(),
    version,
    identity: {
      name: "NuvioWeb",
      version,
      upstreamVersion: String(fork.upstreamVersion || "0.3.35").trim() || "0.3.35",
      maintainer: String(fork.maintainer || "alphasquare").trim() || "alphasquare",
      sourceRepositoryUrl: sourceUrl,
      issuesUrl: `${sourceUrl}/issues`,
      contributorsUrl: `${sourceUrl}/graphs/contributors`,
      licenseUrl: `${sourceUrl}/blob/${String(fork.defaultBranch || "main").trim() || "main"}/LICENSE`,
      upstreamRepositoryUrl:
        String(fork.upstreamRepository || "https://github.com/NuvioMedia/NuvioWeb").trim() ||
        "https://github.com/NuvioMedia/NuvioWeb",
      latestReleaseUrl: `https://api.github.com/repos/${sourceUrl.replace("https://github.com/", "")}/releases/latest`
    }
  };
}

export async function syncVersionFiles() {
  const { version } = await readAppMetadata();
  return version;
}
