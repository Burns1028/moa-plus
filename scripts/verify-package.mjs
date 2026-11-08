import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nested = join(root, "packages/project-mode");
const dist = join(root, "dist");
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const workspace = await json(join(root, "package.json"));
const bundle = await json(join(nested, "package.json"));
assert.equal(workspace.name, bundle.name);
assert.equal(workspace.private, true);
assert.equal(bundle.private, undefined);
assert.deepEqual(workspace.dsh.client, bundle.dsh.client);
assert.deepEqual(workspace.peerDependencies, bundle.peerDependencies);
assert.ok(
  !Object.keys(workspace.scripts).some((s) =>
    /^(prepare|preinstall|install|postinstall)$/.test(s),
  ),
);
const gitRef = process.argv
  .find((a) => a.startsWith("--git-ref="))
  ?.slice("--git-ref=".length);
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 12 * 1024 * 1024,
  });
const temp = await mkdtemp(join(tmpdir(), "project-mode-release-"));
const results = [];
await mkdir(dist, { recursive: true });
try {
  for (const [label, cwd] of [
    ["npm", nested],
    ["forwarder", root],
  ]) {
    const [pack] = JSON.parse(
      run(
        "npm",
        [
          "pack",
          "--json",
          "--ignore-scripts",
          "--workspaces=false",
          "--pack-destination",
          dist,
        ],
        cwd,
      ),
    );
    const files = pack.files.map((f) => f.path);
    assert.ok(files.length > 25);
    assert.ok(
      !files.some((p) =>
        /(?:node_modules|\.tsbuildinfo|_build-|\.superpowers)/.test(p),
      ),
    );
    assert.ok(
      !files.some((p) => /lib\/types\/(?:host|client)\/.*\.js$/.test(p)),
    );
    const prefix = label === "npm" ? "" : "packages/project-mode/";
    for (const file of [
      "lib/index.js",
      "lib/client.js",
      "lib/types/host/index.d.ts",
      "lib/types/client/index.d.ts",
      "lib/types/shared/index.js",
      "lib/typert.host.js",
      "lib/typert.remote-client.js",
      "assets/icon.svg",
      "cordis.patch.yml",
    ])
      assert.ok(files.includes(prefix + file), file);
    for (const file of [
      "LICENSE",
      "README.md",
      "README.zh.md",
      "THIRD_PARTY_NOTICES.md",
      "CHANGELOG.md",
      "docs/manual-verification.md",
      "docs/verification.md",
    ])
      assert.ok(files.includes(file), file);
    const artifact = join(
      dist,
      `dsh-plugin-project-mode-${bundle.version}-${label}.tgz`,
    );
    await rename(join(dist, pack.filename), artifact);
    results.push({
      label,
      artifact,
      files: files.length,
      size: pack.size,
      integrity: pack.integrity,
    });
  }
  if (gitRef) {
    assert.match(gitRef, /^[a-f0-9]{7,40}$/);
    const commit = run("git", ["rev-parse", gitRef + "^{commit}"], root).trim();
    results.push({
      label: "git",
      artifact: "git+" + pathToFileURL(root).href + "#" + commit,
      commit,
    });
  }
  // Match the native runtime used by the full fixture. Build tools and test UI
  // libraries are deliberately absent from the installed consumers.
  const native = Object.fromEntries(
    Object.entries(workspace.devDependencies).filter(
      ([key]) =>
        key.startsWith("@deepseek-ai/") &&
        key !== "@deepseek-ai/dsh-typert-generator",
    ),
  );
  const fixture = ts.transpileModule(
    (await readFile(join(root, "tests/host/fixture.ts"), "utf8")).replace(
      "../../packages/project-mode/src/host/index.ts",
      bundle.name,
    ),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2024,
        module: ts.ModuleKind.ESNext,
      },
    },
  ).outputText;
  const smoke = await readFile(
    join(root, "tests/integration/installed-smoke.mjs"),
    "utf8",
  );
  for (const result of results) {
    const consumer = join(temp, result.label);
    await mkdir(consumer);
    await writeFile(
      join(consumer, "package.json"),
      JSON.stringify(
        {
          name: `project-mode-${result.label}-consumer`,
          private: true,
          type: "module",
          dependencies: {
            ...native,
            react: "18.3.1",
            zod: "4.4.3",
            [bundle.name]: result.artifact,
          },
        },
        null,
        2,
      ),
    );
    run(
      "npm",
      ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"],
      consumer,
    );
    await writeFile(join(consumer, "native-fixture.mjs"), fixture);
    await writeFile(join(consumer, "smoke.mjs"), smoke);
    // A fresh rc.3 install must not silently inherit this checkout's local
    // native additions. Prove its explicit refusal before applying the same
    // audited compatibility helper to this disposable consumer only.
    let missingCompatibility;
    try {
      run(process.execPath, ["smoke.mjs"], consumer);
    } catch (error) {
      missingCompatibility = error;
    }
    assert.ok(
      missingCompatibility,
      "Unpatched rc.3 unexpectedly accepted the plugin",
    );
    assert.match(
      String(missingCompatibility.stderr),
      /project-mode\/native-compatibility-required/,
      "Fresh consumer must report the missing native compatibility API",
    );
    result.unpatchedCompatibilityRejected = true;
    const compatArgs = [
      join(root, "scripts/apply-native-compat.mjs"),
      "--modules",
      join(consumer, "node_modules"),
      "--backup",
      join(consumer, "native-compat-backup"),
    ];
    run(process.execPath, [...compatArgs, "--dry-run"], consumer);
    run(process.execPath, compatArgs, consumer);
    result.nativeCompatibilityApplied = true;
    await writeFile(
      join(consumer, "types.mts"),
      `import Host from 'dsh-plugin-project-mode';
import remote from 'dsh-plugin-project-mode/remote';
import type { ProjectSnapshot } from 'dsh-plugin-project-mode/shared';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-gateway/client';
declare const ctx: Context;
const list = ctx.remote.projectMode.catalog();
const descriptor = remote.methods['projectMode/catalog'];
const plugin: typeof Host = Host;
const snapshot: ProjectSnapshot | null = null;
void [list, descriptor, plugin, snapshot];
`,
    );
    await writeFile(
      join(consumer, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2024",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          types: [],
        },
        files: ["types.mts"],
      }),
    );
    run(
      process.execPath,
      [
        join(root, "node_modules/typescript/bin/tsc"),
        "-p",
        join(consumer, "tsconfig.json"),
      ],
      consumer,
    );
    result.declarations = true;
    result.smoke = JSON.parse(
      run(process.execPath, ["smoke.mjs"], consumer).trim(),
    );
    console.log(
      `${result.label}: unpatched refusal, explicit native compatibility, actual install, Host import, browser factory, native Loader auto discovery (9 endpoints), Client Gateway roundtrip and disposal passed`,
    );
  }
  if (gitRef) {
    const checkout = join(temp, "clean-checkout");
    run(
      "git",
      ["clone", "--quiet", "--no-checkout", "--local", root, checkout],
      root,
    );
    run("git", ["checkout", "--quiet", results.at(-1).commit], checkout);
    run(
      "npm",
      ["ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"],
      checkout,
    );
    assert.ok(
      await readFile(join(checkout, "node_modules/typescript/bin/tsc")),
    );
    assert.equal(
      (
        await json(
          join(checkout, "node_modules/dsh-plugin-project-mode/package.json"),
        )
      ).name,
      bundle.name,
    );
    results.at(-1).cleanCheckoutCi = true;
    console.log("git: clean checkout npm ci with the single lockfile passed");
  }
  await writeFile(
    join(dist, "verification.json"),
    JSON.stringify({ date: new Date().toISOString(), results }, null, 2) + "\n",
  );
  console.log(`Artifacts and evidence: ${dist}`);
} catch (error) {
  if (error.stdout) console.error(String(error.stdout));
  if (error.stderr) console.error(String(error.stderr));
  throw error;
} finally {
  await rm(temp, { recursive: true, force: true });
}
