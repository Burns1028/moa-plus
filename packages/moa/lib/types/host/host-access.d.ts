import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { SessionId } from "@deepseek-ai/dsh-session";
import type { Config } from "./config.ts";
import type { RecordState, Worker } from "./state.ts";
import type { WorkerView, WorkerHistoryPage } from "../shared/index.ts";
/** Dependencies shared by coordination components. Native Agent owns execution. */
export interface HostAccess {
    readonly ctx: Context;
    readonly config: Config;
    readonly closing: AbortController;
    readonly listeners: Set<() => void>;
    record(id: SessionId): RecordState | undefined;
    owner(id: SessionId): RecordState | undefined;
    worker(record: RecordState, id: SessionId): Worker;
    update(id: SessionId, change: (record: RecordState) => RecordState): Promise<void>;
    requireCoordinator(agent: Agent): RecordState;
    view(worker: Worker, signal?: AbortSignal): Promise<WorkerView>;
    inspect(worker: Worker, signal?: AbortSignal, details?: boolean): Promise<WorkerView>;
    readHistory(parentId: SessionId, workerId: SessionId, offset: number, limit: number, signal: AbortSignal): Promise<WorkerHistoryPage>;
    enqueue(work: () => Promise<void>): void;
    notify(): void;
    ingest(id: SessionId): Promise<void>;
    settledJobs(): Promise<void>;
    pendingOperations(id: SessionId): number;
}
