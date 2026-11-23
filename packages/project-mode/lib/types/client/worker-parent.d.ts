import type { ISessions } from "@deepseek-ai/dsh-api-session-controller/client";
import type { ProjectClient } from "./runtime.ts";
declare module "@deepseek-ai/dsh-api-session-controller/client" {
    interface SessionReferenceSourceMap {
        projectModeParent: unknown;
    }
}
/** Visible Worker input retains its exact native Session and real parent chain. */
export declare function bindWorkerParents(client: ProjectClient, sessions: ISessions): () => void;
