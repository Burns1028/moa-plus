import type { MoASnapshot } from "../shared/index.ts";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { MoAClient } from "./runtime.ts";
export declare function moaForSession(client: MoAClient, id: SessionId): MoASnapshot | undefined;
export declare function workerReadOnly(projects: readonly MoASnapshot[], id: SessionId): {
    parent: SessionId;
    reason: "disabled" | "deleted";
} | undefined;
export interface ComposerMatch {
    id: SessionId;
    parent: SessionId;
    reason: "deleted" | "disabled" | "pending" | "unavailable";
}
/** A known continuation must establish ownership before enabling its input. */
export declare function composerMatch(owner: import("@deepseek-ai/dsh-client-ui-conversation/client").ComposerChainProps, client: import("./runtime.ts").MoAClient): ComposerMatch | null;
