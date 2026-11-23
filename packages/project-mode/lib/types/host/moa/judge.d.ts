import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { type UserMessage } from "@deepseek-ai/dsh-llm";
export interface InterruptContext {
    kind: "request" | "background";
    description: string;
    elapsedSeconds?: number;
    tool?: {
        name: string;
        arguments: unknown;
    };
}
/** Inspect a complete unread batch without consuming it or starting another Agent. */
export declare function judgeInterrupt(ctx: Context, agent: Agent, messages: readonly UserMessage[], context: InterruptContext, signal: AbortSignal): Promise<boolean>;
