import type { Agent } from "@deepseek-ai/dsh-agent";
import type { ControlResult, ControlWorkersRequest, WorkerView } from "../shared/index.ts";
import type { HostAccess } from "./host-access.ts";
/** Native worker operations with durable operation identities. */
export declare class WorkerOperations {
    private host;
    readonly operations: Map<string, Promise<ControlResult>>;
    private workerQueues;
    constructor(host: HostAccess);
    listWorkers(agent: Agent, signal: AbortSignal): Promise<WorkerView[]>;
    controlForAgent(agent: Agent, request: ControlWorkersRequest, operationId: string, signal: AbortSignal): Promise<ControlResult>;
    private dispatch;
    /** Stop/removal is independent from assigning another turn of work. */
    private interruptOrDelete;
    /** Record operation intent before crossing native inbox admission. */
    private prepareAssignment;
    private admitWorkerInput;
    private acceptReceipt;
    reconcileAssignment(agent: Agent, assignmentId: string): Promise<void>;
}
