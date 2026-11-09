import * as React from "react";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { SessionTarget } from "@deepseek-ai/dsh-api-session-controller/client";
import type { MoAKey } from "./locales.ts";
import type { MoAClient } from "./runtime.ts";
export type Translator = (key: MoAKey, args?: Record<string, string | number>) => string;
export interface SharedProps {
    client: MoAClient;
    open: (target: SessionTarget) => void;
    t: Translator;
}
export declare function WorkerCapsuleList({ client, sessionId, turn, closed, segmentStartSeq, open, t, }: SharedProps & {
    sessionId: SessionId;
    turn: number;
    closed: boolean;
    segmentStartSeq?: number;
}): React.JSX.Element | null;
export declare function MoAToggle({ client, sessionId, running, open, t, }: SharedProps & {
    sessionId: SessionId;
    running: boolean;
}): React.JSX.Element;
