import * as React from "react";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { SessionTarget } from "@deepseek-ai/dsh-api-session-controller/client";
import type { ProjectKey } from "./locales.ts";
import type { ProjectClient } from "./runtime.ts";
export type Translator = (key: ProjectKey, args?: Record<string, string | number>) => string;
export interface SharedProps {
    client: ProjectClient;
    open: (target: SessionTarget) => void;
    t: Translator;
}
export declare function WorkerCapsuleList({ client, sessionId, turn, closed, segmentStartSeq, open, t, }: SharedProps & {
    sessionId: SessionId;
    turn: number;
    closed: boolean;
    segmentStartSeq?: number;
}): React.JSX.Element | null;
export declare function ProjectToggle({ client, sessionId, running, buttonRef, guideDescriptionId, open, t, }: SharedProps & {
    sessionId: SessionId;
    running: boolean;
    buttonRef?: React.Ref<HTMLButtonElement>;
    guideDescriptionId?: string;
}): React.JSX.Element;
