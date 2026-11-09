import type { Agent } from "@deepseek-ai/dsh-agent";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { toolOperationId } from "./native.ts";
import { z } from "zod";
import type { ControlResult, ControlWorkersRequest } from "../shared/index.ts";
import { SessionId } from "@deepseek-ai/dsh-session";
const worker_id = z.string().min(1).transform(SessionId);
export const historySchema = z.object({
  action: z.literal("history"),
  worker_id,
  offset: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
});
export const controlSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("spawn"),
    name: z.string().min(1),
    task: z.string().min(1),
    task_ref: z.string().optional(),
  }),
  z.object({
    action: z.literal("list"),
  }),
  z.object({
    action: z.literal("send"),
    worker_id,
    message: z.string().min(1),
    delivery: z.enum(["steer", "queue"]),
    task_ref: z.string().optional(),
  }),
  z.object({ action: z.literal("get"), worker_id }),
  z.object({ action: z.literal("interrupt"), worker_id }),
  z.object({ action: z.literal("delete"), worker_id }),
  historySchema,
]) satisfies z.ZodType<ControlWorkersRequest>;

/** Tool definition is separate from Agent-scoped registration and suppression. */
export function createWorkerControlTool(
  control: (
    agent: Agent,
    request: ControlWorkersRequest,
    operationId: string,
    signal: AbortSignal,
  ) => Promise<ControlResult>,
) {
  return defineTool({
    name: "control_workers",
    description:
      "Delegate tasks to workers with the same native tools and skills. spawn starts independent execution; send continues it; list/get/history inspect; interrupt/delete manage lifecycle. When waiting for workers, yield your response; results resume this coordinator turn automatically.",
    parameters: {
      action: {
        type: "string",
        required: true,
        description:
          "Action: spawn, list, send, get, history, interrupt, delete",
      },
      name: { type: "string", description: "Worker name" },
      task: { type: "string", description: "Initial task" },
      worker_id: { type: "string", description: "Worker session id" },
      message: { type: "string", description: "Follow-up" },
      delivery: {
        type: "string",
        enum: ["steer", "queue"],
        description: "Immediate step or next turn",
      },
      offset: {
        type: "integer",
        description: "History index from newest (0 = latest visible message)",
      },
      limit: {
        type: "integer",
        description:
          "History window length; returns user/assistant messages newest first",
      },
      task_ref: { type: "string", description: "Task reference" },
    },
    output: {
      schema: { type: "string" },
      render: (_a, value) => [{ type: "text", text: value }],
    },
    execute: async (args, exec) => {
      if (!exec.agent) throw new Error("project-mode/not-coordinator");
      return JSON.stringify(
        await control(
          exec.agent,
          controlSchema.parse(args),
          toolOperationId(exec),
          exec.signal,
        ),
      );
    },
  });
}
