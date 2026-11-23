import type { SessionId } from "@deepseek-ai/dsh-session";
import type { WorkerTimelinePage } from "../shared/index.ts";
import type { HostAccess } from "./host-access.ts";
export declare function readWorkerTimeline(host: HostAccess, parentId: SessionId, workerId: SessionId, limit: number, signal: AbortSignal): Promise<WorkerTimelinePage>;
/** A UI-only native-event subscription. It never resumes or prompts an Agent. */
export declare function followWorkerTimeline(host: HostAccess, parentId: SessionId, workerId: SessionId, limit: number, signal: AbortSignal): AsyncIterable<WorkerTimelinePage>;
