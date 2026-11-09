import type { SessionController } from "@deepseek-ai/dsh-api-session-controller";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { SessionId } from "@deepseek-ai/dsh-session";
export { queueHostSubagentPrompt, steerHostSubagentPrompt, } from "@deepseek-ai/dsh-subagent/internal";
import type { Context } from "@deepseek-ai/cordis";
import type { Session } from "@deepseek-ai/dsh-session";
import { type Projection } from "./state.ts";
export declare function registerProjection(ctx: Context): Promise<void>;
export declare function projected(ctx: Context, session: Session): Projection;
/** Stop only this observer's wait; shared work keeps its own lifetime. */
export declare function waitForTurn<T>(work: Promise<T>, signal: AbortSignal, disposeLate?: (value: T) => void): Promise<T>;
/** A backend may finish after cancellation; release its observation lease too. */
export declare function observeForTurn(ctx: Context, id: SessionId, signal?: AbortSignal): Promise<import("@deepseek-ai/dsh-session-query").SessionObservation>;
export declare function abortableChange(listeners: Set<() => void>, signal: AbortSignal): Promise<void>;
/** ToolCallId can repeat across turns; the committed root call is the identity boundary. */
export declare function toolOperationId(exec: import("@deepseek-ai/dsh-tools").ToolRunContext): string;
/** Published rc.3 failures whose native throw sites precede inbox acceptance.
 * Generic failures, cancellation and catalog/flush failures remain uncertain.
 * DUPLICATE_CHILD is intentionally excluded: its reserved identity needs reconciliation.
 */
export declare function nativeAdmissionRejection(error: unknown): {
    code: string;
    message: string;
} | undefined;
/** Public Host resolver. The native service key is sessionController, not its Remote namespace. */
export declare function ordinarySessionResolver(ctx: Context): Pick<SessionController, "resolveAgent"> | undefined;
/** Preserve native ownership/domain failures; this never admits model input. */
export declare function resolveOrdinaryAgent(ctx: Context, sessionId: SessionId): Promise<Agent | undefined>;
/** Refuse a partial rc.3 installation before installing MOA execution policy. */
export declare function requireNativeBackground(ctx: Context, agent: Agent): import("@deepseek-ai/dsh-jobs").JobRegistry;
