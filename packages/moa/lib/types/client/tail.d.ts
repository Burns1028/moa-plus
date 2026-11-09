import type { ConversationNodeDefinition } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { ChatNode, ChatSnapshot } from "@deepseek-ai/dsh-client-ui-chat/client";
import type { TurnWorkerMembership } from "../shared/index.ts";
declare module "@deepseek-ai/dsh-client-ui-chat/client" {
    interface ChatNodeDataMap {
        "project-mode-workers-tail": {
            turn: number;
            step: number;
            segmentStartSeq: number;
        };
    }
}
/** Human inputs split transcript placement without changing the native turn. */
export declare const humanBoundaryDefinition: ConversationNodeDefinition<{
    seq: number;
}>;
/**
 * A native step owns its own tail seat. Later steps never move an earlier seat
 * across a human message. Empty seats are hidden by native Chat layout.
 */
export declare const workerTailDefinition: ConversationNodeDefinition<{
    seq: number;
    segmentStartSeq: number;
}>;
/** Pick exactly one native seat at the bottom of each human transcript segment. */
export declare function segmentTail(snapshot: ChatSnapshot, node: ChatNode<"project-mode-workers-tail">): {
    turn: number;
    segmentStartSeq: number;
    closed: boolean;
} | null;
/**
 * An unknown history prefix is never a wildcard segment. Load the canonical
 * boundary and every intervening native event before deciding placement: an
 * unloaded passive human message may separate the seat from an older worker.
 */
export declare function segmentHistoryTarget(snapshot: ChatSnapshot, node: ChatNode<"project-mode-workers-tail">, memberships: readonly TurnWorkerMembership[]): number | undefined;
