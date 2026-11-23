import type { SessionId } from "@deepseek-ai/dsh-session";
import type { WorkerParentReady } from "../shared/index.ts";
import type { HostAccess } from "./host-access.ts";
/** A visible nested conversation borrows its real native parent until the view closes. */
export declare function followWorkerParent(host: HostAccess, rootId: SessionId, workerId: SessionId, signal: AbortSignal): AsyncGenerator<WorkerParentReady>;
