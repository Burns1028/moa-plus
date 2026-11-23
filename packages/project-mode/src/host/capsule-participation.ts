import type { RecordState } from "./state.ts";

/** Handoff preserves a seat; only that seat's real assignments can finish it. */
export function settleContinuedOutcomes(record: RecordState): RecordState {
  let changed = false;
  const outcomes = record.outcomes.map((outcome) => {
    if (outcome.status !== "continued") return outcome;
    const assignments = record.assignments.filter((assignment) =>
      assignment.workerId === outcome.workerId &&
      assignment.coordinatorTurn === outcome.coordinatorTurn &&
      assignment.segmentStartSeq === outcome.segmentStartSeq &&
      assignment.admission !== "rejected",
    );
    const completed = record.completions.filter((completion) =>
      completion.workerId === outcome.workerId &&
      (outcome.completionIds.includes(completion.id) || completion.assignmentIds.some((id) => assignments.some((assignment) => assignment.id === id))),
    );
    if (!completed.length || assignments.some((assignment) => !completed.some((completion) => completion.assignmentIds.includes(assignment.id)))) return outcome;
    const last = completed.at(-1)!;
    changed = true;
    return {
      ...outcome,
      status: last.outcome === "completed" ? "completed" as const : last.outcome === "aborted" ? "stopped" as const : "failed" as const,
      completionIds: completed.map((completion) => completion.id),
      ...(last.lastAssistant ? { lastResultMessageId: last.lastAssistant.messageId, lastResultSeq: last.lastAssistant.seq } : {}),
    };
  });
  return changed ? { ...record, outcomes } : record;
}

export interface CapsuleAnchor {
  coordinatorTurn: number;
  segmentStartSeq: number;
  participationSeq: number;
}
/** Existing tool operation identity carries the committed root call's seq. */
export function nativeOperationSeq(
  operationId: string,
  sessionId: string,
): number | undefined {
  if (!operationId.startsWith("tool:")) return undefined;
  let identity: unknown;
  try {
    identity = JSON.parse(operationId.slice(5));
  } catch {
    return undefined;
  }
  return Array.isArray(identity) &&
    identity[0] === sessionId &&
    Number.isSafeInteger(identity[1]) &&
    identity[1] >= 0
    ? identity[1]
    : undefined;
}
/** Only accepted assignments and canonical received results establish participation. */
export function participatingMemberships(
  record: RecordState,
  workerId: string,
  anchor: CapsuleAnchor,
  kind: "spawn" | "send" | "result",
  identity: string,
  completionId?: string,
): RecordState["memberships"] {
  const existing = record.memberships.find(
    (m) =>
      m.workerId === workerId &&
      m.coordinatorTurn === anchor.coordinatorTurn &&
      m.segmentStartSeq === anchor.segmentStartSeq,
  );
  if (existing) {
    if (!completionId || existing.completionIds?.includes(completionId))
      return record.memberships;
    return record.memberships.map((m) =>
      m === existing
        ? { ...m, completionIds: [...(m.completionIds ?? []), completionId] }
        : m,
    );
  }
  return [
    ...record.memberships,
    {
      projectId: record.project.id,
      coordinatorSessionId: record.project.coordinatorSessionId,
      ...anchor,
      workerId,
      participationKind: kind,
      ...(completionId ? { completionIds: [completionId] } : {}),
      firstOperationId: identity,
      firstCallId: identity,
      order: record.memberships.length,
    },
  ];
}

/** Repair old records only from canonical coordinator dispatch/result evidence. */
export function repairCapsuleOwnership(
  record: RecordState,
  events: readonly import("@deepseek-ai/dsh-session").SessionEvent[],
): RecordState {
  const anchors = new Map<number, CapsuleAnchor>();
  const closedTurns = new Map<
    number,
    import("@deepseek-ai/dsh-session").SessionEvent<"turn/end">
  >();
  const results: {
    workerId: string;
    completionId: string;
    anchor: CapsuleAnchor;
  }[] = [];
  let coordinatorTurn = 0,
    segmentStartSeq = 0;
  for (const event of events) {
    if (event.type === "turn/start") {
      coordinatorTurn = event.data.turn;
      segmentStartSeq = event.seq;
    }
    if (
      event.type === "user/message" &&
      event.data.source.kind === "user" &&
      event.surfaceOp === "append"
    )
      segmentStartSeq = event.seq;
    const anchor = {
      coordinatorTurn,
      segmentStartSeq,
      participationSeq: event.seq,
    };
    if (event.type === "tool/call") anchors.set(event.seq, anchor);
    if (event.type === "turn/end") closedTurns.set(event.data.turn, event);
    if (
      event.type === "user/message" &&
      event.data.source.kind === "project-mode-result"
    )
      results.push({
        workerId: event.data.source.workerId,
        completionId: event.data.source.completionId,
        anchor,
      });
  }
  const assignments = record.assignments.map((assignment) => {
    if (
      assignment.segmentStartSeq !== undefined ||
      !assignment.operationId.startsWith("tool:")
    )
      return assignment;
    const seq = nativeOperationSeq(
      assignment.operationId,
      record.project.coordinatorSessionId,
    );
    const anchor = seq === undefined ? undefined : anchors.get(seq);
    if (!anchor || anchor.coordinatorTurn !== assignment.coordinatorTurn)
      return assignment;
    return {
      ...assignment,
      ...anchor,
      participationKind: record.workers.some(
        (w) =>
          w.id === assignment.workerId &&
          w.creationOperationId === assignment.operationId,
      )
        ? ("spawn" as const)
        : ("send" as const),
    };
  });
  let repaired: RecordState = {
    ...record,
    assignments,
    memberships: record.memberships.filter(
      (m) =>
        m.segmentStartSeq !== undefined ||
        !assignments.some(
          (a) =>
            a.operationId === m.firstOperationId &&
            a.segmentStartSeq !== undefined,
        ),
    ),
  };
  for (const assignment of assignments) {
    if (
      assignment.admission !== "accepted" ||
      assignment.segmentStartSeq === undefined ||
      assignment.participationSeq === undefined
    )
      continue;
    repaired = {
      ...repaired,
      memberships: participatingMemberships(
        repaired,
        assignment.workerId,
        {
          coordinatorTurn: assignment.coordinatorTurn,
          segmentStartSeq: assignment.segmentStartSeq,
          participationSeq: assignment.participationSeq,
        },
        assignment.participationKind ?? "send",
        assignment.operationId,
      ),
    };
  }
  for (const result of results) {
    if (
      !record.completions.some(
        (c) => c.id === result.completionId && c.workerId === result.workerId,
      )
    )
      continue;
    repaired = {
      ...repaired,
      memberships: participatingMemberships(
        repaired,
        result.workerId,
        result.anchor,
        "result",
        `result:${result.completionId}`,
        result.completionId,
      ),
    };
  }
  repaired = {
    ...repaired,
    outcomes: record.outcomes.flatMap((outcome) => {
      if (outcome.segmentStartSeq !== undefined) return [outcome];
      const memberships = repaired.memberships.filter(
        (m) =>
          m.workerId === outcome.workerId &&
          m.coordinatorTurn === outcome.coordinatorTurn &&
          m.segmentStartSeq !== undefined,
      );
      return memberships.length
        ? memberships.map((m) => ({
            ...outcome,
            segmentStartSeq: m.segmentStartSeq,
          }))
        : [outcome];
    }),
  };
  const outcomes = [...repaired.outcomes];
  for (const membership of repaired.memberships) {
    const closing = closedTurns.get(membership.coordinatorTurn);
    if (
      !closing ||
      membership.segmentStartSeq === undefined ||
      membership.participationSeq === undefined ||
      membership.participationSeq > closing.seq ||
      outcomes.some(
        (outcome) =>
          outcome.coordinatorTurn === membership.coordinatorTurn &&
          outcome.workerId === membership.workerId &&
          outcome.segmentStartSeq === membership.segmentStartSeq,
      )
    )
      continue;

    // A later completion cannot rewrite an ordinarily closed turn. Handoff seats
    // remain continued and are settled separately against their own assignments.
    // Only canonical coordinator receipts before this turn/end can contribute
    // result status or assistant-message metadata to the recovered outcome.
    const receipts = results.filter(
      (result) =>
        result.workerId === membership.workerId &&
        result.anchor.coordinatorTurn === membership.coordinatorTurn &&
        result.anchor.participationSeq < closing.seq,
    );
    const receiptSeqs = new Map(
      receipts.map((result) => [
        result.completionId,
        result.anchor.participationSeq,
      ]),
    );
    const segmentResultIds = new Set(
      receipts
        .filter(
          (result) =>
            result.anchor.segmentStartSeq === membership.segmentStartSeq,
        )
        .map((result) => result.completionId),
    );
    const assignments = repaired.assignments.filter(
      (assignment) =>
        assignment.workerId === membership.workerId &&
        assignment.coordinatorTurn === membership.coordinatorTurn &&
        assignment.segmentStartSeq === membership.segmentStartSeq &&
        assignment.admission !== "rejected" &&
        assignment.participationSeq !== undefined &&
        assignment.participationSeq < closing.seq,
    );
    const completed = repaired.completions
      .filter(
        (completion) =>
          completion.workerId === membership.workerId &&
          receiptSeqs.has(completion.id) &&
          (segmentResultIds.has(completion.id) ||
            completion.assignmentIds.some((id) =>
              assignments.some((assignment) => assignment.id === id),
            )),
      )
      .sort((a, b) => receiptSeqs.get(a.id)! - receiptSeqs.get(b.id)!);
    const last = completed.at(-1),
      pending = assignments.some(
        (assignment) =>
          !completed.some((completion) =>
            completion.assignmentIds.includes(assignment.id),
          ),
      );
    const continued = closing.data.reason.kind === "handoff" && (pending || !last);
    const interrupted = closing.data.reason.kind !== "completed" && closing.data.reason.kind !== "handoff" || pending;
    outcomes.push({
      coordinatorSessionId: membership.coordinatorSessionId,
      coordinatorTurn: membership.coordinatorTurn,
      segmentStartSeq: membership.segmentStartSeq,
      workerId: membership.workerId,
      status: continued
        ? "continued"
        : interrupted
        ? "stopped"
        : last?.outcome === "completed"
          ? "completed"
          : last?.outcome === "aborted"
            ? "stopped"
            : "failed",
      completionIds: completed.map((completion) => completion.id),
      ...(interrupted && !continued
        ? { summary: "Coordinator turn interrupted; worker work may continue." }
        : {}),
      ...(last?.lastAssistant
        ? {
            lastResultMessageId: last.lastAssistant.messageId,
            lastResultSeq: last.lastAssistant.seq,
          }
        : {}),
    });
  }
  repaired = settleContinuedOutcomes({ ...repaired, outcomes });
  return JSON.stringify(repaired) === JSON.stringify(record)
    ? record
    : repaired;
}
