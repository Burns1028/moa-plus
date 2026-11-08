import type { Context } from "@deepseek-ai/cordis";
import type { Agent, BackgroundReceipt } from "@deepseek-ai/dsh-agent";
import { type UserMessage } from "@deepseek-ai/dsh-llm";
import type { ToolExecutionResult } from "@deepseek-ai/dsh-tools";
import type { JobView } from "@deepseek-ai/dsh-jobs/view";
import type { Config } from "../config.ts";
export interface BackgroundResultData {
    readonly receipt: BackgroundReceipt;
    readonly job?: JobView;
    readonly result: Pick<ToolExecutionResult, "content" | "isError" | "error" | "meta">;
    readonly additionalContexts: readonly UserMessage[];
    readonly delivery: UserMessage;
}
declare module "@deepseek-ai/dsh-session/types" {
    interface SessionEventMap {
        "moa/background-result": BackgroundResultData;
    }
}
declare module "@deepseek-ai/dsh-llm" {
    interface MessageSourceMap {
        "moa-background-result": {
            kind: "moa-background-result";
            tool_call_id: string;
        };
    }
}
declare module "@deepseek-ai/dsh-jobs/view" {
    interface JobKindMap {
        "moa-tool": "moa-tool";
    }
}
export declare const backgroundHandle: (receipt: Pick<BackgroundReceipt, "owner" | "callSeq">) => string;
/** Install policy and receipts on one native owner; the loop retains all execution ownership. */
export declare function bindBackground(ctx: Context, agent: Agent, config: Pick<Config, "backgroundStrategy" | "backgroundAfterSeconds">): Promise<() => Promise<void>>;
