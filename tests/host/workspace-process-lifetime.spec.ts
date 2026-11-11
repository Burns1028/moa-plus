import { expect, it, vi } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import LocalFileSystem from "@deepseek-ai/dsh-fs-local";
import LocalSubprocessRuntime from "@deepseek-ai/dsh-subprocess-local";
import type { SandboxExecutionPolicy, SandboxProvider } from "@deepseek-ai/dsh-sandbox";
import type { SubprocessHandle, SubprocessRuntime } from "@deepseek-ai/dsh-subprocess";
import { tmpdir } from "node:os";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { MoAWorkspaceManager } from "../../packages/project-mode/src/host/moa/workspaces.ts";

function handle(waitForExit: SubprocessHandle["waitForExit"] = async () => true): SubprocessHandle {
  return {
    stdin: undefined, stdout: undefined, stderr: undefined, control: undefined,
    collected: {
      stdout: { readFrom: () => ({ text: "complete output", nextOffset: 15, lossy: false }) },
      stderr: { readFrom: () => ({ text: "", nextOffset: 0, lossy: false }) },
    },
    done: Promise.resolve({ exitCode: 0, signal: null }),
    terminate: vi.fn(), waitForExit,
  };
}

function manager(cleanup: () => Promise<void>, options: {
  subprocess?: Pick<SubprocessRuntime, "spawn"> | null;
  confine?: SandboxProvider["confine"];
  policy?: SandboxExecutionPolicy;
  bindProcessLifetime?: (lifetime: Promise<void>) => void;
} = {}) {
  return new MoAWorkspaceManager({
    fs: new LocalFileSystem(new Context(), { cwd: tmpdir(), diffBasisMaxBytes: 1048576 }),
    policy: () => options.policy ?? ({ mode: "workspace-write", workspaceRoot: tmpdir() }),
    sandbox: {
      confine: options.confine ?? (async argv => ({
        argv: [...argv], enforcement: "partial", denialSignatures: [], runnerFailureRules: [], cleanup,
        bindProcessLifetime: options.bindProcessLifetime,
      })),
    },
    ...(options.subprocess === null ? {} : { subprocess: {
      resolveExecutable: async command => command,
      ...(options.subprocess ?? { spawn: () => handle() }),
    } }),
  });
}

function run(subject: MoAWorkspaceManager, signal?: AbortSignal) {
  return (subject as unknown as {
    runCommand(cwd: string, argv: string[], signal?: AbortSignal): Promise<void>;
  }).runCommand(tmpdir(), ["native-workspace-fixture"], signal);
}

it("keeps workspace protection until the native process range exits after its direct outcome", async () => {
  const range = Promise.withResolvers<boolean>();
  const cleanup = vi.fn(async () => {});
  const waitForExit = vi.fn(() => range.promise);
  let lifetime: Promise<void> | undefined;
  const confine: SandboxProvider["confine"] = async (argv, _policy, _signal, options) => {
    expect(options).toEqual({ processLifetime: "managed" });
    return { argv: [...argv], enforcement: "partial", denialSignatures: [], runnerFailureRules: [], cleanup,
      bindProcessLifetime: joined => { lifetime = joined; },
    };
  };
  const spawn = vi.fn<SubprocessRuntime["spawn"]>(spec => {
    expect(spec.requireManagedRange).toBe(true);
    expect(lifetime).toBeInstanceOf(Promise);
    return handle(waitForExit);
  });
  const operation = run(manager(cleanup, { confine, subprocess: { spawn } }));
  await expect.poll(() => waitForExit.mock.calls.length).toBe(1);
  expect(cleanup).not.toHaveBeenCalled();
  expect(waitForExit.mock.calls[0]).toEqual([]);
  range.resolve(true);
  await operation;
  expect(cleanup).toHaveBeenCalledOnce();
  await expect(lifetime).resolves.toBeUndefined();
});

it("joins a late confinement acquisition after cancellation without spawning or leaving its lease", async () => {
  const prepared = Promise.withResolvers<void>();
  const cleanup = vi.fn(async () => {});
  const spawn = vi.fn(() => handle());
  const controller = new AbortController();
  const confine: SandboxProvider["confine"] = async argv => {
    await prepared.promise;
    return { argv: [...argv], enforcement: "partial", denialSignatures: [], runnerFailureRules: [], cleanup };
  };
  const operation = run(manager(cleanup, { confine, subprocess: { spawn } }), controller.signal);
  controller.abort(new Error("new human direction"));
  prepared.resolve();
  await expect(operation).rejects.toThrow("new human direction");
  expect(spawn).not.toHaveBeenCalled();
  expect(cleanup).toHaveBeenCalledOnce();
});

it("releases an untransferred lease when native spawn throws", async () => {
  const cleanup = vi.fn(async () => {});
  const failure = new Error("native spawn failed");
  await expect(run(manager(cleanup, { subprocess: { spawn: () => { throw failure; } } }))).rejects.toBe(failure);
  expect(cleanup).toHaveBeenCalledOnce();
});

it.each(["false", "rejected"])("does not release protection when managed exit is %s", async result => {
  const cleanup = vi.fn(async () => {});
  const failure = new Error("range observation failed");
  const running = handle(async () => { if (result === "rejected") throw failure; return false; });
  let lifetime: Promise<void> | undefined;
  const operation = run(manager(cleanup, { subprocess: { spawn: () => running }, bindProcessLifetime: joined => { lifetime = joined; } }));
  if (result === "rejected") await expect(operation).rejects.toBe(failure);
  else await expect(operation).rejects.toThrow("workspace-process-exit-not-confirmed");
  expect(cleanup).not.toHaveBeenCalled();
  await expect(lifetime).rejects.toThrow(result === "rejected" ? "range observation failed" : "workspace-process-exit-not-confirmed");
});

it("reports both native spawn and cleanup failures", async () => {
  const spawnFailure = new Error("native spawn failed");
  const cleanupFailure = new Error("native protection cleanup failed");
  const cleanup = vi.fn(async () => { throw cleanupFailure; });
  const operation = run(manager(cleanup, { subprocess: { spawn: () => { throw spawnFailure; } } }));
  const error = await operation.catch(error => error);
  expect(error.message).toBe("project-mode/workspace-sandbox-cleanup-failed");
  expect(error.cause).toBeInstanceOf(AggregateError);
  expect(error.cause.errors).toEqual([spawnFailure, cleanupFailure]);
});

it("refuses a leased command without a managed native subprocess before execution", async () => {
  const cleanup = vi.fn(async () => {});
  await expect(run(manager(cleanup, { subprocess: null }))).rejects.toThrow("workspace-managed-subprocess-unavailable");
  expect(cleanup).toHaveBeenCalledOnce();
});

it("does not bypass protected paths or narrow a full-access policy", async () => {
  const cleanup = vi.fn(async () => {});
  const policy: SandboxExecutionPolicy = { mode: "danger-full-access", workspaceRoot: tmpdir(), readOnlyPaths: [tmpdir() + "/notes.md"] };
  const confine = vi.fn<SandboxProvider["confine"]>(async (argv, actual) => {
    expect(actual).toEqual(policy);
    return { argv: [...argv], enforcement: "partial", denialSignatures: [], runnerFailureRules: [], cleanup };
  });
  await run(manager(cleanup, { policy, confine }));
  expect(confine).toHaveBeenCalledOnce();
  expect(cleanup).toHaveBeenCalledOnce();
});

it("unsets ambient Git routing through the real native subprocess environment merge", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moa-native-git-env-"));
  const ctx = new Context();
  const previous = process.env.GIT_DIR;
  process.env.GIT_DIR = "moa-invalid-ambient-git-directory";
  try {
    await ctx.plugin(LocalSubprocessRuntime);
    const subject = new MoAWorkspaceManager({
      fs: new LocalFileSystem(ctx, { cwd: directory, diffBasisMaxBytes: 1048576 }),
      policy: () => ({ mode: "danger-full-access", workspaceRoot: directory }),
      sandbox: { confine: async () => { throw new Error("unexpected sandbox call"); } },
      subprocess: ctx.subprocess,
    });
    const target = join(directory, "environment-proof.txt");
    await (subject as unknown as { runCommand(cwd: string, argv: string[]): Promise<void> })
      .runCommand(directory, [process.execPath, "-e",
        "require('node:fs').writeFileSync(process.argv[1], Object.hasOwn(process.env, 'GIT_DIR') ? 'inherited' : 'unset')", target]);
    expect(await readFile(target, "utf8")).toBe("unset");
  } finally {
    if (previous === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = previous;
    await ctx.fiber.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
