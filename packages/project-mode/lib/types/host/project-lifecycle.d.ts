import type { Agent } from "@deepseek-ai/dsh-agent";
import { SessionId, type SessionEvent } from "@deepseek-ai/dsh-session";
import type { SessionModeView } from "../shared/index.ts";
import type { HostAccess } from "./host-access.ts";
import { type RecordState } from "./state.ts";
export declare function hasOwnTurn(events: readonly SessionEvent[], inheritedEventCount: number): boolean;
interface LifecycleOptions {
    put(id: SessionId, record: RecordState): Promise<void>;
    attach(agent: Agent): void | Promise<void>;
    recover(id: SessionId): Promise<void>;
}
/** Owns Project identity and draft enable/disable through native Agent maintenance. */
export declare class ProjectLifecycle {
    private host;
    private options;
    constructor(host: HostAccess, options: LifecycleOptions);
    mode(sessionId: SessionId): SessionModeView;
    private modeLocked;
    setEnabled(sessionId: SessionId, enabled: boolean, expectedRevision: number, requestId: string): Promise<SessionModeView>;
    private requireCanDisable;
    private createRecord;
}
export {};
