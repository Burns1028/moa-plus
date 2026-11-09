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
export declare function bindWorkerMemoryPolicy(ctx: Context, agent: Agent, paths: Pick<ProjectPaths, "notes" | "archived">, previous?: WorkerMemoryPolicyBinding): WorkerMemoryPolicyBinding;
