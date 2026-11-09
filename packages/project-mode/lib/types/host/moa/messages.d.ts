import type { HostAccess } from "../host-access.ts";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { UserMessage } from "@deepseek-ai/dsh-llm";
import { z } from "zod";
export declare const sendMessageSchema: z.ZodObject<{
    target: z.ZodString;
    message: z.ZodString;
    mode: z.ZodDefault<z.ZodEnum<{
        notify: "notify";
        request: "request";
    }>>;
    delivery: z.ZodDefault<z.ZodEnum<{
        steer: "steer";
        queue: "queue";
    }>>;
    timeout_ms: z.ZodOptional<z.ZodNumber>;
    reply_to: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type MoAMessageEnvelope = {
    rootId: string;
    senderId: string;
    targetId: string;
    message: string;
    operationId: string;
    requestId?: string;
    replyTo?: string;
    delivery: "steer" | "queue";
};
export type RequestRoute = {
    rootId: string;
    senderId: string;
    targetId: string;
    requestId: string;
    operationId: string;
    state: "waiting" | "ended" | "answered";
    answer?: string;
};
export type RequestResult = {
    status: "answered";
    requestId: string;
    answer: string;
} | {
    status: "interrupted" | "timeout" | "downgraded";
    requestId: string;
};
export interface MessagePorts {
    membership(actor: Agent, targetId: string): string;
    getRoute(rootId: string, requestId: string): RequestRoute | undefined;
    saveRoute(route: RequestRoute): Promise<void>;
    receipt(rootId: string, operationId: string): unknown;
    saveReceipt(rootId: string, operationId: string, value: unknown): Promise<void>;
    deliver(envelope: MoAMessageEnvelope, signal: AbortSignal): Promise<string>;
    judge(agent: Agent, messages: readonly UserMessage[], description: string, signal: AbortSignal): Promise<boolean>;
    listeners: Set<() => void>;
    recover?(rootId: string, signal: AbortSignal, step?: RecoveryStep): Promise<void>;
    dispose?(): void;
}
interface RecoveryStep {
    agent: Agent;
    messages: UserMessage[];
    signal: AbortSignal;
}
/** Request matching and wait graph; the native Agent retains execution and inbox ownership. */
export declare class MoAMessageBroker {
    private ports;
    private waits;
    private operations;
    private routeLocks;
    private disposed;
    constructor(ports: MessagePorts);
    dispose(): void;
    recover(rootId: string, step?: RecoveryStep): Promise<void>;
    send(actor: Agent, input: SendMessageInput, operationId: string, signal: AbortSignal): Promise<unknown>;
    private withRouteLock;
    private cycle;
    private run;
    private awaitAnswer;
}
declare module "@deepseek-ai/dsh-llm" {
    interface MessageSourceMap {
        "moa-message": {
            kind: "moa-message";
            form: "relay";
            rootId: string;
            senderId: string;
            senderSessionId?: string;
            senderName?: string;
            operationId: string;
            requestId?: string;
            replyTo?: string;
        };
    }
}
/** Bind the broker to native session inboxes and the Project's durable aggregate. */
export declare function createNativeMessageBroker(host: HostAccess, judge: MessagePorts["judge"]): MoAMessageBroker;
export {};
