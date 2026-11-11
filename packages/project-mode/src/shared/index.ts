import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type {
  FileAttachmentRef,
  ImageAttachmentRef,
} from "@deepseek-ai/dsh-attachment";

export interface ProjectPaths {
  root: string;
  context: string;
  notes: string;
  archived: string;
  /** New index; older records are resolved without rewriting their documents. */
  index?: string;
}
/** Public Project metadata, not the full persisted Host aggregate. */
export interface ProjectRecord {
  version: 1;
  id: string;
  coordinatorSessionId: SessionId;
  workspaceId?: string;
  workspacePath: string;
  paths: ProjectPaths;
  mode: "enabled" | "disabled";
  /** Project identity becomes permanent when this Session starts a turn. */
  modeLocked?: boolean;
  revision: number;
  createdAt: number;
  updatedAt: number;
}
export interface SessionModeView {
  sessionId: SessionId;
  role: "ordinary" | "coordinator" | "worker";
  enabled: boolean;
  modeLocked?: boolean;
  projectId?: string;
  coordinatorSessionId?: SessionId;
  paths?: ProjectPaths;
  revision: number;
  canToggle: boolean;
  toggleBlockedReason?:
    | "session-mode-locked"
    | "agent-running"
    | "workers-active"
    | "results-pending"
    | "worker-session"
    | "runtime-unavailable";
}
/** Derived observation for tools/UI; lifecycle is membership, status is native activity. */
export interface WorkerView {
  workerId: SessionId;
  /** Actual native direct parent; older direct-child snapshots omit this field. */
  parentSessionId?: SessionId;
  name: string;
  lifecycle:
    | "provisioning"
    | "active"
    | "deleting"
    | "deleted"
    | "provision-failed";
  status: "busy" | "idle" | null;
  availability: "live" | "cold" | "unavailable";
  queueLength: number | null;
  pendingSteerCount: number | null;
  phase:
    | "starting"
    | "working"
    | "waiting-user"
    | "stopping"
    | "idle"
    | "failed"
    | "stopped"
    | "disconnected";
  progressText?: string;
  updatedAt: number;
  /** Present on list/get; null means native activity could not be observed. */
  activity?: WorkerActivity | null;
}
/** Readiness only; the Remote stream lifetime owns native parent residency. */
export interface WorkerParentReady {
  workerId: SessionId;
  parentSessionId: SessionId;
}
/** Durable references only; content bytes remain owned by native attachment storage. */
export type WorkerMessageAttachment = (
  | { type: "file"; attachment: FileAttachmentRef }
  | { type: "image"; attachment: ImageAttachmentRef }
) & {
  /** Native execution-world read path, when the attachment is locally accessible. */
  path?: string;
};
export interface WorkerInputView {
  messageId: string;
  actor: "user" | "coordinator" | "other";
  text: string;
  attachments?: WorkerMessageAttachment[];
  truncated: boolean;
  state: "committed" | "pending-steer" | "pending-queue";
  /** Native admission/edit position, or committed message position. */
  seq: number;
  time: number;
}
export interface WorkerActivity {
  observedThroughSeq: number;
  /** Latest committed task/dialogue input, not a guessed task summary. */
  latestInput?: WorkerInputView;
  /** Most recent committed or still-pending human input; excludes withdrawn input. */
  lastUserInput?: WorkerInputView;
  pendingUserInputs: WorkerInputView[];
  pendingUserInputCount: number;
}
export interface TurnWorkerMembership {
  projectId: string;
  coordinatorSessionId: SessionId;
  coordinatorTurn: number;
  /** Native human user/message (or turn/start fallback) seq; never a business turn. */
  segmentStartSeq?: number;
  /** Native coordinator evidence at the first accepted assignment/result. */
  participationSeq?: number;
  participationKind?: "spawn" | "send" | "result";
  completionIds?: string[];
  workerId: SessionId;
  firstOperationId: string;
  firstCallId: string;
  order: number;
}
export interface TurnWorkerOutcomeView {
  coordinatorSessionId: SessionId;
  coordinatorTurn: number;
  segmentStartSeq?: number;
  workerId: SessionId;
  status: "completed" | "failed" | "stopped" | "deleted" | "continued";
  completionIds: string[];
  lastResultMessageId?: string;
  lastResultSeq?: number;
  summary?: string;
}
export interface CoordinatorTurnView {
  sessionId: SessionId;
  turn: number;
  phase:
    | "working"
    | "waiting-workers"
    | "reviewing-results"
    | "closing"
    | "closed"
    | "interrupted"
    | "failed";
  workerIds: SessionId[];
  unresolvedOperationIds: string[];
  pendingAssignmentIds: string[];
  runningWorkerIds: SessionId[];
  queuedWorkerIds: SessionId[];
  undeliveredCompletionIds: string[];
  unconsumedCompletionIds: string[];
  pendingSteerCount: number;
  revision: number;
}
/** Complete read model sent to Clients; never a second scheduling source. */
export interface ProjectSnapshot {
  project: ProjectRecord;
  workers: WorkerView[];
  turnMemberships: TurnWorkerMembership[];
  closedTurnOutcomes: TurnWorkerOutcomeView[];
  coordinatorTurn: CoordinatorTurnView | null;
  streamEpoch: string;
  revision: number;
}
export type ProjectFrame = { type: "baseline"; value: ProjectSnapshot };
export type ControlWorkersRequest =
  | { action: "spawn"; name: string; task: string; task_ref?: string }
  | { action: "list" }
  | {
      action: "send";
      worker_id: SessionId;
      message: string;
      delivery: "steer" | "queue";
      task_ref?: string;
    }
  | { action: "get"; worker_id: SessionId }
  | { action: "interrupt"; worker_id: SessionId }
  | { action: "delete"; worker_id: SessionId }
  | {
      action: "history";
      worker_id: SessionId;
      offset: number;
      limit: number;
    };
export interface WorkerDialogueMessage {
  /** Zero-based position from newest in this observed dialogue. */
  index: number;
  id: string;
  seq: number;
  turn: number;
  role: "user" | "assistant";
  text: string;
  attachments?: WorkerMessageAttachment[];
}
export interface WorkerHistoryPage {
  workerId: SessionId;
  status: "busy" | "idle" | null;
  offset: number;
  limit: number;
  total: number;
  messages: WorkerDialogueMessage[];
  observedThroughSeq: number;
}
export interface WorkerTimelineMessage {
  id: string;
  seq: number;
  time: number;
  text: string;
  /** UI-only body without an exactly verified MoA transport prefix; text stays original. */
  displayText?: string;
  attachments?: WorkerMessageAttachment[];
  actor?: "user" | "coordinator" | "agent";
}
export interface WorkerArtifact {
  path: string;
  description?: string;
  kind: "presented" | "changed";
  seq: number;
  time: number;
}
export interface WorkerTimelineTurn {
  turn: number;
  startedAt: number;
  finishedAt?: number;
  outcome: string | null;
  inputs: WorkerTimelineMessage[];
  outputs: WorkerTimelineMessage[];
  artifacts: WorkerArtifact[];
}
export interface WorkerTimelinePage {
  workerId: SessionId;
  cwd?: string;
  status: "busy" | "idle" | null;
  total: number;
  hasMore: boolean;
  observedThroughSeq: number;
  turns: WorkerTimelineTurn[];
}
export interface ControlReceipt {
  operationId: string;
  workerId: SessionId;
  accepted: true;
  assignmentId?: string;
  messageId?: string;
  coordinatorTurn?: number;
  delivery?: "steer" | "queue";
  queuedWorkPolicy?: "native-preserve";
  lifecycle?: "deleted";
  historyRetained?: true;
}
export type ControlResult =
  | ControlReceipt
  | WorkerView
  | WorkerView[]
  | WorkerHistoryPage;
