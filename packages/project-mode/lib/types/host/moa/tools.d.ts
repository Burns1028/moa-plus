import type { MoAAgents } from "./agents.ts";
import { type MoAMessageBroker } from "./messages.ts";
export declare function createTeamObserver(agents: MoAAgents): import("@deepseek-ai/dsh-tools").ToolDefinition;
export declare function createWorkStopper(agents: MoAAgents): import("@deepseek-ai/dsh-tools").ToolDefinition;
export declare function createWorkDispatcher(agents: MoAAgents): import("@deepseek-ai/dsh-tools").ToolDefinition;
export declare function createContextBrancher(agents: MoAAgents): import("@deepseek-ai/dsh-tools").ToolDefinition;
export declare function createSharedContextAccess(agents: MoAAgents): import("@deepseek-ai/dsh-tools").ToolDefinition;
export declare function createPeerMessenger(broker: MoAMessageBroker): import("@deepseek-ai/dsh-tools").ToolDefinition;
