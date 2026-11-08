import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { ProjectPaths } from "../shared/index.ts";
import type { HostAccess } from "./host-access.ts";
declare module "@deepseek-ai/dsh-llm" {
    interface MessageSourceMap {
        "moa-notes": {
            kind: "moa-notes";
            coordinatorSessionId: string;
        };
    }
}
export declare function memoryPaths(root: string): ProjectPaths & {
    index: string;
};
export declare function notesInjection(text: string): string;
export interface MoAIdentity {
    id: string;
    workdir: string;
    isolated: boolean;
    reportTo: string;
    reportingInstructions: string;
}
/** Identity is dialogue content; it never personalizes the system prompt. */
export declare function identityMessage(identity: MoAIdentity): string;
export declare const contextIndexTemplate = "# Project context\n\nRead this shared index first, then open only the context files needed for the task. Coordinator and Workers maintain reusable project knowledge here. Workers contribute valuable reusable findings; the Coordinator primarily organizes, consolidates and prunes context. Keep each entry's path and short description current.\n\n## Context files\n";
export declare const contextIndexPath: (paths: ProjectPaths) => string;
export declare function readNotes(ctx: Context, agent: Agent, project: {
    workspacePath: string;
    paths: ProjectPaths;
}, signal: AbortSignal): Promise<string>;
/** Backfill only a missing index through the acting Agent's native filesystem. */
export declare function ensureContextIndex(ctx: Context, agent: Agent, project: {
    workspacePath: string;
    paths: ProjectPaths;
}, signal: AbortSignal): Promise<void>;
/** Native admission owns the history commit; unchanged notes still reach each inference. */
export declare function bindProjectMemory(host: HostAccess): void;
