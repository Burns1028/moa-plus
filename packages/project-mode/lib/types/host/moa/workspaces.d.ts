import type { FileSystem } from "@deepseek-ai/dsh-fs";
import type { SandboxExecutionPolicy, SandboxProvider } from "@deepseek-ai/dsh-sandbox";
import { type SubprocessRuntime } from "@deepseek-ai/dsh-subprocess";
export type MoAWorkspaceRecord = {
    mode: "shared";
    ownerId: string;
    sourceDirectory: string;
    directory: string;
} | {
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
export declare class MoAWorkspacePrepareError extends Error {
    readonly record: MoAWorkspaceRecord;
    readonly preparationError: unknown;
    readonly cleanupError: unknown;
    constructor(record: MoAWorkspaceRecord, preparationError: unknown, cleanupError: unknown);
}
/** The caller resolves the acting session's policy at every operation. */
export interface MoAWorkspaceCapabilities {
    fs: FileSystem;
    policy: () => SandboxExecutionPolicy;
    sandbox: Pick<SandboxProvider, "confine">;
    subprocess?: Pick<SubprocessRuntime, "spawn" | "resolveExecutable">;
}
export declare class MoAWorkspaceManager {
    private readonly capabilities;
    constructor(capabilities: MoAWorkspaceCapabilities);
    private git;
    private runScoped;
    private paths;
    prepare(input: {
        ownerId: string;
        sourceDirectory: string;
        mode: "shared" | "isolated";
        signal: AbortSignal;
    }): Promise<MoAWorkspaceRecord>;
    /** Find preparations whose caller did not receive their record before a crash. */
    discoverOwned(sourceDirectory: string, ownerId: string, signal: AbortSignal): Promise<MoAWorkspaceRecord[]>;
    private runCommand;
    private runRemove;
    restore(record: MoAWorkspaceRecord): MoAWorkspaceRecord;
    destroy(record: MoAWorkspaceRecord, signal: AbortSignal): Promise<void>;
}
