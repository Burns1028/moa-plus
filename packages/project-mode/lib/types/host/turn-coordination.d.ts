import { SessionId } from "@deepseek-ai/dsh-session";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { HostAccess } from "./host-access.ts";
/** Event-driven native turn closure. No worker lock is held while waiting. */
export declare class TurnCoordination {
    private host;
    readonly waiting: Set<string>;
    constructor(host: HostAccess);
    guardTurn(agent: Agent, signal: AbortSignal): Promise<void>;
    freezeTurn(parentId: SessionId, turn: number, parentReason: string): Promise<void>;
}
