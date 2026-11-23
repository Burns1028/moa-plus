import type { SessionId } from "@deepseek-ai/dsh-session";
import type { WorkerHistoryPage } from "../shared/index.ts";
import type { HostAccess } from "./host-access.ts";
/** A relative window over committed dialogue, indexed from its newest message. */
export declare function readHistory(host: HostAccess, parentId: SessionId, workerId: SessionId, offset: number, limit: number, signal: AbortSignal): Promise<WorkerHistoryPage>;
