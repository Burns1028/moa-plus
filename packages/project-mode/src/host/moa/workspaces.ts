import type { FileSystem } from "@deepseek-ai/dsh-fs";
import type {
  SandboxExecutionPolicy,
  SandboxProvider,
} from "@deepseek-ai/dsh-sandbox";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, dirname, join } from "node:path";

const exec = promisify(execFile);

export type MoAWorkspaceRecord =
  | {
      mode: "shared";
      ownerId: string;
      sourceDirectory: string;
      directory: string;
    }
  | {
      mode: "isolated";
      ownerId: string;
      sourceDirectory: string;
      directory: string;
      gitDirectory: string;
      branch: string;
      id: string;
    };

/** The caller resolves the acting session's policy at every operation. */
export interface MoAWorkspaceCapabilities {
  fs: FileSystem;
  policy: () => SandboxExecutionPolicy;
  sandbox: Pick<SandboxProvider, "confine">;
}

export class MoAWorkspaceManager {
  constructor(private readonly capabilities: MoAWorkspaceCapabilities) {}

  private async git(
    cwd: string,
    args: string[],
    signal?: AbortSignal,
    extraEnv: Record<string, string> = {},
  ) {
    const policy = this.capabilities.policy();
    if (policy.mode === "read-only")
      throw new Error("project-mode/workspace-read-only");
    const wrapped = await this.capabilities.sandbox.confine(
      ["git", ...args],
      { ...policy, mode: "workspace-write" },
      signal,
    );
    if (wrapped.enforcement !== "full")
      throw new Error("project-mode/workspace-sandbox-partial");
    const env = { ...process.env };
    for (const key of Object.keys(env))
      if (key.startsWith("GIT_")) delete env[key];
    Object.assign(env, {
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      ...extraEnv,
    });
    const { stdout } = await exec(wrapped.argv[0], wrapped.argv.slice(1), {
      cwd,
      env,
      signal,
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout.trim();
  }

  private async paths(sourceDirectory: string, signal?: AbortSignal) {
    const { fs } = this.capabilities;
    const source = await fs.resolve(sourceDirectory, { signal });
    const policyRoot = await fs.resolve(
      this.capabilities.policy().workspaceRoot,
      { signal },
    );
    if (!fs.contains(policyRoot, source))
      throw new Error("project-mode/workspace-outside-policy");
    const directory = fs.processPath(source);
    const info = await fs.stat(source, signal);
    if (!info || info.type !== "directory")
      throw new Error("project-mode/workspace-not-directory");
    return { source, directory, policyRoot };
  }

  async prepare(input: {
    ownerId: string;
    sourceDirectory: string;
    mode: "shared" | "isolated";
    signal: AbortSignal;
  }): Promise<MoAWorkspaceRecord> {
    const { fs } = this.capabilities;
    const { source, directory, policyRoot } = await this.paths(
      input.sourceDirectory,
      input.signal,
    );
    if (input.mode === "shared")
      return {
        mode: "shared",
        ownerId: input.ownerId,
        sourceDirectory: directory,
        directory,
      };
    let top: string, gitDirectory: string;
    try {
      top = await this.git(
        directory,
        ["rev-parse", "--show-toplevel"],
        input.signal,
      );
      gitDirectory = await this.git(
        directory,
        ["rev-parse", "--absolute-git-dir"],
        input.signal,
      );
      await this.git(
        directory,
        ["rev-parse", "--verify", "HEAD"],
        input.signal,
      );
    } catch (error) {
      throw new Error(
        "project-mode/isolated-requires-git-repository-with-commit",
        { cause: error },
      );
    }
    const topTarget = await fs.resolve(top, { signal: input.signal });
    const gitTarget = await fs.resolve(gitDirectory, { signal: input.signal });
    if (
      fs.processPath(topTarget) !== fs.processPath(source) ||
      !fs.contains(policyRoot, gitTarget) ||
      !fs.contains(source, gitTarget)
    )
      throw new Error("project-mode/isolated-requires-contained-git-root");
    gitDirectory = fs.processPath(gitTarget);
    const id = randomUUID();
    const branch = `moa/${id}`;
    const target = join(gitDirectory, "moa-workspaces", id);
    const index = join(gitDirectory, `moa-index-${id}`);
    const env = { GIT_INDEX_FILE: index };
    try {
      await this.git(directory, ["read-tree", "HEAD"], input.signal, env);
      await this.git(directory, ["add", "-A", "--", "."], input.signal, env);
      const tree = await this.git(directory, ["write-tree"], input.signal, env);
      const head = await this.git(
        directory,
        ["rev-parse", "HEAD"],
        input.signal,
      );
      const commit = await this.git(
        directory,
        [
          "-c",
          "user.name=MoA Workspace",
          "-c",
          "user.email=moa@localhost",
          "commit-tree",
          tree,
          "-p",
          head,
          "-m",
          "MoA workspace snapshot",
        ],
        input.signal,
        env,
      );
      await this.git(
        directory,
        ["worktree", "add", "-b", branch, target, commit],
        input.signal,
      );
      try {
        const marker = await fs.resolve(join(gitDirectory, "moa-owners", id), {
          signal: input.signal,
        });
        if (!fs.contains(gitTarget, marker))
          throw new Error("project-mode/path-escape");
        await fs.writeText(
          marker,
          JSON.stringify({ ownerId: input.ownerId, directory: target, branch }),
          { kind: "createIfAbsent" },
          input.signal,
          this.capabilities.policy(),
        );
      } catch (error) {
        await this.git(directory, ["worktree", "remove", "--force", target]);
        await this.git(directory, ["branch", "-D", branch]);
        throw error;
      }
    } finally {
      // The index is an owned temporary file; remove it through the same confinement.
      await this.runRemove(directory, index);
    }
    return {
      mode: "isolated",
      ownerId: input.ownerId,
      sourceDirectory: directory,
      directory: target,
      gitDirectory,
      branch,
      id,
    };
  }

  private async runRemove(cwd: string, path: string) {
    const policy = this.capabilities.policy();
    if (policy.mode === "read-only")
      throw new Error("project-mode/workspace-read-only");
    const wrapped = await this.capabilities.sandbox.confine(
      ["rm", "-f", "--", path],
      { ...policy, mode: "workspace-write" },
    );
    if (wrapped.enforcement !== "full")
      throw new Error("project-mode/workspace-sandbox-partial");
    await exec(wrapped.argv[0], wrapped.argv.slice(1), { cwd });
  }

  restore(record: MoAWorkspaceRecord): MoAWorkspaceRecord {
    if (record.mode === "shared") {
      if (record.directory !== record.sourceDirectory)
        throw new Error("project-mode/invalid-workspace-record");
    } else if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        record.id,
      ) ||
      record.branch !== `moa/${record.id}` ||
      record.directory !==
        join(record.gitDirectory, "moa-workspaces", record.id) ||
      basename(dirname(record.directory)) !== "moa-workspaces"
    ) {
      throw new Error("project-mode/invalid-workspace-record");
    }
    return record;
  }

  async destroy(
    record: MoAWorkspaceRecord,
    signal: AbortSignal,
  ): Promise<void> {
    this.restore(record);
    if (record.mode === "shared") return;
    const { source, directory, policyRoot } = await this.paths(
      record.sourceDirectory,
      signal,
    );
    const { fs } = this.capabilities;
    const gitDirectory = await this.git(
      directory,
      ["rev-parse", "--absolute-git-dir"],
      signal,
    );
    const gitTarget = await fs.resolve(gitDirectory, { signal });
    if (
      fs.processPath(gitTarget) !== record.gitDirectory ||
      !fs.contains(source, gitTarget) ||
      !fs.contains(policyRoot, gitTarget)
    )
      throw new Error("project-mode/invalid-workspace-record");
    const marker = await fs.resolve(
      join(record.gitDirectory, "moa-owners", record.id),
      { signal },
    );
    if (!fs.contains(gitTarget, marker))
      throw new Error("project-mode/path-escape");
    const expectedMarker = JSON.stringify({
      ownerId: record.ownerId,
      directory: record.directory,
      branch: record.branch,
    });
    if (
      !(await fs.stat(marker, signal)) ||
      (await fs.readText(marker, signal)) !== expectedMarker
    )
      throw new Error("project-mode/workspace-not-owned");
    const listing = await this.git(
      directory,
      ["worktree", "list", "--porcelain"],
      signal,
    );
    if (
      !listing
        .split("\n\n")
        .some(
          (entry) =>
            entry.split("\n").includes(`worktree ${record.directory}`) &&
            entry.split("\n").includes(`branch refs/heads/${record.branch}`),
        )
    )
      throw new Error("project-mode/workspace-not-owned");
    await this.git(
      directory,
      ["worktree", "remove", "--force", record.directory],
      signal,
    );
    await this.git(directory, ["branch", "-D", record.branch], signal);
    await this.runRemove(directory, fs.processPath(marker));
  }
}
