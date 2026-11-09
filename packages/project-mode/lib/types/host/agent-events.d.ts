import type { Agent } from "@deepseek-ai/dsh-agent";
import { SessionId } from "@deepseek-ai/dsh-session";
import type { HostAccess } from "./host-access.ts";
import type { CompletionOutbox } from "./completion-outbox.ts";
import type { WorkerOperations } from "./worker-operations.ts";
interface AgentEventOptions {
    outbox: CompletionOutbox;
    workers: WorkerOperations;
    progress: Map<SessionId, string>;
    reconcileTools(): void;
    attach(agent: Agent): void;
    disposeAgent(agent: Agent): void;
    recover(id: SessionId): Promise<void>;
    guardTurn(agent: Agent, signal: AbortSignal): Promise<void>;
    freezeTurn(id: SessionId, turn: number, reason: string): Promise<void>;
    refreshWorkersForInput(agent: Agent, messageIds: string[], signal: AbortSignal): Promise<void>;
}
/** Bind native lifecycle notifications in their original registration order. */
export declare function bindAgentEvents(host: HostAccess, options: AgentEventOptions): void;
export {};
