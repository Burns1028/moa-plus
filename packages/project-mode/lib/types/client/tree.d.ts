import type { ProjectSnapshot } from "../shared/index.ts";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { ProjectClient } from "./runtime.ts";
export declare function projectForSession(client: ProjectClient, id: SessionId): ProjectSnapshot | undefined;
export declare function workerReadOnly(projects: readonly ProjectSnapshot[], id: SessionId): {
    parent: SessionId;
    reason: "disabled" | "deleted";
} | undefined;
export interface ComposerMatch {
    id: SessionId;
    parent: SessionId;
    reason: "deleted" | "disabled";
}
/** Override native input only for established, inactive Project membership. */
export declare function composerMatch(owner: import("@deepseek-ai/dsh-client-ui-conversation/client").ComposerChainProps, client: import("./runtime.ts").ProjectClient): ComposerMatch | null;
