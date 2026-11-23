import type { Agent } from "@deepseek-ai/dsh-agent";
import type { HostAccess } from "../host-access.ts";
declare module "@deepseek-ai/dsh-llm" {
    interface MessageSourceMap {
        "moa-completion": {
            kind: "moa-completion";
            form: "notice";
            summary: string;
        };
    }
}
/** Bind to native pre-step and candidate-end events after the existing turn guard. */
export declare function bindDeliveryReview(host: HostAccess): (agent: Agent) => void;
