import * as React from "react";
import type { PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { MoARemote } from "./compat.ts";
import type { SharedProps } from "./components.tsx";
export type WorkersPanelProps = PropsRuntime<"sidebar.right.pane.tab"> & PropsLocale<"project-mode"> & SharedProps & {
    timeline: MoARemote["timeline"];
};
export declare function WorkersPanel({ client, open, timeline, sessionId, useTabInfo, t, }: WorkersPanelProps): React.JSX.Element;
