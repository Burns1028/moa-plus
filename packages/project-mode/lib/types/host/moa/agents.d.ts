import { type ProjectContextInput } from "../project-memory.ts";
import { type MoAWorkspaceRecord } from "./workspaces.ts";
import { SessionId, type SessionEvent, type SessionSeq } from "@deepseek-ai/dsh-session";
import type { SubagentProvider } from "@deepseek-ai/dsh-subagent";
/** Native continuation manager reserves the child and owns activation. */
export declare function createHistoryBranchProvider(loadSeed: (id: SessionId) => readonly SessionEvent[] | undefined): SubagentProvider;
/** The inclusive committed watermark is selected by the caller observing the source. */
export declare function prepareHistoryBranch(events: readonly SessionEvent[], watermark: SessionSeq): SessionEvent[];
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { HostAccess } from "../host-access.ts";
import type { WorkerOperations } from "../worker-operations.ts";
export interface WorkAssignment {
    name: string;
    task: string;
    role: "Explorer" | "Planner" | "Deep Research" | "General-purpose";
    workspace?: "shared" | "isolated";
    reportTo?: string;
    nested?: boolean;
}
export interface AgentDescriptor {
    id: string;
    creatorId: string;
    reportTo: string;
    role: WorkAssignment["role"];
    nested: boolean;
    sourceDirectory: string;
    workspaceMode: "shared" | "isolated";
    workspace?: MoAWorkspaceRecord;
    forkOperation?: string;
    workspaceIncomplete?: boolean;
}
export interface TeamObservation {
    ids?: string[];
    wait?: "all" | "selected";
    timeoutMs?: number;
    history?: {
        offset: number;
        limit: number;
    };
}
/** Views are derived from native Agents and Project membership; no agent loop is duplicated. */
export declare class MoAAgents {
    private host;
    private workers;
    private waiting;
    private dispatches;
    private unregisterFork?;
    dispose(): void;
    constructor(host: HostAccess, workers: WorkerOperations);
    descriptor(id: SessionId): AgentDescriptor | undefined;
    lifecycle(agent: Agent): "Idle" | "Waiting" | "Running" | "Aborting" | "Zombie";
    private workspaceManager;
    dispatch(agent: Agent, tasks: WorkAssignment[], operationId: string, signal: AbortSignal, seed?: readonly SessionEvent[]): Promise<(import("../index.ts").ControlReceipt | import("../index.ts").WorkerView | import("../index.ts").WorkerHistoryPage)[]>;
    private startAssignments;
    branch(agent: Agent, sourceId: SessionId, item: WorkAssignment, operationId: string, signal: AbortSignal): Promise<string | number | true | import("zod").JSONType[] | {
        [key: string]: import("zod").JSONType;
    } | import("../index.ts").ControlReceipt | import("../index.ts").WorkerView | import("../index.ts").WorkerHistoryPage>;
    private recoveryState;
    needsRecovery(record: import("../state.ts").RecordState): boolean;
    private clearWorkspace;
    /** Startup reconciliation cleans abandoned preparations and removed native families. */
    recover(agent: Agent, signal: AbortSignal): Promise<void>;
    sharedContext(agent: Agent, input: ProjectContextInput, signal: AbortSignal): Promise<{
        content: string;
        version: import("@deepseek-ai/dsh-fs").FsVersion;
        operation?: undefined;
    } | {
        version: import("@deepseek-ai/dsh-fs").FsVersion;
        operation: "create" | "update";
        content?: undefined;
    }>;
    stopWork(agent: Agent, childId: SessionId, signal: AbortSignal, options?: {
        destroy?: boolean;
        continueWith?: string;
        operationId?: string;
    }): Promise<{
        workerId: SessionId;
        accepted: boolean;
        lifecycle: "deleted" | "Idle" | "Waiting" | "Running" | "Aborting" | "Zombie";
    }>;
    observe(agent: Agent, input: TeamObservation, signal: AbortSignal): Promise<{
        history?: import("../index.ts").WorkerHistoryPage[] | undefined;
        children: {
            lifecycleState: "Idle" | "Waiting" | "Running" | "Aborting" | "Zombie";
            workerId: SessionId;
            parentSessionId?: SessionId;
            name: string;
            lifecycle: "provisioning" | "active" | "deleting" | "deleted" | "provision-failed";
            status: "busy" | "idle" | null;
            availability: "live" | "cold" | "unavailable";
            queueLength: number | null;
            pendingSteerCount: number | null;
            phase: "starting" | "working" | "waiting-user" | "stopping" | "idle" | "failed" | "stopped" | "disconnected";
            progressText?: string;
            updatedAt: number;
            activity?: import("../index.ts").WorkerActivity | null;
        }[];
    } | {
        reason: "interrupted";
        history?: import("../index.ts").WorkerHistoryPage[] | undefined;
        children: {
            lifecycleState: "Idle" | "Waiting" | "Running" | "Aborting" | "Zombie";
            workerId: SessionId;
            parentSessionId?: SessionId;
            name: string;
            lifecycle: "provisioning" | "active" | "deleting" | "deleted" | "provision-failed";
            status: "busy" | "idle" | null;
            availability: "live" | "cold" | "unavailable";
            queueLength: number | null;
            pendingSteerCount: number | null;
            phase: "starting" | "working" | "waiting-user" | "stopping" | "idle" | "failed" | "stopped" | "disconnected";
            progressText?: string;
            updatedAt: number;
            activity?: import("../index.ts").WorkerActivity | null;
        }[];
    } | {
        reason: "done";
        history?: import("../index.ts").WorkerHistoryPage[] | undefined;
        children: {
            lifecycleState: "Idle" | "Waiting" | "Running" | "Aborting" | "Zombie";
            workerId: SessionId;
            parentSessionId?: SessionId;
            name: string;
            lifecycle: "provisioning" | "active" | "deleting" | "deleted" | "provision-failed";
            status: "busy" | "idle" | null;
            availability: "live" | "cold" | "unavailable";
            queueLength: number | null;
            pendingSteerCount: number | null;
            phase: "starting" | "working" | "waiting-user" | "stopping" | "idle" | "failed" | "stopped" | "disconnected";
            progressText?: string;
            updatedAt: number;
            activity?: import("../index.ts").WorkerActivity | null;
        }[];
    } | {
        reason: "timeout";
        history?: import("../index.ts").WorkerHistoryPage[] | undefined;
        children: {
            lifecycleState: "Idle" | "Waiting" | "Running" | "Aborting" | "Zombie";
            workerId: SessionId;
            parentSessionId?: SessionId;
            name: string;
            lifecycle: "provisioning" | "active" | "deleting" | "deleted" | "provision-failed";
            status: "busy" | "idle" | null;
            availability: "live" | "cold" | "unavailable";
            queueLength: number | null;
            pendingSteerCount: number | null;
            phase: "starting" | "working" | "waiting-user" | "stopping" | "idle" | "failed" | "stopped" | "disconnected";
            progressText?: string;
            updatedAt: number;
            activity?: import("../index.ts").WorkerActivity | null;
        }[];
    }>;
}
