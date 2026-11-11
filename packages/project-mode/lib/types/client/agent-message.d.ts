import * as React from "react";
import type { SharedProps } from "./components.tsx";
import type { IncomingAgentMessage } from "./tail.ts";
/** Internal correspondence belongs to the native process, not a user bubble. */
export declare function AgentMessage({ message, client, t, settled, }: Pick<SharedProps, "client" | "t"> & {
    message: IncomingAgentMessage;
    settled?: boolean;
}): React.JSX.Element;
