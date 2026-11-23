import { SessionId } from "@deepseek-ai/dsh-session";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { ControlResult, ControlWorkersRequest, WorkerView } from "../shared/index.ts";
import type { HostAccess } from "./host-access.ts";
export interface MoASpawnOptions {
    name: string;
    task: string;
    childId: SessionId;
    cwd: string;
    identity: string;
    provider: string;
    /** Root project owner, distinct from the native creator for nested work. */
    rootId?: SessionId;
}
/** Native worker operations with durable operation identities. */
export declare class WorkerOperations {
    private host;
    readonly operations: Map<string, Promise<ControlResult>>;
    private workerQueues;
    constructor(host: HostAccess);
    /** Reuse the Project admission and receipt path with pre-reserved native inputs. */
    spawnMoA(agent: Agent, options: MoASpawnOptions, operationId: string, signal: AbortSignal): Promise<ControlResult>;
    listWorkers(agent: Agent, signal: AbortSignal): Promise<WorkerView[]>;
    controlForAgent(agent: Agent, request: ControlWorkersRequest, operationId: string, signal: AbortSignal, nativeAdmit?: (signal: AbortSignal) => Promise<string>): Promise<ControlResult>;
    private dispatch;
    /** Stop/removal is independent from assigning another turn of work. */
    private interruptOrDelete;
    /** Record operation intent before crossing native inbox admission. */
    private prepareAssignment;
    private admitWorkerInput;
    private acceptReceipt;
    reconcileAssignment(agent: Agent, assignmentId: string, rootId?: SessionId): Promise<void>;
}
