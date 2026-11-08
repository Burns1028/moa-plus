import { z } from "zod";
import type { ControlWorkersRequest } from "../shared/index.ts";
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
