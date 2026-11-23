import { cp, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = resolve(root, "packages/project-mode");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const bundle = await readJson(resolve(packageRoot, "package.json"));
const workspace = await readJson(resolve(root, "package.json"));
const prefix = "./packages/project-mode/";
function forward(value) {
  if (typeof value === "string") {
    if (!value.startsWith("./"))
      throw new Error(`Non-relative package export: ${value}`);
    return prefix + value.slice(2);
  }
  if (Array.isArray(value)) return value.map(forward);
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, forward(entry)]),
  );
}

// Keep the repository root installable from Git while the nested package remains
// the single publishable npm bundle. No prepare/install hooks or host downloads.
Object.assign(workspace, {
  name: bundle.name,
  version: bundle.version,
  description: bundle.description,
  license: bundle.license,
  repository: bundle.repository,
  homepage: bundle.homepage,
  bugs: bundle.bugs,
  keywords: bundle.keywords,
  private: true,
  main: prefix + bundle.main.replace(/^\.\//, ""),
  types: prefix + bundle.types.replace(/^\.\//, ""),
  exports: { ...forward(bundle.exports), "./package.json": "./package.json" },
  icon: forward(bundle.icon),
  dsh: {
    ...bundle.dsh,
    bundle: { ...bundle.dsh.bundle, patch: forward(bundle.dsh.bundle.patch) },
  },
  dependencies: bundle.dependencies,
  peerDependencies: bundle.peerDependencies,
  peerDependenciesMeta: bundle.peerDependenciesMeta,
  files: [
    "packages/project-mode/package.json",
    ...bundle.files.map((file) => "packages/project-mode/" + file),
    "docs",
    "README.zh.md",
    "THIRD_PARTY_NOTICES.md",
    "CHANGELOG.md",
  ],
});
await writeFile(
  resolve(root, "package.json"),
  JSON.stringify(workspace, null, 2) + "\n",
);
for (const file of [
  "README.md",
  "README.zh.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "CHANGELOG.md",
]) {
  await cp(resolve(root, file), resolve(packageRoot, file));
}
await cp(resolve(root, "docs"), resolve(packageRoot, "docs"), {
  recursive: true,
});
