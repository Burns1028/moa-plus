import { defineTool } from "@deepseek-ai/dsh-tools";
import { SessionId } from "@deepseek-ai/dsh-session";
import { z } from "zod";
import type { MoAAgents } from "./agents.ts";
import { toolOperationId } from "../native.ts";

const output = {
  schema: { type: "string" as const },
  render: (_args: unknown, value: string) => [
    { type: "text" as const, text: value },
  ],
};
const querySchema = z
  .object({
    ids: z.array(z.string().min(1)).optional(),
    wait: z.enum(["all", "selected"]).optional(),
    timeout_ms: z.number().int().positive().optional(),
    history_offset: z.number().int().nonnegative().optional(),
    history_limit: z.number().int().nonnegative().optional(),
  })
  .refine(
    (value) =>
      (value.history_offset === undefined) ===
      (value.history_limit === undefined),
    "history_offset and history_limit must be supplied together",
  );
export function createQueryAgentTool(agents: MoAAgents) {
  return defineTool({
    name: "QueryAgent",
    description:
      "Inspect direct child status, optionally read a newest-relative history window or wait for completion, input or timeout.",
    parameters: {
      ids: {
        type: "array",
        items: { type: "string" },
        description: "Direct child IDs; omit for all",
      },
      wait: {
        type: "string",
        enum: ["all", "selected"],
        description: "Wait for all or selected children",
      },
      timeout_ms: {
        type: "integer",
        description: "Wait timeout in milliseconds",
      },
      history_offset: {
        type: "integer",
        description: "Newest-relative message offset",
      },
      history_limit: {
        type: "integer",
        description: "Number of human and AI messages",
      },
    },
    output,
    async execute(args, exec) {
      if (!exec.agent) throw new Error("moa/agent-required");
      const input = querySchema.parse(args);
      return JSON.stringify(
        await agents.query(
          exec.agent,
          {
            ids: input.ids,
            wait: input.wait,
            timeoutMs: input.timeout_ms,
            ...(input.history_offset === undefined
              ? {}
              : {
                  history: {
                    offset: input.history_offset,
                    limit: input.history_limit!,
                  },
                }),
          },
          exec.signal,
        ),
      );
    },
  });
}
export function createKillAgentTool(agents: MoAAgents) {
  return defineTool({
    name: "KillAgent",
    description:
      "Stop and join a direct child, retaining history and workspace by default. continue_with changes direction after cleanup; destroy removes it from MoA and cleans its owned isolated workspace.",
    parameters: {
      id: { type: "string", required: true, description: "Direct child ID" },
      destroy: {
        type: "boolean",
        description: "Delete membership and clean the owned isolated worktree",
      },
      continue_with: {
        type: "string",
        description:
          "New instruction admitted only after the old execution exits",
      },
    },
    output,
    async execute(args, exec) {
      if (!exec.agent) throw new Error("moa/agent-required");
      const input = z
        .object({
          id: z.string().min(1),
          destroy: z.boolean().optional(),
          continue_with: z.string().min(1).optional(),
        })
        .parse(args);
      return JSON.stringify(
        await agents.kill(exec.agent, SessionId(input.id), exec.signal, {
          destroy: input.destroy,
          continueWith: input.continue_with,
          operationId: toolOperationId(exec),
        }),
      );
    },
  });
}

const taskSchema = z.object({
  tasks: z
    .array(
      z.object({
        name: z.string().min(1),
        task: z.string().min(1),
        role: z.enum([
          "Explorer",
          "Planner",
          "Deep Research",
          "General-purpose",
        ]),
        workspace: z.enum(["shared", "isolated"]).optional(),
        reportTo: z.string().min(1).optional(),
        nested: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(20),
});
const roleDescription =
  "Explorer and Planner use glob, grep and read (no Bash). Deep Research uses web_search and web_fetch. General-purpose retains native execution tools for running commands, editing files, builds and tests.";
export function createTaskTool(agents: MoAAgents) {
  return defineTool({
    name: "Task",
    description:
      "Start up to 20 clean-history agents. Isolated workspaces are the default; explicitly select shared when needed.",
    parameters: {
      tasks: {
        type: "array",
        required: true,
        description: "Agents to start",
        items: {
          type: "object",
          properties: {
            name: { type: "string", required: true },
            task: { type: "string", required: true },
            role: {
              type: "string",
              required: true,
              enum: ["Explorer", "Planner", "Deep Research", "General-purpose"],
              description: roleDescription,
            },
            workspace: { type: "string", enum: ["shared", "isolated"] },
            reportTo: {
              type: "string",
              description: "Existing MoA session ID; omit to report to the creating Agent",
            },
            nested: { type: "boolean" },
          },
          additionalProperties: false,
        },
      },
    },
    output,
    async execute(args, exec) {
      if (!exec.agent) throw new Error("moa/agent-required");
      return JSON.stringify(
        await agents.task(
          exec.agent,
          taskSchema.parse(args).tasks,
          toolOperationId(exec),
          exec.signal,
        ),
      );
    },
  });
}

export function createForkTool(agents: MoAAgents) {
  return defineTool({
    name: "Fork",
    description:
      "Create a new agent from a selected project member's committed conversation history with a fresh identity.",
    parameters: {
      source: {
        type: "string",
        required: true,
        description: "Source agent session ID",
      },
      name: { type: "string", required: true },
      task: { type: "string", required: true },
      role: {
        type: "string",
        required: true,
        enum: ["Explorer", "Planner", "Deep Research", "General-purpose"],
        description: roleDescription,
      },
      workspace: { type: "string", enum: ["shared", "isolated"] },
      reportTo: {
        type: "string",
        description: "Existing MoA session ID; omit to report to the creating Agent",
      },
      nested: { type: "boolean" },
    },
    output,
    async execute(args, exec) {
      if (!exec.agent) throw new Error("moa/agent-required");
      const { source, ...item } = z
        .object({
          source: z.string().min(1),
          ...taskSchema.shape.tasks.element.shape,
        })
        .parse(args);
      return JSON.stringify(
        await agents.fork(
          exec.agent,
          SessionId(source),
          item,
          toolOperationId(exec),
          exec.signal,
        ),
      );
    },
  });
}

export function createProjectContextTool(agents: MoAAgents) {
  return defineTool({
    name: "ProjectContext",
    description:
      "Read or write a reusable project context file. For updates, read its version first and supply that version; keep index.md current.",
    parameters: {
      action: { type: "string", required: true, enum: ["read", "write"] },
      path: {
        type: "string",
        required: true,
        description: "Path within the shared context directory",
      },
      content: {
        type: "string",
        description: "Complete file content for write",
      },
      version: {
        type: "string",
        description: "Version from read; omit only when creating a file",
      },
    },
    output,
    async execute(args, exec) {
      if (!exec.agent) throw new Error("moa/agent-required");
      const input = z
        .object({
          action: z.enum(["read", "write"]),
          path: z.string().min(1),
          content: z.string().optional(),
          version: z.string().min(1).optional(),
        })
        .parse(args);
      return JSON.stringify(
        await agents.context(exec.agent, input, exec.signal),
      );
    },
  });
}
