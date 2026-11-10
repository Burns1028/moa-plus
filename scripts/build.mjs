import { build } from "tsdown";
import {
  WorkspaceAnalyzer,
  FaceModelEmitter,
  writeWorkspaceArtifacts,
} from "@deepseek-ai/dsh-typert-generator";
import { typertPlugin } from "@deepseek-ai/dsh-typert-generator/tsdown";
import { execFileSync } from "node:child_process";
import { withProtocolWorkspace } from "./typert-workspace.mjs";
import { resolve } from "node:path";
const cwd = resolve("packages/project-mode");
execFileSync(
  process.execPath,
  [
    "node_modules/typescript/bin/tsc",
    "-p",
    "packages/project-mode/tsconfig.json",
  ],
  { stdio: "inherit" },
);
await build({
  cwd,
  entry: { index: "src/host/index.ts" },
  outDir: "lib",
  format: "esm",
  platform: "node",
  target: "es2024",
  dts: false,
  clean: false,
  plugins: [
    { name: "native-decorator-lowering", transform: typertPlugin().transform },
  ],
  deps: { neverBundle: [/^@deepseek-ai\//, "zod"] },
  fixedExtension: false,
});
await withProtocolWorkspace(async () => {
  const workspace = new WorkspaceAnalyzer({
    root: resolve("."),
    packages: ["dsh-plugin-project-mode"],
    faces: ["host"],
    checkDiagnostics: false,
  }).analyze();
  const result = workspace.faces.flatMap((face) =>
    face.packages
      .filter((p) => p.name === "dsh-plugin-project-mode")
      .map((p) => ({
        ...new FaceModelEmitter(face).emit(p.name),
        packageRoot: p.root,
      })),
  );
  writeWorkspaceArtifacts(resolve("."), result);
});

// A syntactically valid but empty artifact is not a successful Remote build.
const { default: remote } = await import(
  new URL(
    "../packages/project-mode/lib/typert.remote-client.js",
    import.meta.url,
  )
);
const expected = [
  "catalog",
  "control",
  "follow",
  "followWorkerParent",
  "history",
  "mode",
  "setEnabled",
  "snapshot",
  "timeline",
].map((method) => `projectMode/${method}`);
if (
  JSON.stringify(Object.keys(remote.methods).sort()) !==
  JSON.stringify(expected)
)
  throw new Error("Generated Remote method set is incomplete");
for (const method of Object.values(remote.methods)) {
  method.input().create();
  method.result.create();
}

// Public browser loader contract: Host React/native identities remain external.
execFileSync(
  process.execPath,
  [
    "node_modules/typescript/bin/tsc",
    "-p",
    "packages/project-mode/tsconfig.client.json",
    "--noEmit",
    "false",
    "--declaration",
    "--outDir",
    "packages/project-mode/lib/types",
    "--rootDir",
    "packages/project-mode/src",
  ],
  { stdio: "inherit" },
);
await build({
  cwd,
  entry: { client: "src/client/index.tsx" },
  outDir: "lib",
  format: "cjs",
  platform: "browser",
  target: "es2024",
  loader: { ".png": "dataurl" },
  dts: false,
  clean: false,
  deps: {
    neverBundle: [/^react(?:\/|$)/, "zod"],
    alwaysBundle: [/^@deepseek-ai\/dsh-(?:typert-protocol|util-workspace-path)(?:\/|$)/],
    onlyBundle: [/^@deepseek-ai\/dsh-(?:typert-protocol|util-workspace-path)(?:\/|$)/],
  },
  outputOptions: {
    banner:
      'window.__ModuleLoader__.load({ id: "dsh-plugin-project-mode", factory: (require) => {',
    intro: "var module = { exports: {} }; var exports = module.exports;",
    footer: "return module.exports; } });",
    entryFileNames: "[name].js",
  },
});

// Keep Git forwarding metadata and tarball documentation in sync.
await import("./prepare-release.mjs");
