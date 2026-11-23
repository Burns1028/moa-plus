import { it, expect } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  copyFile,
  rm,
  realpath,
  cp,
  readdir,
  stat,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { createTwoFilesPatch } from "diff";

const root = resolve(".");
const script = join(root, "scripts/apply-native-compat.mjs");
const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const packageFingerprint = (installed: Record<string, unknown>) => hash(Buffer.from(JSON.stringify(Object.fromEntries(
  ["type", "main", "exports", "imports", "dsh"]
    .filter((field) => Object.hasOwn(installed, field))
    .map((field) => [field, installed[field]]),
))));

it("backs up and audits runtime package metadata together with its implementation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "native metadata compat "));
  try {
    const checkout = join(directory, "helper");
    const profile = join(checkout, "compat/audited");
    const modules = join(directory, "node_modules");
    const packageRoot = join(modules, "@deepseek-ai/dsh-agent");
    const backup = join(directory, "backup");
    await mkdir(join(checkout, "scripts"), { recursive: true });
    await mkdir(profile, { recursive: true });
    await mkdir(join(packageRoot, "lib"), { recursive: true });
    await copyFile(script, join(checkout, "scripts/apply-native-compat.mjs"));
    const before = {
      "package.json": JSON.stringify({ name: "@deepseek-ai/dsh-agent", version: "0.2.2-rc.1", dependencies: {} }) + "\n",
      "lib/index.js": "export const capability = false;\n",
    };
    const after = {
      "package.json": JSON.stringify({ name: "@deepseek-ai/dsh-agent", version: "0.2.2-rc.1", dependencies: { "native-owner": "0.2.2-rc.1" } }) + "\n",
      "lib/index.js": "export const capability = true;\n",
    };
    let patch = "";
    for (const file of Object.keys(before) as (keyof typeof before)[]) {
      await writeFile(join(packageRoot, file), before[file]);
      patch += createTwoFilesPatch(`a/${file}`, `b/${file}`, before[file], after[file]);
    }
    await writeFile(join(profile, "owner.patch"), patch);
    await writeFile(join(profile, "manifest.json"), JSON.stringify([{
      package: "@deepseek-ai/dsh-agent", version: "0.2.2-rc.1", variant: "fixture",
      patch: "owner.patch", runtimePatch: "owner.patch",
      files: Object.keys(before).map(file => ({ file, before: hash(Buffer.from(before[file])), after: hash(Buffer.from(after[file])) })),
    }]));
    const args = [join(checkout, "scripts/apply-native-compat.mjs"), "--modules", modules, "--runtime-only", "--backup", backup];
    execFileSync(process.execPath, args, { stdio: "pipe" });
    execFileSync(process.execPath, args, { stdio: "pipe" });
    for (const file of Object.keys(before)) {
      expect(await readFile(join(packageRoot, file), "utf8")).toBe(after[file]);
      expect(await readFile(join(backup, "@deepseek-ai/dsh-agent", file), "utf8")).toBe(before[file]);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
async function originalRuntime() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "native compat ")));
  const modules = join(directory, "node_modules");
  const manifest = JSON.parse(
    await readFile(join(root, "compat/rc3/manifest.json"), "utf8"),
  );
  // The first package variant is the published npm preimage; later variants
  // accept an already released compatibility build of that same package.
  const variants = manifest.filter((entry: any, index: number) =>
    entry.variant !== "desktop" &&
    manifest.findIndex((other: any) => other.package === entry.package) === index,
  );
  for (const entry of variants) {
    const packageRoot = join(modules, entry.package);
    await mkdir(packageRoot, { recursive: true });
    await writeFile(
      join(packageRoot, "package.json"),
      JSON.stringify({ version: "0.2.1-rc.3" }),
    );
    for (const file of entry.files.filter((file: any) =>
      file.file.endsWith(".js"),
    )) {
      const target = join(packageRoot, file.file);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(
        join(root, "node_modules", entry.package, file.file),
        target,
      );
      expect(hash(await readFile(target))).toBe(file.after);
    }
    if (entry.files.some((file: any) => file.file.endsWith(".js"))) execFileSync("git", [
      "-c", "core.autocrlf=false", "-c", "core.eol=lf", "apply",
      "--reverse",
      "--unsafe-paths",
      `--directory=${packageRoot}`,
      "-",
    ], { input: (await readFile(join(root, "compat/rc3", entry.runtimePatch), "utf8")).replaceAll("\r\n", "\n") });
  }
  return { directory, modules, variants };
}

async function fingerprintRuntime() {
  const f = await originalRuntime();
  const checkout = join(f.directory, "fingerprinted helper");
  const profile = join(checkout, "compat/audited");
  await mkdir(join(checkout, "scripts"), { recursive: true });
  await copyFile(script, join(checkout, "scripts/apply-native-compat.mjs"));
  await cp(join(root, "compat/rc3"), profile, { recursive: true });
  const manifest = JSON.parse(JSON.stringify(f.variants));
  for (const entry of manifest) {
    const installed = JSON.parse(await readFile(join(root, "node_modules", entry.package, "package.json"), "utf8"));
    installed.version = "0.9.0";
    await writeFile(join(f.modules, entry.package, "package.json"), JSON.stringify(installed));
    const files = [];
    if (!entry.files.some((file: any) => file.file.endsWith(".js"))) {
      const file = "lib/index.js";
      const contents = await readFile(join(root, "node_modules", entry.package, file));
      const target = join(f.modules, entry.package, file);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, contents);
      files.push({ file, sha256: hash(contents) });
    }
    entry.runtimeFingerprint = { package: packageFingerprint(installed), files };
  }
  await writeFile(join(profile, "manifest.json"), JSON.stringify(manifest));
  return { ...f, checkout, profile, manifest,
    command: join(checkout, "scripts/apply-native-compat.mjs"),
    backup: join(f.directory, "fingerprint backup"),
  };
}

async function expectOriginalBytes(f: Awaited<ReturnType<typeof originalRuntime>>) {
  for (const entry of f.variants)
    for (const file of entry.files.filter((file: any) => file.file.endsWith(".js")))
      expect(hash(await readFile(join(f.modules, entry.package, file.file)))).toBe(file.before);
}
it("preflights, backs up and patches native runtimes at paths with spaces, with idempotent reapplication", async () => {
  const f = await originalRuntime();
  try {
    const backup = join(f.directory, "native backup");
    const args = [
      script,
      "--modules",
      f.modules,
      "--runtime-only",
      "--backup",
      backup,
    ];
    execFileSync(process.execPath, [...args, "--dry-run"]);
    for (const entry of f.variants)
      for (const file of entry.files.filter((file: any) =>
        file.file.endsWith(".js"),
      ))
        expect(
          hash(await readFile(join(f.modules, entry.package, file.file))),
        ).toBe(file.before);
    execFileSync(process.execPath, args);
    execFileSync(process.execPath, args);
    for (const entry of f.variants)
      for (const file of entry.files.filter((file: any) =>
        file.file.endsWith(".js"),
      )) {
        expect(
          hash(await readFile(join(f.modules, entry.package, file.file))),
        ).toBe(file.after);
        expect(
          hash(await readFile(join(backup, entry.package, file.file))),
        ).toBe(file.before);
      }
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});
it("applies checked-out CRLF patches without changing the audited runtime bytes", async () => {
  const f = await originalRuntime();
  try {
    const checkout = join(f.directory, "Windows checkout");
    await mkdir(join(checkout, "scripts"), { recursive: true });
    await copyFile(script, join(checkout, "scripts/apply-native-compat.mjs"));
    await cp(join(root, "compat/rc3"), join(checkout, "compat/rc3"), { recursive: true });
    for (const file of await readdir(join(checkout, "compat/rc3"))) {
      if (!file.endsWith(".patch")) continue;
      const target = join(checkout, "compat/rc3", file);
      await writeFile(target, (await readFile(target, "utf8")).replace(/\r?\n/g, "\r\n"));
    }
    execFileSync(process.execPath, [join(checkout, "scripts/apply-native-compat.mjs"), "--modules", f.modules, "--runtime-only", "--backup", join(f.directory, "backup")]);
    for (const entry of f.variants)
      for (const file of entry.files.filter((file: any) => file.file.endsWith(".js")))
        expect(hash(await readFile(join(f.modules, entry.package, file.file)))).toBe(file.after);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});
it("rejects an unlisted version when the profile has no complete runtime fingerprint", async () => {
  const f = await originalRuntime();
  try {
    const checkout = join(f.directory, "legacy helper");
    const profile = join(checkout, "compat/rc3");
    await mkdir(join(checkout, "scripts"), { recursive: true });
    await copyFile(script, join(checkout, "scripts/apply-native-compat.mjs"));
    await cp(join(root, "compat/rc3"), profile, { recursive: true });
    const manifest = JSON.parse(await readFile(join(profile, "manifest.json"), "utf8"));
    for (const entry of manifest) delete entry.runtimeFingerprint;
    await writeFile(join(profile, "manifest.json"), JSON.stringify(manifest));
    await writeFile(join(f.modules, "@deepseek-ai/dsh-agent/package.json"), JSON.stringify({ version: "0.9.0" }));
    let failure: any;
    try {
      execFileSync(process.execPath, [join(checkout, "scripts/apply-native-compat.mjs"), "--modules", f.modules, "--runtime-only", "--backup", join(f.directory, "backup")], { stdio: "pipe" });
    } catch (error) { failure = error; }
    expect(failure).toBeDefined();
    expect(String(failure.stderr)).toContain("Unsupported DSH runtime 0.9.0");
    const first = f.variants[0], file = first.files[0];
    expect(hash(await readFile(join(f.modules, first.package, file.file)))).toBe(file.before);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

it.each([false, true])("accepts a relabeled complete runtime fingerprint without mixing profiles (known agent version=%s)", async knownAgent => {
  const f = await fingerprintRuntime();
  try {
    if (knownAgent) {
      const file = join(f.modules, "@deepseek-ai/dsh-agent/package.json");
      const installed = JSON.parse(await readFile(file, "utf8"));
      installed.version = "0.2.1-rc.3";
      await writeFile(file, JSON.stringify(installed));
    }
    const args = [f.command, "--modules", f.modules, "--runtime-only", "--backup", f.backup];
    execFileSync(process.execPath, [...args, "--dry-run"]);
    await expectOriginalBytes(f);
    execFileSync(process.execPath, args);
    execFileSync(process.execPath, args);
    for (const entry of f.manifest) {
      for (const file of entry.files.filter((file: any) => file.file.endsWith(".js"))) {
        expect(hash(await readFile(join(f.modules, entry.package, file.file)))).toBe(file.after);
        expect(hash(await readFile(join(f.backup, entry.package, file.file)))).toBe(file.before);
      }
      for (const anchor of entry.runtimeFingerprint.files) {
        expect(hash(await readFile(join(f.modules, entry.package, anchor.file)))).toBe(anchor.sha256);
        await expect(stat(join(f.backup, entry.package, anchor.file))).rejects.toMatchObject({ code: "ENOENT" });
      }
    }
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

it.each(["exports", "read-only runtime", "runtime bytes", "missing fingerprint", "missing JS anchor"])("refuses a relabeled runtime with altered %s before writing any package", async changed => {
  const f = await fingerprintRuntime();
  try {
    const entry = f.manifest.find((entry: any) => entry.files.some((file: any) => file.file.endsWith(".js")));
    const anchorEntry = f.manifest.find((entry: any) => !entry.files.some((file: any) => file.file.endsWith(".js")));
    let changedFile: string | undefined;
    if (changed === "exports") {
      const file = join(f.modules, entry.package, "package.json");
      const installed = JSON.parse(await readFile(file, "utf8"));
      installed.exports = { ".": "./different-runtime.js" };
      await writeFile(file, JSON.stringify(installed));
    } else if (changed === "read-only runtime") {
      const anchor = anchorEntry.runtimeFingerprint.files[0];
      await writeFile(join(f.modules, anchorEntry.package, anchor.file), "unknown runtime anchor");
    } else if (changed === "runtime bytes") {
      const target = entry.files.find((file: any) => file.file.endsWith(".js"));
      changedFile = join(f.modules, entry.package, target.file);
      await writeFile(changedFile, "unknown native bytes");
    } else if (changed === "missing fingerprint") {
      delete entry.runtimeFingerprint;
    } else {
      anchorEntry.runtimeFingerprint.files = [];
    }
    await writeFile(join(f.profile, "manifest.json"), JSON.stringify(f.manifest));
    expect(() => execFileSync(process.execPath, [f.command, "--modules", f.modules, "--runtime-only", "--backup", f.backup], { stdio: "pipe" })).toThrow();
    await expect(stat(f.backup)).rejects.toMatchObject({ code: "ENOENT" });
    for (const original of f.variants)
      for (const file of original.files.filter((file: any) => file.file.endsWith(".js"))) {
        const target = join(f.modules, original.package, file.file);
        if (target !== changedFile) expect(hash(await readFile(target))).toBe(file.before);
      }
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

it("never combines individually matching packages from different runtime profiles", async () => {
  const f = await fingerprintRuntime();
  try {
    const other = join(f.checkout, "compat/other");
    await cp(f.profile, other, { recursive: true });
    const second = JSON.parse(JSON.stringify(f.manifest));
    const firstChanged = f.manifest.filter((entry: any) => entry.files.some((file: any) => file.file.endsWith(".js"))).at(-1);
    const otherChanged = second.find((entry: any) => entry.files.some((file: any) => file.file.endsWith(".js")));
    for (const entry of [firstChanged, otherChanged]) {
      const file = entry.files.find((file: any) => file.file.endsWith(".js"));
      file.before = hash(Buffer.from("other reviewed profile preimage"));
      file.after = hash(Buffer.from("other reviewed profile final bytes"));
    }
    await writeFile(join(f.profile, "manifest.json"), JSON.stringify(f.manifest));
    await writeFile(join(other, "manifest.json"), JSON.stringify(second));
    expect(() => execFileSync(process.execPath, [f.command, "--modules", f.modules, "--runtime-only", "--backup", f.backup], { stdio: "pipe" })).toThrow();
    await expectOriginalBytes(f);
    await expect(stat(f.backup)).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});
it("rejects an unknown second runtime before changing the first", async () => {
  const f = await originalRuntime();
  try {
    const second = f.variants[1];
    await writeFile(
      join(f.modules, second.package, second.files.find((file: any) => file.file.endsWith(".js")).file),
      "unknown release",
    );
    expect(() =>
      execFileSync(
        process.execPath,
        [
          script,
          "--modules",
          f.modules,
          "--runtime-only",
          "--backup",
          join(f.directory, "backup"),
        ],
        { stdio: "pipe" },
      ),
    ).toThrow();
    const first = f.variants[0],
      file = first.files[0];
    expect(
      hash(await readFile(join(f.modules, first.package, file.file))),
    ).toBe(file.before);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});
