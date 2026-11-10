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
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { createHash } from "node:crypto";

const root = resolve(".");
const script = join(root, "scripts/apply-native-compat.mjs");
const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
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
it("reports unsupported runtime versions before changing any native package", async () => {
  const f = await originalRuntime();
  try {
    await writeFile(join(f.modules, "@deepseek-ai/dsh-agent/package.json"), JSON.stringify({ version: "0.9.0" }));
    let failure: any;
    try {
      execFileSync(process.execPath, [script, "--modules", f.modules, "--runtime-only", "--backup", join(f.directory, "backup")], { stdio: "pipe" });
    } catch (error) { failure = error; }
    expect(failure).toBeDefined();
    expect(String(failure.stderr)).toContain("Unsupported DSH runtime 0.9.0");
    const first = f.variants[0], file = first.files[0];
    expect(hash(await readFile(join(f.modules, first.package, file.file)))).toBe(file.before);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
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
