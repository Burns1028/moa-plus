import type { ISessions } from "@deepseek-ai/dsh-api-session-controller/client";
import type { ProjectClient } from "./runtime.ts";
declare module "@deepseek-ai/dsh-api-session-controller/client" {
    interface SessionReferenceSourceMap {
        projectModeParent: unknown;
    }
}
/** Native child input needs its parent Agent; opening the parent restores it without a prompt. */
export declare function bindWorkerParents(client: ProjectClient, sessions: ISessions): () => void;
