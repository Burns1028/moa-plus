import { Context, Service } from "@deepseek-ai/cordis";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { SessionId } from "@deepseek-ai/dsh-session";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { Config } from "./config.ts";
import type { ControlWorkersRequest, ControlResult, MoASnapshot, MoAFrame, WorkerHistoryPage, WorkerTimelinePage, SessionModeView } from "../shared/index.ts";
export { Config } from "./config.ts";
export * from "../shared/index.ts";
declare module "@deepseek-ai/dsh-llm" {
    interface MessageSourceMap {
        "project-mode-result": {
            kind: "project-mode-result";
            form: "relay";
            completionId: string;
            workerId: SessionId;
            workerTurn: number;
        };
        "project-mode-assignment": {
            kind: "project-mode-assignment";
            form: "relay";
            operationId: string;
            coordinatorSessionId: SessionId;
        };
        "project-mode-notice": {
            kind: "project-mode-notice";
            form: "notice";
            summary: string;
        };
    }
}
declare module "@deepseek-ai/cordis" {
    interface Context {
        projectMode: MoAPlugin;
    }
}
/** Native MoA coordination; no alternative Agent driver. */
export default class MoAPlugin extends TypertRemoteService {
    private config;
    static Config: import("@deepseek-ai/schemastery").default<Config>;
    static inject: string[];
    private domain;
    private outbox;
    private workers;
    private turns;
    private lifecycle;
    private get access();
    private mounted;
    private reconcilingTools;
    private toolsChangedDuringReconciliation;
    private controlTool;
    private jobs;
    private listeners;
    private progress;
    private workerInputSnapshots;
    private epoch;
    private available;
    private closing;
    constructor(ctx: Context, config: Config);
    protected [Service.init](): Promise<void>;
    private recover;
    private record;
    private owner;
    private authorize;
    private reconcileTools;
    private attach;
    private roleText;
    private notify;
    private enqueue;
    private update;
    private worker;
    private requireCoordinator;
    controlForAgent(agent: Agent, request: ControlWorkersRequest, operationId: string, signal: AbortSignal): Promise<ControlResult>;
    private reconcileAssignment;
    private refreshWorkersForInput;
    private inspect;
    private view;
    private ingest;
    private consume;
    private deliver;
    private guardTurn;
    private freezeTurn;
    snapshot(sessionId: SessionId): Promise<MoASnapshot | null>;
    follow(sessionId: SessionId, signal: AbortSignal): AsyncIterable<MoAFrame>;
    catalog(): Promise<MoASnapshot[]>;
    control(sessionId: SessionId, request: ControlWorkersRequest, requestId: string, signal: AbortSignal): Promise<ControlResult>;
    history(sessionId: SessionId, workerId: SessionId, offset: number, limit: number, signal: AbortSignal): Promise<WorkerHistoryPage>;
    timeline(sessionId: SessionId, workerId: SessionId, limit: number, signal: AbortSignal): AsyncIterable<WorkerTimelinePage>;
    private readHistory;
    mode(sessionId: SessionId): SessionModeView;
    setEnabled(sessionId: SessionId, enabled: boolean, expectedRevision: number, requestId: string): Promise<SessionModeView>;
}
