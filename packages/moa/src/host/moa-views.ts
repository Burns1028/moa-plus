import { SessionId } from "@deepseek-ai/dsh-session";
import type {} from "@deepseek-ai/dsh-agent";
import type { SessionProjectionStateMap } from "@deepseek-ai/dsh-session-projection/types";
import type {
  MoASnapshot,
  WorkerView,
  CoordinatorTurnView,
} from "../shared/index.ts";
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
export function buildMoASnapshot({
  sessionId,
  record: r,
  workers,
  memberIds,
  boundary,
  waiting,
  pendingSteerCount,
  streamEpoch,
}: SnapshotInput): MoASnapshot {
  const turn = boundary?.lastTurn ?? 0;
  const active = boundary?.openTurnStartSeq !== null && boundary !== undefined;
  const coordinatorTurn: CoordinatorTurnView | null = active
    ? {
        sessionId,
        turn,
        phase: waiting ? "waiting-workers" : "working",
        workerIds: [
          ...new Set(
            r.memberships
              .filter(
                (m) => m.coordinatorTurn === turn && memberIds.has(m.workerId),
              )
              .map((m) => SessionId(m.workerId)),
          ),
        ],
        unresolvedOperationIds: r.assignments
          .filter(
            (a) => a.admission === "unknown" || a.admission === "prepared",
          )
          .map((a) => a.operationId),
        pendingAssignmentIds: r.assignments
          .filter(
            (a) =>
              a.admission !== "rejected" &&
              !r.completions.some((c) => c.assignmentIds.includes(a.id)),
          )
          .map((a) => a.id),
        runningWorkerIds: workers
          .filter((w) => w.status === "busy")
          .map((w) => w.workerId),
        queuedWorkerIds: workers
          .filter((w) => w.queueLength)
          .map((w) => w.workerId),
        undeliveredCompletionIds: r.deliveries
          .filter((d) => d.state === "pending")
          .map((d) => d.completionId),
        unconsumedCompletionIds: r.deliveries
          .filter((d) => d.state !== "consumed" && d.state !== "suppressed")
          .map((d) => d.completionId),
        pendingSteerCount,
        revision: r.project.revision,
      }
    : null;
  return {
    project: {
      ...r.project,
      coordinatorSessionId: SessionId(r.project.coordinatorSessionId),
    },
    workers,
    turnMemberships: r.memberships
      .filter((m) => memberIds.has(m.workerId))
      .map((m) => ({
        ...m,
        coordinatorSessionId: SessionId(m.coordinatorSessionId),
        workerId: SessionId(m.workerId),
      })),
    closedTurnOutcomes: r.outcomes
      .filter((o) => memberIds.has(o.workerId))
      .map((o) => ({
        ...o,
        coordinatorSessionId: SessionId(o.coordinatorSessionId),
        workerId: SessionId(o.workerId),
      })),
    coordinatorTurn,
    streamEpoch,
    revision: r.project.revision,
  };
}
