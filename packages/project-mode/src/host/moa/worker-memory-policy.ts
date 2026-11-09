import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { ProjectPaths } from "../../shared/index.ts";
import type { FileSystem } from "@deepseek-ai/dsh-fs";
import type { ShellExecutor } from "@deepseek-ai/dsh-shell";
import type { SandboxPolicyService } from "@deepseek-ai/dsh-sandbox-policy";

export interface WorkerMemoryPolicyBinding {
  filesystem: FileSystem;
  shell: ShellExecutor | undefined;
  policy: SandboxPolicyService;
  notes: string;
  archived: string;
  dispose: () => void;
}

/** Bind the native session policy; keep it until this activation's work joins. */
export function bindWorkerMemoryPolicy(
  ctx: Context,
  agent: Agent,
  paths: Pick<ProjectPaths, "notes" | "archived">,
  previous?: WorkerMemoryPolicyBinding,
): WorkerMemoryPolicyBinding {
  const presets = ctx.get("agentPresets");
  // Cordis get() returns a fresh trace proxy; implementation records own the
  // stable identities needed for reconciliation and provider replacement.
  const filesystem: FileSystem | undefined =
    presets?.serviceFor(agent, "fs") ?? agent.ctx.reflect._getImpl("fs")?.value;
  const shell: ShellExecutor | undefined =
    presets?.serviceFor(agent, "shell") ??
    agent.ctx.reflect._getImpl("shell")?.value;
  const policy: SandboxPolicyService | undefined =
    presets?.serviceFor(agent, "sandboxPolicy") ??
    agent.ctx.reflect._getImpl("sandboxPolicy")?.value;
  if (
    !filesystem?.supportsReadOnlyPaths ||
    (shell && !shell.supportsReadOnlyPaths) ||
    typeof policy?.restrictReadOnly !== "function"
  )
    throw new Error(
      "project-mode/native-readonly-path-incompatible: Workers require the matching native sandboxed filesystem, Bash executor, and session policy to protect Coordinator records",
    );
  if (
    previous?.filesystem === filesystem &&
    previous.shell === shell &&
    previous.policy === policy &&
    previous.notes === paths.notes &&
    previous.archived === paths.archived
  )
    return previous;
  const binding = {
    filesystem,
    shell,
    policy,
    notes: paths.notes,
    archived: paths.archived,
    dispose: policy.restrictReadOnly(agent.id, [paths.notes, paths.archived]),
  };
  // New policy is present before the replaced activation/service contribution leaves.
  previous?.dispose();
  return binding;
}
