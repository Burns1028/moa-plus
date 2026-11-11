import { describe, expect, it } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rm,
  realpath,
  stat,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Context } from "@deepseek-ai/cordis";
import { LocalFileSystem } from "@deepseek-ai/dsh-fs-local";
import {
  MoAWorkspaceManager,
  MoAWorkspacePrepareError,
} from "../../packages/project-mode/src/host/moa/workspaces";

describe.each([
  "danger-full-access",
  ...(process.platform === "darwin" ? ["workspace-write"] : []),
] as const)("MoA workspaces (%s)", (mode) => {
  it("snapshots current content, isolates writes, retains zombies, and removes only owned worktrees", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "moa-workspaces-")),
    );
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: root, stdio: "pipe" });
    try {
      git("init");
      git("config", "user.name", "Test");
      git("config", "user.email", "test@example.org");
      await writeFile(join(root, "tracked"), "initial");
      await writeFile(join(root, ".gitignore"), "ignored\nignored-cwd/\n");
      git("add", ".");
      git("commit", "-m", "initial");
      await writeFile(join(root, "tracked"), "dirty");
      await writeFile(join(root, "staged"), "staged");
      git("add", "staged");
      await writeFile(join(root, "untracked"), "untracked");
      await writeFile(join(root, "binary"), Buffer.from([0, 255, 1, 2]));
      await writeFile(join(root, "ignored"), "ignored");
      const fs = new LocalFileSystem(new Context(), {
        cwd: root,
        diffBasisMaxBytes: 1048576,
      });
      const policy = {
        mode,
        workspaceRoot:
          mode === "danger-full-access"
            ? tmpdir() + "/not-the-policy-root"
            : root,
      };
      let failPreparation = false;
      let failCleanup = false;
      let failIndexRemoval = false;
      const sandbox = {
        confine: async (argv: readonly string[]) => {
          if (
            failIndexRemoval &&
            argv[0] === process.execPath &&
            argv[2]?.includes(".rm(") &&
            argv.some((arg) => arg.includes("moa-index-"))
          ) {
            failIndexRemoval = false;
            throw new Error("injected index failure");
          }
          if (
            failPreparation &&
            argv.includes("add") &&
            argv.includes("worktree")
          ) {
            failPreparation = false;
            throw new Error("injected prepare failure");
          }
          if (
            failCleanup &&
            argv.includes("list") &&
            argv.includes("worktree")
          ) {
            failCleanup = false;
            throw new Error("injected cleanup failure");
          }
          return {
            argv: [
              "/usr/bin/sandbox-exec",
              "-p",
              `(version 1)(allow default)(deny file-write*)(allow file-write* (literal "/dev/null"))(allow file-write* (subpath "${root}"))`,
              ...argv,
            ],
            enforcement: "full" as const,
            denialSignatures: [],
            runnerFailureRules: [],
          };
        },
      };
      const manager = new MoAWorkspaceManager({
        fs,
        policy: () => policy,
        sandbox,
      });
      const signal = new AbortController().signal;
      const originalIndex = await readFile(join(root, ".git", "index"));
      const a = await manager.prepare({
        ownerId: "a",
        sourceDirectory: root,
        mode: "isolated",
        signal,
      });
      const b = await manager.prepare({
        ownerId: "b",
        sourceDirectory: root,
        mode: "isolated",
        signal,
      });
      expect(await manager.discoverOwned(root, "a", signal)).toEqual([a]);
      expect(await manager.discoverOwned(root, "b", signal)).toEqual([b]);
      expect(await manager.discoverOwned(root, "missing", signal)).toEqual([]);
      expect(await readFile(join(a.directory, "binary"))).toEqual(
        Buffer.from([0, 255, 1, 2]),
      );
      expect(await readFile(join(root, ".git", "index"))).toEqual(
        originalIndex,
      );
      expect(await readFile(join(a.directory, "tracked"), "utf8")).toBe(
        "dirty",
      );
      expect(await readFile(join(a.directory, "staged"), "utf8")).toBe(
        "staged",
      );
      expect(await readFile(join(a.directory, "untracked"), "utf8")).toBe(
        "untracked",
      );
      await expect(readFile(join(a.directory, "ignored"))).rejects.toThrow();
      await writeFile(join(a.directory, "tracked"), "a");
      await writeFile(join(b.directory, "tracked"), "b");
      expect(await readFile(join(root, "tracked"), "utf8")).toBe("dirty");
      expect(await readFile(join(b.directory, "tracked"), "utf8")).toBe("b");
      expect(manager.restore(JSON.parse(JSON.stringify(a)))).toEqual(a);
      expect(await readFile(join(a.directory, "tracked"), "utf8")).toBe("a");
      const shared = await manager.prepare({
        ownerId: "s",
        sourceDirectory: root,
        mode: "shared",
        signal,
      });
      await manager.destroy(shared, signal);
      await expect(
        manager.destroy({ ...a, directory: root }, signal),
      ).rejects.toThrow();
      await expect(
        manager.destroy({ ...a, ownerId: "someone-else" }, signal),
      ).rejects.toThrow("workspace-not-owned");
      if (a.mode !== "isolated") throw new Error("expected isolated");
      const markerPath = join(a.gitDirectory, "moa-owners", a.id);
      const markerContents = await readFile(markerPath);
      await unlink(markerPath);
      await expect(manager.destroy(a, signal)).rejects.toThrow(
        "workspace-not-owned",
      );
      expect(await readFile(join(a.directory, "tracked"), "utf8")).toBe("a");
      await writeFile(markerPath, markerContents);
      await manager.destroy(a, signal);
      await expect(stat(markerPath)).rejects.toThrow();
      await manager.destroy(a, signal);
      await mkdir(a.worktreeRoot, { recursive: true });
      await writeFile(join(a.worktreeRoot, "user-file"), "preserve");
      await expect(manager.destroy(a, signal)).rejects.toThrow(
        "workspace-not-owned",
      );
      expect(await readFile(join(a.worktreeRoot, "user-file"), "utf8")).toBe(
        "preserve",
      );
      await expect(readFile(join(a.directory, "tracked"))).rejects.toThrow();
      expect(await readFile(join(b.directory, "tracked"), "utf8")).toBe("b");
      await mkdir(join(b.directory, "nested"));
      await writeFile(join(b.directory, "nested", "child"), "from-parent");
      const child = await manager.prepare({
        ownerId: "child",
        sourceDirectory: join(b.directory, "nested"),
        mode: "isolated",
        signal,
      });
      expect(await readFile(join(child.directory, "child"), "utf8")).toBe(
        "from-parent",
      );
      await writeFile(join(child.directory, "child"), "child-write");
      expect(await readFile(join(b.directory, "nested", "child"), "utf8")).toBe(
        "from-parent",
      );
      await manager.destroy(child, signal);
      for (const name of ["empty-cwd", "ignored-cwd"]) {
        await mkdir(join(root, name));
        if (name === "ignored-cwd") {
          await writeFile(join(root, name, "ignored"), "ignored");
        }
        const emptyCwd = await manager.prepare({
          ownerId: name,
          sourceDirectory: join(root, name),
          mode: "isolated",
          signal,
        });
        expect((await stat(emptyCwd.directory)).isDirectory()).toBe(true);
        await manager.destroy(emptyCwd, signal);
      }
      const internals = manager as unknown as {
        git: (
          cwd: string,
          args: string[],
          signal?: AbortSignal,
          env?: Record<string, string>,
        ) => Promise<string>;
      };
      const gitMethod = internals.git.bind(manager);
      internals.git = async (cwd, args, gitSignal, env) => {
        if (args.includes("-D")) throw new Error("injected branch failure");
        return gitMethod(cwd, args, gitSignal, env);
      };
      await expect(manager.destroy(b, signal)).rejects.toThrow(
        "injected branch failure",
      );
      expect(await manager.discoverOwned(root, "b", signal)).toEqual([b]);
      internals.git = gitMethod;
      await manager.destroy(b, signal);
      if (mode === "workspace-write") {
        failIndexRemoval = true;
        let indexFailure: unknown;
        try {
          await manager.prepare({
            ownerId: "index-failed",
            sourceDirectory: root,
            mode: "isolated",
            signal,
          });
        } catch (error) {
          indexFailure = error;
        }
        expect(indexFailure).toBeInstanceOf(MoAWorkspacePrepareError);
        await manager.destroy(
          (indexFailure as MoAWorkspacePrepareError).record,
          signal,
        );
        failPreparation = true;
        failCleanup = true;
        failIndexRemoval = true;
        let failure: unknown;
        try {
          await manager.prepare({
            ownerId: "failed",
            sourceDirectory: root,
            mode: "isolated",
            signal,
          });
        } catch (error) {
          failure = error;
        }
        expect(failure).toBeInstanceOf(MoAWorkspacePrepareError);
        expect(
          (failure as MoAWorkspacePrepareError).preparationError,
        ).toHaveProperty("message", "injected prepare failure");
        failCleanup = false;
        await manager.destroy(
          (failure as MoAWorkspacePrepareError).record,
          signal,
        );
      }
      // A post-publication write error still cleans its owned marker in-process.
      const writeText = fs.writeText.bind(fs);
      let crash = true;
      let published: Parameters<typeof fs.writeText> | undefined;
      fs.writeText = async (...args) => {
        const result = await writeText(...args);
        if (crash && fs.processPath(args[0]).includes("moa-owners")) {
          crash = false;
          published = args;
          throw new Error("injected crash after marker");
        }
        return result;
      };
      await expect(
        manager.prepare({
          ownerId: "crash",
          sourceDirectory: root,
          mode: "isolated",
          signal,
        }),
      ).rejects.toThrow("injected crash after marker");
      fs.writeText = writeText;
      expect(await manager.discoverOwned(root, "crash", signal)).toEqual([]);
      // Recreate the durable marker-only state of a process exit before cleanup.
      await writeText(...published!);
      const recovered = await manager.discoverOwned(root, "crash", signal);
      expect(recovered).toHaveLength(1);
      await manager.destroy(recovered[0], signal);
      expect(await manager.discoverOwned(root, "crash", signal)).toEqual([]);
      const empty = await mkdtemp(join(root, "empty-"));
      execFileSync("git", ["init"], { cwd: empty, stdio: "pipe" });
      await expect(
        manager.prepare({
          ownerId: "empty",
          sourceDirectory: empty,
          mode: "isolated",
          signal,
        }),
      ).rejects.toThrow("isolated-requires-git-repository-with-commit");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

it("runs single-file cleanup with literal argv and retains native sandbox denials", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "moa cleanup spaces ")));
  const path = join(root, "index $literal 'quote'.tmp");
  const fs = new LocalFileSystem(new Context(), { cwd: root, diffBasisMaxBytes: 1048576 });
  const commands: readonly string[][] = [];
  let enforcement: "full" | "partial" = "full";
  let missingEnforcement = false, unknownEnforcement = false, deny = false;
  const manager = new MoAWorkspaceManager({ fs,
    policy: () => ({ mode: "workspace-write", workspaceRoot: root }),
    sandbox: { confine: async (argv) => {
      if (deny) throw new Error("native workspace operation denied");
      (commands as string[][]).push([...argv]);
      const wrapped = { argv: [...argv], enforcement, denialSignatures: [], runnerFailureRules: [] };
      if (missingEnforcement) Reflect.deleteProperty(wrapped, "enforcement");
      if (unknownEnforcement) Reflect.set(wrapped, "enforcement", "unrecognized");
      return wrapped;
    } },
  });
  const remove = (manager as unknown as { runRemove(cwd: string, path: string): Promise<void> }).runRemove.bind(manager);
  try {
    await writeFile(path, "owned index");
    await remove(root, path);
    expect(commands[0][0]).toBe(process.execPath);
    expect(commands[0].slice(3)).toEqual(["--", path]);
    expect(commands[0][2]).not.toContain(path);
    await expect(stat(path)).rejects.toThrow();
    await remove(root, path);
    enforcement = "partial";
    await writeFile(path, "native partial confinement");
    await remove(root, path);
    await expect(stat(path)).rejects.toThrow();
    await writeFile(path, "preserve after denied confinement");
    missingEnforcement = true;
    await expect(remove(root, path)).rejects.toThrow("workspace-sandbox-invalid-enforcement");
    missingEnforcement = false;
    unknownEnforcement = true;
    await expect(remove(root, path)).rejects.toThrow("workspace-sandbox-invalid-enforcement");
    unknownEnforcement = false;
    deny = true;
    await expect(remove(root, path)).rejects.toThrow("native workspace operation denied");
    expect(await readFile(path, "utf8")).toBe("preserve after denied confinement");
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("retains the owned recovery record when portable index cleanup fails", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "moa recovery spaces ")));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  let rejectCleanup = true;
  const manager = new MoAWorkspaceManager({
    fs: new LocalFileSystem(new Context(), { cwd: root, diffBasisMaxBytes: 1048576 }),
    policy: () => ({ mode: "workspace-write", workspaceRoot: root }),
    sandbox: { confine: async (argv) => {
      if (rejectCleanup && argv[0] === process.execPath && argv[2]?.includes(".rm(") && argv.at(-1)?.includes("moa-index-"))
        throw new Error("native index cleanup denied");
      return { argv: [...argv], enforcement: "full", denialSignatures: [], runnerFailureRules: [] };
    } },
  });
  const signal = new AbortController().signal;
  try {
    git("init"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.org");
    await writeFile(join(root, "source"), "preserve source"); git("add", "."); git("commit", "-m", "initial");
    let failure: unknown;
    try { await manager.prepare({ ownerId: "recover", sourceDirectory: root, mode: "isolated", signal }); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(MoAWorkspacePrepareError);
    expect((failure as MoAWorkspacePrepareError).cleanupError).toHaveProperty("message", "native index cleanup denied");
    const records = await manager.discoverOwned(root, "recover", signal);
    expect(records).toEqual([(failure as MoAWorkspacePrepareError).record]);
    rejectCleanup = false;
    await manager.destroy(records[0], signal);
    expect(await manager.discoverOwned(root, "recover", signal)).toEqual([]);
    expect(await readFile(join(root, "source"), "utf8")).toBe("preserve source");
  } finally { await rm(root, { recursive: true, force: true }); }
});
