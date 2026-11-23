import type { RecordState } from "./state.ts";
/** Handoff preserves a seat; only that seat's real assignments can finish it. */
export declare function settleContinuedOutcomes(record: RecordState): RecordState;
export interface CapsuleAnchor {
    coordinatorTurn: number;
    segmentStartSeq: number;
    participationSeq: number;
}
/** Existing tool operation identity carries the committed root call's seq. */
export declare function nativeOperationSeq(operationId: string, sessionId: string): number | undefined;
/** Only accepted assignments and canonical received results establish participation. */
export declare function participatingMemberships(record: RecordState, workerId: string, anchor: CapsuleAnchor, kind: "spawn" | "send" | "result", identity: string, completionId?: string): RecordState["memberships"];
/** Repair old records only from canonical coordinator dispatch/result evidence. */
export declare function repairCapsuleOwnership(record: RecordState, events: readonly import("@deepseek-ai/dsh-session").SessionEvent[]): RecordState;
