import { z } from "zod";
import { SessionId } from "@deepseek-ai/dsh-session";
export declare const historySchema: z.ZodObject<{
    action: z.ZodLiteral<"history">;
    worker_id: z.ZodPipe<z.ZodString, z.ZodTransform<SessionId, string>>;
    offset: z.ZodNumber;
    limit: z.ZodNumber;
}, z.core.$strip>;
export declare const controlSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    action: z.ZodLiteral<"spawn">;
    name: z.ZodString;
    task: z.ZodString;
    task_ref: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"list">;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"send">;
    worker_id: z.ZodPipe<z.ZodString, z.ZodTransform<SessionId, string>>;
    message: z.ZodString;
    delivery: z.ZodEnum<{
        steer: "steer";
        queue: "queue";
    }>;
    task_ref: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"get">;
    worker_id: z.ZodPipe<z.ZodString, z.ZodTransform<SessionId, string>>;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"interrupt">;
    worker_id: z.ZodPipe<z.ZodString, z.ZodTransform<SessionId, string>>;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"delete">;
    worker_id: z.ZodPipe<z.ZodString, z.ZodTransform<SessionId, string>>;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"history">;
    worker_id: z.ZodPipe<z.ZodString, z.ZodTransform<SessionId, string>>;
    offset: z.ZodNumber;
    limit: z.ZodNumber;
}, z.core.$strip>], "action">;
