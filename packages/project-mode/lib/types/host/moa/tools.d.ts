import type { MoAAgents } from "./agents.ts";
import { type MoAMessageBroker } from "./messages.ts";
export declare function createQueryAgentTool(agents: MoAAgents): import("@deepseek-ai/dsh-tools").ToolDefinition;
export declare function createKillAgentTool(agents: MoAAgents): import("@deepseek-ai/dsh-tools").ToolDefinition;
export declare function createTaskTool(agents: MoAAgents): import("@deepseek-ai/dsh-tools").ToolDefinition;
export declare function createForkTool(agents: MoAAgents): import("@deepseek-ai/dsh-tools").ToolDefinition;
export declare function createProjectContextTool(agents: MoAAgents): import("@deepseek-ai/dsh-tools").ToolDefinition;
export declare function createSendMessageTool(broker: MoAMessageBroker): import("@deepseek-ai/dsh-tools").ToolDefinition;
