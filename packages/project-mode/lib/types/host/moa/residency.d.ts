import type { Agent } from "@deepseek-ai/dsh-agent";
import { SessionId } from "@deepseek-ai/dsh-session";
import type { HostAccess } from "../host-access.ts";
/** Borrow the actual native parent chain without sending intermediate work. */
export declare function withManagedAgent<T>(host: HostAccess, id: SessionId, signal: AbortSignal, use: (agent: Agent) => Promise<T>): Promise<T>;
