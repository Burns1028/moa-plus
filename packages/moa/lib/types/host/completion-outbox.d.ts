import { SessionId } from "@deepseek-ai/dsh-session";
import type { HostAccess } from "./host-access.ts";
/** Serializes result collection and durable native inbox admission. */
export declare class CompletionOutbox {
    private host;
    readonly normalizing: Set<SessionId>;
    readonly workerCuts: Map<SessionId, {
        turn: number;
        segmentStartSeq: number;
        lastSeq: number;
        resultAnchors: Record<string, {
            coordinatorTurn: number;
            segmentStartSeq: number;
            participationSeq: number;
        }>;
        messageIds: string[];
        finished: {
            turn: number;
            seq: number;
            reason: "error" | "completed" | "aborted" | "max-tokens" | "refusal";
            time: number;
            messageIds: string[];
            lastAssistant?: {
                messageId: string;
                seq: number;
                content: readonly import("@deepseek-ai/dsh-llm").ContentBlock[];
            } | undefined;
        }[];
        consumed: string[];
        lastAssistant?: {
            messageId: string;
            seq: number;
            content: readonly import("@deepseek-ai/dsh-llm").ContentBlock[];
        } | undefined;
    }>;
    readonly claimed: Map<SessionId, Set<string>>;
    private ingestions;
    private admissions;
    private retries;
    constructor(host: HostAccess);
    dispose(): void;
    ingest(workerId: SessionId): Promise<void>;
    private ingestCompletion;
    consume(parentId: SessionId, messageId: string): Promise<void>;
    deliver(parentId: SessionId): Promise<void>;
    private admitDeliveries;
}
