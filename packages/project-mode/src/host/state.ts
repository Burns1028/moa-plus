import { z } from "zod";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import {
  snapshotSessionEvent,
  SessionSeq,
  type SessionEvent,
} from "@deepseek-ai/dsh-session";
import {
  type ContentBlock,
  type UserMessage,
  MessageId,
} from "@deepseek-ai/dsh-llm";
import type { ProjectionDefinition } from "@deepseek-ai/dsh-session-projection";

const id = z.string().min(1);
export const pathsSchema = z.object({
  root: id,
  context: id,
  notes: id,
  archived: id,
  index: id.optional(),
});
export const projectSchema = z.object({
  version: z.literal(1),
  id,
  coordinatorSessionId: id,
  workspaceId: id.optional(),
  workspacePath: id,
  paths: pathsSchema,
  mode: z.enum(["enabled", "disabled"]),
  // Absent on pre-0.1.7 records; recovered from owned native turn history.
  modeLocked: z.boolean().optional(),
  revision: z.number().int().nonnegative(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export const workerSchema = z.object({
  id,
  name: id,
  description: z.string(),
  creationOperationId: id,
  lifecycle: z.enum([
    "provisioning",
    "active",
    "deleting",
    "deleted",
    "provision-failed",
  ]),
  createdAt: z.number(),
  deletedAt: z.number().optional(),
  // Restore only children this Project archive actually brought along.
  archivedByCoordinator: z.boolean().optional(),
});
export const assignmentSchema = z.object({
  id,
  operationId: id,
  workerId: id,
  coordinatorTurn: z.number().int(),
  segmentStartSeq: z.number().int().nonnegative().optional(),
  participationSeq: z.number().int().nonnegative().optional(),
  participationKind: z.enum(["spawn", "send"]).optional(),
  delivery: z.enum(["steer", "queue"]),
  messageId: id.optional(),
  admission: z.enum(["prepared", "accepted", "unknown", "rejected"]),
  rejection: z.object({ code: z.string(), message: z.string() }).optional(),
  taskRef: z.string().optional(),
});
// Delegate message/block validation to DSH's own persisted Session boundary.
export const messageSchema = z
  .unknown()
  .transform((value, ctx): UserMessage => {
    try {
      return snapshotSessionEvent({
        type: "user/message",
        surfaceOp: "append",
        seq: SessionSeq(0),
        time: 0,
        data: value,
      } as SessionEvent<"user/message">).data;
    } catch (e) {
      ctx.addIssue({ code: "custom", message: String(e) });
      return z.NEVER;
    }
  });
export const contentSchema = z
  .unknown()
  .transform((value, ctx): readonly ContentBlock[] => {
    const result = messageSchema.safeParse({
      id: MessageId("validation"),
      role: "user",
      source: { kind: "user" },
      content: value,
    });
    if (!result.success) {
      ctx.addIssue({ code: "custom", message: result.error.message });
      return z.NEVER;
    }
    return result.data.content;
  });
export const assistantSchema = z.object({
  messageId: id,
  seq: z.number().int(),
  content: contentSchema,
});
export const completionSchema = z.object({
  id,
  workerId: id,
  workerTurn: z.number().int(),
  turnEndSeq: z.number().int(),
  assignmentIds: z.array(id),
  outcome: z.enum(["completed", "aborted", "error", "max-tokens", "refusal"]),
  lastAssistant: assistantSchema.optional(),
  settledAt: z.number(),
});
const nativeReceiptSchema = z.object({
  messageId: id,
  seq: z.number().int().nonnegative(),
  admissionSeq: z.number().int().nonnegative(),
  workerTurnEndSeq: z.number().int().nonnegative(),
});
export type NativeReceipt = z.infer<typeof nativeReceiptSchema>;
export const deliverySchema = z.object({
  completionId: id,
  // Legacy deliveries target the owning Coordinator.
  targetId: id.optional(),
  message: messageSchema,
  state: z.enum(["pending", "admitted", "consumed", "suppressed"]),
  attempts: z.number().int(),
  lastError: z.string().optional(),
  nativeReceipt: nativeReceiptSchema.optional(),
});
export const membershipSchema = z.object({
  projectId: id,
  coordinatorSessionId: id,
  coordinatorTurn: z.number().int(),
  segmentStartSeq: z.number().int().nonnegative().optional(),
  participationSeq: z.number().int().nonnegative().optional(),
  participationKind: z.enum(["spawn", "send", "result"]).optional(),
  completionIds: z.array(id).optional(),
  workerId: id,
  firstOperationId: id,
  firstCallId: id,
  order: z.number().int(),
});
export const outcomeSchema = z.object({
  coordinatorSessionId: id,
  coordinatorTurn: z.number().int(),
  segmentStartSeq: z.number().int().nonnegative().optional(),
  workerId: id,
  status: z.enum(["completed", "failed", "stopped", "deleted"]),
  completionIds: z.array(id),
  lastResultMessageId: id.optional(),
  lastResultSeq: z.number().int().optional(),
  summary: z.string().optional(),
});
export const recordSchema = z.object({
  project: projectSchema,
  workers: z.array(workerSchema),
  assignments: z.array(assignmentSchema),
  completions: z.array(completionSchema),
  deliveries: z.array(deliverySchema),
  memberships: z.array(membershipSchema),
  outcomes: z.array(outcomeSchema),
  operations: z.record(z.string(), z.json()),
  toggles: z.record(z.string(), z.number()),
  reminders: z.record(z.string(), z.boolean()).default({}),
});
/** Persisted Project aggregate; execution remains in native Session history. */
export type RecordState = z.infer<typeof recordSchema>;
/** One ended native Worker turn and its canonical final assistant payload. */
export type Completion = z.infer<typeof completionSchema>;
/** Project membership record, independent of a Worker's live execution status. */
export type Worker = z.infer<typeof workerSchema>;
export const domainSpec = defineDomain({
  name: "project_mode",
  version: 1,
  tables: { projects: domainTable(recordSchema) },
});

const finishedSchema = z.object({
  turn: z.number().int(),
  seq: z.number().int(),
  reason: z.enum(["completed", "aborted", "error", "max-tokens", "refusal"]),
  time: z.number(),
  messageIds: z.array(id),
  lastAssistant: assistantSchema.optional(),
});
export const projectionSchema = z.object({
  turn: z.number().int(),
  inheritedEventCount: z.number().int().nonnegative().default(0),
  segmentStartSeq: z.number().int().nonnegative().default(0),
  lastSeq: z.number().int().nonnegative().default(0),
  resultAnchors: z
    .record(
      z.string(),
      z.object({
        coordinatorTurn: z.number().int(),
        segmentStartSeq: z.number().int().nonnegative(),
        participationSeq: z.number().int().nonnegative(),
      }),
    )
    .default({}),
  messageIds: z.array(id),
  handoffMessageIds: z.array(id).default([]),
  lastAssistant: assistantSchema.optional(),
  finished: z.array(finishedSchema),
  consumed: z.array(id),
});
export type Projection = z.infer<typeof projectionSchema>;
declare module "@deepseek-ai/dsh-session-projection/types" {
  interface SessionProjectionStateMap {
    "project-mode-results": Projection;
  }
}
export const projection: ProjectionDefinition<
  "project-mode-results",
  Projection
> = {
  key: "project-mode-results",
  stateVersion: 4,
  stateSchema: projectionSchema,
  init: (_header, inheritedEventCount) => ({
    turn: 0,
    inheritedEventCount,
    segmentStartSeq: 0,
    lastSeq: 0,
    resultAnchors: {},
    messageIds: [],
    handoffMessageIds: [],
    finished: [],
    consumed: [],
  }),
  apply(state, event) {
    if (event.seq < state.inheritedEventCount) return state;
    switch (event.type) {
      case "turn/start":
        return {
          ...state,
          lastSeq: event.seq,
          turn: event.data.turn,
          segmentStartSeq: event.seq,
          messageIds: state.handoffMessageIds,
          lastAssistant: undefined,
        };
      case "user/message":
        return {
          ...state,
          lastSeq: event.seq,
          messageIds: [...state.messageIds, event.data.id],
          consumed: [...state.consumed, event.data.id],
          ...(event.data.source.kind === "user" && event.surfaceOp === "append"
            ? { segmentStartSeq: event.seq }
            : {}),
          ...(event.data.source.kind === "project-mode-result"
            ? {
                resultAnchors: {
                  ...state.resultAnchors,
                  [event.data.id]: {
                    coordinatorTurn: state.turn,
                    segmentStartSeq: state.segmentStartSeq,
                    participationSeq: event.seq,
                  },
                },
              }
            : {}),
        };
      case "assistant/message":
        return event.data.turn !== state.turn
          ? state
          : {
              ...state,
              lastSeq: event.seq,
              lastAssistant: {
                messageId: event.data.message.id,
                seq: event.seq,
                content: event.data.message.content,
              },
            };
      case "turn/end":
        if (event.data.reason.kind === "handoff")
          return {
            ...state,
            lastSeq: event.seq,
            handoffMessageIds: state.messageIds,
          };
        return {
          ...state,
          lastSeq: event.seq,
          handoffMessageIds: [],
          finished: [
            ...state.finished,
            {
              turn: event.data.turn,
              seq: event.seq,
              time: event.time,
              reason: normalizeReason(event.data.reason.kind),
              messageIds: state.messageIds,
              ...(state.lastAssistant
                ? { lastAssistant: state.lastAssistant }
                : {}),
            },
          ],
        };
      case "step/start":
      case "tool/call":
      case "tool/result":
        return { ...state, lastSeq: event.seq };
      default:
        return state;
    }
  },
};

export function normalizeReason(kind: string): Completion["outcome"] {
  return kind === "completed" || kind === "max-tokens" || kind === "error"
    ? kind
    : kind === "blocked"
      ? "refusal"
      : "aborted";
}
