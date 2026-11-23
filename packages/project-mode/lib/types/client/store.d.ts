import type { ProjectSnapshot, WorkerView } from "../shared/index.ts";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { SubagentAddress } from "@deepseek-ai/dsh-subagent/client";
export interface WorkerCapsule {
    key: string;
    workerId: SessionId;
    name: string;
    status: WorkerView["phase"] | "completed" | "deleted" | "continued";
    text?: string;
    queueLength: number | null;
    address: SubagentAddress;
}
/** Reconcile JSON views without replacing unchanged rows or arrays. */
export declare function reuse<T>(before: T | undefined, after: T): T;
/** One derived Project cache shared by every sidebar row and turn capsule. */
export declare class ProjectStore {
    private readonly throttle;
    private values;
    private listeners;
    private turns;
    private pending;
    private timer;
    private stopped;
    constructor(throttle?: number);
    subscribe: (listener: () => void) => () => void;
    project: (sessionId: SessionId) => ProjectSnapshot | undefined;
    projects: () => ProjectSnapshot[];
    accept(value: ProjectSnapshot): void;
    push(value: ProjectSnapshot): void;
    turn(sessionId: SessionId, turn: number, closed: boolean, segmentStartSeq?: number): readonly WorkerCapsule[];
    dispose(): void;
}
