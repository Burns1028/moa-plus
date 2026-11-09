import type { WorkerActivity } from "../shared/index.ts";
import type { HostAccess } from "./host-access.ts";
import { SessionId } from "@deepseek-ai/dsh-session";
/** Read native committed messages and the native Inbox; no shadow task queue. */
export declare function readWorkerActivity(host: HostAccess, workerId: SessionId, signal?: AbortSignal, previewChars?: number): Promise<WorkerActivity>;
