import { Context, Service } from "@deepseek-ai/cordis";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { SessionId } from "@deepseek-ai/dsh-session";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { Config } from "./config.ts";
import type { ControlWorkersRequest, ControlResult, ProjectSnapshot, ProjectFrame, WorkerHistoryPage, WorkerTimelinePage, WorkerParentReady, SessionModeView } from "../shared/index.ts";
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
            senderSessionId?: string;
            senderName?: string;
        };
        "project-mode-assignment": {
            kind: "project-mode-assignment";
            form: "relay";
            operationId: string;
            coordinatorSessionId: SessionId;
            senderSessionId?: string;
            senderName?: string;
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
        projectMode: ProjectMode;
    }
}
/** Native Project coordination; no alternative Agent driver. */
export default class ProjectMode extends TypertRemoteService {
    private config;
    static Config: import("@deepseek-ai/schemastery").default<Config>;
    static inject: string[];
    private domain;
    private outbox;
    private workers;
    private turns;
    private messages;
    private moa;
    private moaTools;
    private contextTool;
    private completionAttach?;
    private messageTool;
    private lifecycle;
    private get access();
    private mounted;
    private reconcilingTools;
    private toolsChangedDuringReconciliation;
    private backgroundBindings;
    private projectJobs;
    private get jobs();
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
    private participant;
    private prepareAgent;
    private releaseBackground;
    private attach;
    private roleText;
    private notify;
    private enqueue;
    private update;
    private worker;
    private requireCoordinator;
    controlForAgent(agent: Agent, request: ControlWorkersRequest, operationId: string, signal: AbortSignal): Promise<ControlResult>;
    /** Legacy delete keeps its receipt/serialization while cleaning MoA-owned resources. */
    private stopManagedWorker;
    private reconcileAssignment;
    private refreshWorkersForInput;
    private inspect;
    private view;
    private ingest;
    private consume;
    private deliver;
    private guardTurn;
    private freezeTurn;
    snapshot(sessionId: SessionId): Promise<ProjectSnapshot | null>;
    follow(sessionId: SessionId, signal: AbortSignal): AsyncIterable<ProjectFrame>;
    followWorkerParent(sessionId: SessionId, workerId: SessionId, signal: AbortSignal): AsyncIterable<WorkerParentReady>;
    catalog(): Promise<ProjectSnapshot[]>;
    control(sessionId: SessionId, request: ControlWorkersRequest, requestId: string, signal: AbortSignal): Promise<ControlResult>;
    history(sessionId: SessionId, workerId: SessionId, offset: number, limit: number, signal: AbortSignal): Promise<WorkerHistoryPage>;
    timeline(sessionId: SessionId, workerId: SessionId, limit: number, signal: AbortSignal): AsyncIterable<WorkerTimelinePage>;
    private readHistory;
    mode(sessionId: SessionId): SessionModeView;
    setEnabled(sessionId: SessionId, enabled: boolean, expectedRevision: number, requestId: string): Promise<SessionModeView>;
}
