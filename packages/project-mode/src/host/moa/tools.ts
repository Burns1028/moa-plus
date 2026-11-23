import { moaToolNames } from "../../shared/tool-names.ts";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { SessionId } from "@deepseek-ai/dsh-session";
import { z } from "zod";
import type { MoAAgents } from "./agents.ts";
import { toolOperationId } from "../native.ts";
import { peerMessageSchema, type MoAMessageBroker } from "./messages.ts";

const output = {
  schema: { type: "string" as const },
  render: (_args: unknown, value: string) => [
    { type: "text" as const, text: value },
  ],
};
const observationSchema = z
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
export function createTeamObserver(agents: MoAAgents) {
  return defineTool({
    name: moaToolNames.observe,
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
        description:
          "Newest-relative message offset. Must be supplied together with history_limit.",
      },
      history_limit: {
        type: "integer",
        description:
          "Number of human and AI messages. Must be supplied together with history_offset.",
      },
    },
    output,
    async execute(args, exec) {
      if (!exec.agent) throw new Error("moa/agent-required");
      const input = observationSchema.parse(args);
      return JSON.stringify(
        await agents.observe(
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
export function createWorkStopper(agents: MoAAgents) {
  return defineTool({
    name: moaToolNames.stop,
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
        await agents.stopWork(exec.agent, SessionId(input.id), exec.signal, {
          destroy: input.destroy,
          continueWith: input.continue_with,
          operationId: toolOperationId(exec),
        }),
      );
    },
  });
}

const assignmentSchema = z.object({
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
export function createWorkDispatcher(agents: MoAAgents) {
  return defineTool({
    name: moaToolNames.dispatch,
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
              description: "Omit to report to the creating Agent. To change recipient, use an actual existing session ID, never a role label or null.",
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
        await agents.dispatch(
          exec.agent,
          assignmentSchema.parse(args).tasks,
          toolOperationId(exec),
          exec.signal,
        ),
      );
    },
  });
}

export function createContextBrancher(agents: MoAAgents) {
  return defineTool({
    name: moaToolNames.branch,
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
        description: "Omit to report to the creating Agent. To change recipient, use an actual existing session ID, never a role label or null.",
      },
      nested: { type: "boolean" },
    },
    output,
    async execute(args, exec) {
      if (!exec.agent) throw new Error("moa/agent-required");
      const { source, ...item } = z
        .object({
          source: z.string().min(1),
          ...assignmentSchema.shape.tasks.element.shape,
        })
        .parse(args);
      return JSON.stringify(
        await agents.branch(
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

export function createSharedContextAccess(agents: MoAAgents) {
  return defineTool({
    name: moaToolNames.context,
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
        await agents.sharedContext(exec.agent, input, exec.signal),
      );
    },
  });
}

export function createPeerMessenger(broker: MoAMessageBroker) {
  return defineTool({
    name: moaToolNames.message,
    nativeOnly: true,
    description:
      "Send a notification or ask another MoA agent a question. Answer an existing request with mode=notify and reply_to, not a new request. Requests wait for an explicit answer, timeout, or priority input.",
    parameters: {
      target: {
        type: "string",
        required: true,
        description: "Target agent session ID",
      },
      message: {
        type: "string",
        required: true,
        description: "Message content",
      },
      mode: {
        type: "string",
        enum: ["notify", "request"],
        description: "notify (default) sends information or a reply; request asks a new question and waits",
      },
      delivery: {
        type: "string",
        enum: ["steer", "queue"],
        description: "Next step (default) or next turn",
      },
      timeout_ms: {
        type: "integer",
        description: "Required request timeout in milliseconds",
      },
      reply_to: { type: "string", description: "Request ID being answered; use mode=notify" },
    },
    output,
    execute: async (args, exec) => {
      if (!exec.agent) throw new Error("moa/agent-required");
      return JSON.stringify(
        await broker.send(
          exec.agent,
          peerMessageSchema.parse(args),
          toolOperationId(exec),
          exec.signal,
        ),
      );
    },
  });
}
