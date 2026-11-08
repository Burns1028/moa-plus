import { defineTool } from "@deepseek-ai/dsh-tools";
import { SessionId } from "@deepseek-ai/dsh-session";
import { z } from "zod";
import type { MoAAgents } from "./agents.ts";

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
      "Request that a direct child stop its current work; retain its history and workspace.",
    parameters: {
      id: { type: "string", required: true, description: "Direct child ID" },
    },
    output,
    async execute(args, exec) {
      if (!exec.agent) throw new Error("moa/agent-required");
      return JSON.stringify(
        await agents.kill(
          exec.agent,
          SessionId(z.object({ id: z.string().min(1) }).parse(args).id),
          exec.signal,
        ),
      );
    },
  });
}
