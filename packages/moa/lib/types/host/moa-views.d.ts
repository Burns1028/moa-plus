import { SessionId } from "@deepseek-ai/dsh-session";
import type { SessionProjectionStateMap } from "@deepseek-ai/dsh-session-projection/types";
import type { MoASnapshot, WorkerView } from "../shared/index.ts";
import type { RecordState } from "./state.ts";
interface SnapshotInput {
    sessionId: SessionId;
    record: RecordState;
    workers: WorkerView[];
    memberIds: ReadonlySet<string>;
    boundary: SessionProjectionStateMap["turnBoundary"] | undefined;
    waiting: boolean;
    pendingSteerCount: number;
    streamEpoch: string;
}
/** Assemble a transport view from already-observed native and durable facts. */
export declare function buildMoASnapshot({ sessionId, record: r, workers, memberIds, boundary, waiting, pendingSteerCount, streamEpoch, }: SnapshotInput): MoASnapshot;
export {};
