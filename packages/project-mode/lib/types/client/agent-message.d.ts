import * as React from "react";
import type { SharedProps } from "./components.tsx";
import type { IncomingAgentMessage } from "./tail.ts";
/** The same incoming message row is used in Coordinator and Worker conversations. */
export declare function AgentMessage({ message, client, t }: Pick<SharedProps, "client" | "t"> & {
    message: IncomingAgentMessage;
}): React.JSX.Element;
