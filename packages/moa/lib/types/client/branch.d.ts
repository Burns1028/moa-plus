import * as React from "react";
import type { Context } from "@deepseek-ai/cordis";
import type { PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { SessionTarget } from "@deepseek-ai/dsh-api-session-controller/client";
import type { MoAClient } from "./runtime.ts";
type BranchProps = PropsRuntime<"sidebar.workspaces.session.branch"> & PropsLocale<"project-mode"> & {
    matched: {
        coordinator: true;
    };
    client: MoAClient;
    open: (target: SessionTarget) => void;
};
/** Add only the disclosure and children; DSH renders every row and the browser. */
export declare function MoABranch(p: BranchProps): string | number | boolean | React.JSX.Element | Iterable<React.ReactNode> | null | undefined;
/** Capture immutable routing facts; a selector never reads an external store. */
export declare function bindMoABranches(ctx: Context, client: MoAClient, open: BranchProps["open"]): () => void;
export {};
