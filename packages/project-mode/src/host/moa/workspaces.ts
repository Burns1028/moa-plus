import type { FileSystem } from "@deepseek-ai/dsh-fs";
import type {
  SandboxExecutionPolicy,
  SandboxProvider,
} from "@deepseek-ai/dsh-sandbox";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isAbsolute, join, relative } from "node:path";

const exec = promisify(execFile);
// The Host is a Node process (Desktop uses Electron's inherited Node mode).
// Keep paths in argv and run these fixed operations through the native sandbox.
const makeDirectory =
  "require('node:fs/promises').mkdir(process.argv[1], { recursive: true }).catch(error => { console.error(error); process.exitCode = 1; });";
const removeFile =
  "require('node:fs/promises').rm(process.argv[1], { force: true }).catch(error => { console.error(error); process.exitCode = 1; });";

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
      worktreeRoot: string;
      branch: string;
      id: string;
    };

/** Persist the record and retry destroy when preparation cleanup itself fails. */
export class MoAWorkspacePrepareError extends Error {
  constructor(
    public readonly record: MoAWorkspaceRecord,
    public readonly preparationError: unknown,
    public readonly cleanupError: unknown,
  ) {
    super("project-mode/workspace-prepare-cleanup-failed", {
      cause: preparationError,
    });
  }
}

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
    const wrapped =
      policy.mode === "danger-full-access"
        ? { argv: ["git", ...args] }
        : await this.capabilities.sandbox.confine(
            ["git", ...args],
            { ...policy, mode: "workspace-write" },
            signal,
          );
    if ("enforcement" in wrapped && wrapped.enforcement !== "full")
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
    if (
      this.capabilities.policy().mode !== "danger-full-access" &&
      !fs.contains(policyRoot, source)
    )
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
    let top: string, gitDirectory: string, commonDirectory: string;
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
      commonDirectory = await this.git(
        directory,
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
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
    const perWorktreeTarget = await fs.resolve(gitDirectory, {
      signal: input.signal,
    });
    const gitTarget = await fs.resolve(commonDirectory, {
      signal: input.signal,
    });
    if (
      !fs.contains(topTarget, source) ||
      (this.capabilities.policy().mode !== "danger-full-access" &&
        (!fs.contains(policyRoot, topTarget) ||
          !fs.contains(policyRoot, perWorktreeTarget) ||
          !fs.contains(policyRoot, gitTarget)))
    )
      throw new Error("project-mode/isolated-requires-contained-git-root");
    const sourceRoot = fs.processPath(topTarget);
    gitDirectory = fs.processPath(gitTarget);
    const subdirectory = relative(sourceRoot, directory);
    const id = randomUUID();
    const branch = `moa/${id}`;
    const target = join(gitDirectory, "moa-workspaces", id);
    const index = join(gitDirectory, `moa-index-${id}`);
    const env = { GIT_INDEX_FILE: index };
    const record: MoAWorkspaceRecord = {
      mode: "isolated",
      ownerId: input.ownerId,
      sourceDirectory: directory,
      directory: join(target, subdirectory),
      worktreeRoot: target,
      gitDirectory,
      branch,
      id,
    };
    const marker = await fs.resolve(join(gitDirectory, "moa-owners", id), {
      signal: input.signal,
    });
    if (!fs.contains(gitTarget, marker))
      throw new Error("project-mode/path-escape");
    try {
      await fs.writeText(
        marker,
        JSON.stringify(record),
        { kind: "createIfAbsent" },
        input.signal,
        this.capabilities.policy(),
      );
      await this.git(sourceRoot, ["read-tree", "HEAD"], input.signal, env);
      await this.git(sourceRoot, ["add", "-A", "--", "."], input.signal, env);
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
      const worktreeTarget = await fs.resolve(target, { signal: input.signal });
      const cwdTarget = await fs.resolve(record.directory, {
        signal: input.signal,
      });
      if (!fs.contains(worktreeTarget, cwdTarget))
        throw new Error("project-mode/path-escape");
      if (!(await fs.stat(cwdTarget, input.signal)))
        await this.runCommand(
          directory,
          [process.execPath, "-e", makeDirectory, "--", fs.processPath(cwdTarget)],
          input.signal,
        );
    } catch (error) {
      try {
        await this.runRemove(directory, index);
        await this.destroy(record, new AbortController().signal);
      } catch (cleanupError) {
        throw new MoAWorkspacePrepareError(record, error, cleanupError);
      }
      throw error;
    }
    try {
      await this.runRemove(directory, index);
    } catch (error) {
      throw new MoAWorkspacePrepareError(record, error, error);
    }
    return record;
  }

  /** Find preparations whose caller did not receive their record before a crash. */
  async discoverOwned(
    sourceDirectory: string,
    ownerId: string,
    signal: AbortSignal,
  ): Promise<MoAWorkspaceRecord[]> {
    const { fs } = this.capabilities;
    const { directory, policyRoot } = await this.paths(sourceDirectory, signal);
    const common = await this.git(
      directory,
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      signal,
    );
    const gitTarget = await fs.resolve(common, { signal });
    if (
      this.capabilities.policy().mode !== "danger-full-access" &&
      !fs.contains(policyRoot, gitTarget)
    )
      throw new Error("project-mode/isolated-requires-contained-git-root");
    const gitDirectory = fs.processPath(gitTarget);
    const owners = await fs.resolve(join(gitDirectory, "moa-owners"), {
      signal,
    });
    if (!fs.contains(gitTarget, owners))
      throw new Error("project-mode/path-escape");
    if (!(await fs.stat(owners, signal))) return [];
    const records: MoAWorkspaceRecord[] = [];
    for (const entry of await fs.listDir(owners, signal)) {
      if (entry.type !== "file" || !fs.contains(owners, entry.target)) continue;
      const content = await fs.readText(entry.target, signal);
      let record: MoAWorkspaceRecord;
      try {
        record = JSON.parse(content);
        this.restore(record);
      } catch {
        continue;
      }
      if (
        record.mode === "isolated" &&
        record.id === entry.name &&
        record.gitDirectory === gitDirectory &&
        record.ownerId === ownerId
      )
        records.push(record);
    }
    return records;
  }

  private async runCommand(cwd: string, argv: string[], signal?: AbortSignal) {
    const policy = this.capabilities.policy();
    if (policy.mode === "read-only")
      throw new Error("project-mode/workspace-read-only");
    const wrapped =
      policy.mode === "danger-full-access"
        ? { argv }
        : await this.capabilities.sandbox.confine(
            argv,
            { ...policy, mode: "workspace-write" },
            signal,
          );
    if ("enforcement" in wrapped && wrapped.enforcement !== "full")
      throw new Error("project-mode/workspace-sandbox-partial");
    await exec(wrapped.argv[0], wrapped.argv.slice(1), { cwd, signal });
  }

  private async runRemove(cwd: string, path: string) {
    await this.runCommand(cwd, [process.execPath, "-e", removeFile, "--", path]);
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
      record.worktreeRoot !==
        join(record.gitDirectory, "moa-workspaces", record.id) ||
      isAbsolute(relative(record.worktreeRoot, record.directory)) ||
      relative(record.worktreeRoot, record.directory)
        .split(/[\\/]/)
        .includes("..")
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
    const { fs } = this.capabilities;
    const { directory, policyRoot } = await this.paths(
      record.gitDirectory,
      signal,
    );
    const gitTarget = await fs.resolve(directory, { signal });
    if (
      directory !== record.gitDirectory ||
      (this.capabilities.policy().mode !== "danger-full-access" &&
        !fs.contains(policyRoot, gitTarget))
    )
      throw new Error("project-mode/invalid-workspace-record");
    const marker = await fs.resolve(
      join(record.gitDirectory, "moa-owners", record.id),
      { signal },
    );
    if (!fs.contains(gitTarget, marker))
      throw new Error("project-mode/path-escape");
    const expectedMarker = JSON.stringify(record);
    const legacyMarker = JSON.stringify({
      ownerId: record.ownerId,
      directory: record.worktreeRoot,
      branch: record.branch,
    });
    const markerInfo = await fs.lstat(
      join(record.gitDirectory, "moa-owners", record.id),
      undefined,
      signal,
    );
    if (markerInfo && markerInfo.type !== "file")
      throw new Error("project-mode/workspace-not-owned");
    const markerExists = !!markerInfo;
    if (markerExists) {
      const markerContent = await fs.readText(marker, signal);
      if (markerContent !== expectedMarker && markerContent !== legacyMarker)
        throw new Error("project-mode/workspace-not-owned");
    }
    const listing = await this.git(
      directory,
      ["worktree", "list", "--porcelain"],
      signal,
    );
    const worktree = await fs.resolve(record.worktreeRoot, { signal });
    let entry: string | undefined;
    for (const item of listing.split("\n\n")) {
      const path = item.split("\n").find((line) => line.startsWith("worktree "));
      if (path === undefined) continue;
      const listed = await fs.resolve(path.slice("worktree ".length), { signal });
      if (listed.targetKey === worktree.targetKey) {
        entry = item;
        break;
      }
    }
    if (
      entry &&
      !entry.split("\n").includes(`branch refs/heads/${record.branch}`)
    )
      throw new Error("project-mode/workspace-not-owned");
    const branch = await this.git(
      directory,
      ["branch", "--list", record.branch],
      signal,
    );
    if (!markerExists) {
      if (
        entry ||
        branch ||
        (await fs.lstat(record.worktreeRoot, undefined, signal)) ||
        (await fs.lstat(record.directory, undefined, signal)) ||
        (await fs.lstat(
          join(record.gitDirectory, `moa-index-${record.id}`),
          undefined,
          signal,
        ))
      )
        throw new Error("project-mode/workspace-not-owned");
      return;
    }
    if (!entry && (await fs.lstat(record.worktreeRoot, undefined, signal)))
      throw new Error("project-mode/workspace-not-owned");
    if (entry)
      await this.git(
        directory,
        ["worktree", "remove", "--force", record.worktreeRoot],
        signal,
      );
    if (branch)
      await this.git(directory, ["branch", "-D", record.branch], signal);
    await this.runRemove(
      directory,
      join(record.gitDirectory, `moa-index-${record.id}`),
    );
    await this.runRemove(directory, fs.processPath(marker));
  }
}
