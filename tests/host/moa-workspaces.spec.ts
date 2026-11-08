import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Context } from "@deepseek-ai/cordis";
import { LocalFileSystem } from "@deepseek-ai/dsh-fs-local";
import { MoAWorkspaceManager } from "../../packages/project-mode/src/host/moa/workspaces";

describe.skipIf(process.platform !== "darwin")("MoA workspaces", () => {
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
      await writeFile(join(root, ".gitignore"), "ignored\n");
      git("add", ".");
      git("commit", "-m", "initial");
      await writeFile(join(root, "tracked"), "dirty");
      await writeFile(join(root, "staged"), "staged");
      git("add", "staged");
      await writeFile(join(root, "untracked"), "untracked");
      await writeFile(join(root, "ignored"), "ignored");
      const fs = new LocalFileSystem(new Context(), {
        cwd: root,
        diffBasisMaxBytes: 1048576,
      });
      const policy = { mode: "workspace-write" as const, workspaceRoot: root };
      const sandbox = {
        confine: async (argv: readonly string[]) => ({
          argv: [
            "/usr/bin/sandbox-exec",
            "-p",
            `(version 1)(allow default)(deny file-write*)(allow file-write* (literal "/dev/null"))(allow file-write* (subpath "${root}"))`,
            ...argv,
          ],
          enforcement: "full" as const,
          denialSignatures: [],
          runnerFailureRules: [],
        }),
      };
      const manager = new MoAWorkspaceManager({
        fs,
        policy: () => policy,
        sandbox,
      });
      const signal = new AbortController().signal;
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
      await manager.destroy(a, signal);
      await expect(readFile(join(a.directory, "tracked"))).rejects.toThrow();
      expect(await readFile(join(b.directory, "tracked"), "utf8")).toBe("b");
      await manager.destroy(b, signal);
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
