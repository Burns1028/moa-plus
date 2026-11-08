import { defineTool } from "@deepseek-ai/dsh-tools";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { UserMessage } from "@deepseek-ai/dsh-llm";
import { z } from "zod";
import { toolOperationId } from "../native.ts";

export const sendMessageSchema = z
  .object({
    target: z.string().min(1),
    message: z.string().min(1),
    mode: z.enum(["notify", "request"]).default("notify"),
    delivery: z.enum(["steer", "queue"]).default("steer"),
    timeout_ms: z.number().int().positive().max(86400000).optional(),
    reply_to: z.string().min(1).optional(),
  })
  .refine(
    (v) => v.mode !== "request" || (!!v.timeout_ms && !v.reply_to),
    "Request requires timeout_ms and cannot be a reply",
  );
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
export type RequestResult =
  | { status: "answered"; requestId: string; answer: string }
  | { status: "interrupted" | "timeout" | "downgraded"; requestId: string };
export interface MessagePorts {
  membership(actor: Agent, targetId: string): string;
  getRoute(rootId: string, requestId: string): RequestRoute | undefined;
  saveRoute(route: RequestRoute): Promise<void>;
  receipt(rootId: string, operationId: string): unknown;
  saveReceipt(
    rootId: string,
    operationId: string,
    value: unknown,
  ): Promise<void>;
  deliver(envelope: MoAMessageEnvelope, signal: AbortSignal): Promise<string>;
  judge(
    agent: Agent,
    messages: readonly UserMessage[],
    description: string,
    signal: AbortSignal,
  ): Promise<boolean>;
  listeners: Set<() => void>;
  recover?(rootId: string, signal: AbortSignal, step?: RecoveryStep): Promise<void>;
  dispose?(): void;
}
interface RecoveryStep {
  agent: Agent;
  messages: UserMessage[];
  signal: AbortSignal;
}

type Wait = {
  route: RequestRoute;
  settle: (result: RequestResult) => void;
  signal: AbortSignal;
};
/** Request matching and wait graph; the native Agent retains execution and inbox ownership. */
export class MoAMessageBroker {
  private waits = new Map<string, Wait>();
  private operations = new Map<string, Promise<unknown>>();
  private routeLocks = new Map<string, Promise<void>>();
  private disposed = new AbortController();
  constructor(private ports: MessagePorts) {}
  hasPendingRequest(senderId: string, callSeq: number): boolean {
    return [...this.waits.values()].some(({ route, signal }) =>
      !signal.aborted && route.senderId === senderId && nativeOperationSeq(route.operationId, senderId) === callSeq,
    );
  }
  dispose() {
    this.disposed.abort();
    this.ports.dispose?.();
  }
  async recover(rootId: string, step?: RecoveryStep) {
    await this.ports.recover?.(rootId, this.disposed.signal, step);
  }
  send(
    actor: Agent,
    input: SendMessageInput,
    operationId: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    const rootId = this.ports.membership(actor, input.target);
    const key = JSON.stringify([rootId, operationId]);
    const running = this.operations.get(key);
    if (running) return running;
    const existing = this.ports.receipt(rootId, operationId);
    if (existing !== undefined) {
      return input.reply_to
        ? this.recover(rootId).then(() => existing)
        : Promise.resolve(existing);
    }
    const work = this.run(
      actor,
      input,
      operationId,
      rootId,
      AbortSignal.any([signal, this.disposed.signal]),
    );
    this.operations.set(key, work);
    void work.finally(() => this.operations.delete(key)).catch(() => {});
    return work;
  }
  private async withRouteLock<T>(
    rootId: string,
    requestId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const key = JSON.stringify([rootId, requestId]);
    const previous = this.routeLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.routeLocks.set(key, current);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.routeLocks.get(key) === current) this.routeLocks.delete(key);
    }
  }
  private cycle(rootId: string, sender: string, target: string): boolean {
    const seen = new Set<string>();
    const visit = (id: string): boolean => {
      if (id === sender) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return [...this.waits.values()].some(
        ({ route }) =>
          route.rootId === rootId &&
          route.senderId === id &&
          visit(route.targetId),
      );
    };
    return visit(target);
  }
  private async run(
    actor: Agent,
    input: SendMessageInput,
    operationId: string,
    rootId: string,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    const envelope: MoAMessageEnvelope = {
      rootId,
      senderId: actor.id,
      targetId: input.target,
      message: input.message,
      operationId,
      delivery: input.delivery,
      ...(input.reply_to ? { replyTo: input.reply_to } : {}),
    };
    if (input.mode === "notify") {
      const route =
        input.reply_to && this.ports.getRoute(rootId, input.reply_to);
      if (
        route &&
        route.senderId === input.target &&
        route.targetId === actor.id
      ) {
        return this.withRouteLock(rootId, route.requestId, async () => {
          signal.throwIfAborted();
          const current = this.ports.getRoute(rootId, route.requestId)!;
          const wait = this.waits.get(
            JSON.stringify([rootId, route.requestId]),
          );
          if (current.state === "answered") {
            await this.recover(rootId);
            const duplicate = { status: "delivered", replyTo: route.requestId };
            await this.ports.saveReceipt(rootId, operationId, duplicate);
            return duplicate;
          }
          const answered: RequestRoute = {
            ...current,
            state: "answered",
            answer: input.message,
          };
          if (wait && current.state === "waiting") {
            const answer: RequestResult = {
              status: "answered",
              requestId: route.requestId,
              answer: input.message,
            };
            await this.ports.saveRoute(answered);
            // Persistence may yield while the requester is cancelled. Do not
            // settle a dead waiter: its answer now belongs in the inbox.
            if (!wait.signal.aborted && this.waits.get(JSON.stringify([rootId, route.requestId])) === wait)
              wait.settle(answer);
            else await this.ports.deliver(envelope, signal);
            const result = { status: "delivered", replyTo: route.requestId };
            await this.ports.saveReceipt(rootId, operationId, result);
            return result;
          }
          const messageId = await this.ports.deliver(envelope, signal);
          await this.ports.saveRoute(answered);
          const result = { status: "delivered", messageId };
          await this.ports.saveReceipt(rootId, operationId, result);
          return result;
        });
      }
      const messageId = await this.ports.deliver(envelope, signal);
      const result = { status: "delivered", messageId };
      await this.ports.saveReceipt(rootId, operationId, result);
      return result;
    }
    const requestId = operationId;
    const route: RequestRoute = this.ports.getRoute(rootId, requestId) ?? {
      rootId,
      senderId: actor.id,
      targetId: input.target,
      requestId,
      operationId,
      state: "waiting",
    };
    if (route.state === "answered")
      return {
        status: "answered",
        requestId,
        answer: route.answer!,
      } satisfies RequestResult;
    envelope.requestId = requestId;
    const downgraded = this.cycle(rootId, actor.id, input.target);
    if (downgraded) {
      await this.ports.saveRoute({ ...route, state: "ended" });
      await this.ports.deliver(envelope, signal);
      const result = {
        status: "downgraded",
        requestId,
      } satisfies RequestResult;
      await this.ports.saveReceipt(rootId, operationId, result);
      return result;
    }
    let settle!: (result: RequestResult) => void;
    const answer = new Promise<RequestResult>((resolve) => {
      settle = resolve;
    });
    const waitKey = JSON.stringify([rootId, requestId]);
    this.waits.set(waitKey, { route, settle, signal });
    try {
      await this.ports.saveRoute({ ...route, state: "waiting" });
      await this.ports.deliver(envelope, signal);
      let result = await this.awaitAnswer(
        actor,
        answer,
        input.timeout_ms!,
        signal,
        requestId,
        input.target,
      );
      result = await this.withRouteLock(rootId, requestId, async () => {
        const current = this.ports.getRoute(rootId, requestId)!;
        this.waits.delete(waitKey);
        if (current.state === "answered")
          return {
            status: "answered",
            requestId,
            answer: current.answer!,
          } satisfies RequestResult;
        await this.ports.saveRoute({ ...current, state: "ended" });
        return result;
      });
      await this.ports.saveReceipt(rootId, operationId, result);
      return result;
    } finally {
      this.waits.delete(waitKey);
      if (signal.aborted)
        await this.withRouteLock(rootId, requestId, async () => {
          const current = this.ports.getRoute(rootId, requestId);
          if (current?.state === "waiting")
            await this.ports.saveRoute({ ...current, state: "ended" });
        });
    }
  }
  private async awaitAnswer(
    actor: Agent,
    answer: Promise<RequestResult>,
    timeoutMs: number,
    signal: AbortSignal,
    requestId: string,
    targetId: string,
  ): Promise<RequestResult> {
    let wake!: () => void;
    let changed = new Promise<void>((resolve) => {
      wake = resolve;
    });
    const onChange = () => wake();
    this.ports.listeners.add(onChange);
    const deadline = Date.now() + timeoutMs;
    let inspected = "";
    try {
      for (;;) {
        signal.throwIfAborted();
        const messages = actor.inbox.nextStep;
        if (messages.some((m) => m.source.kind === "user"))
          return { status: "interrupted", requestId };
        const key = JSON.stringify(messages.map((m) => m.id));
        const remaining = deadline - Date.now();
        if (remaining <= 0) return { status: "timeout", requestId };
        const iteration = new AbortController();
        const abort = new Promise<never>((_, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
            signal: iteration.signal,
          }),
        );
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<RequestResult>((resolve) => {
          timer = setTimeout(
            () => resolve({ status: "timeout", requestId }),
            remaining,
          );
        });
        const judge =
          messages.length && key !== inspected
            ? this.ports
                .judge(
                  actor,
                  messages,
                  `Waiting for ${targetId} to answer request ${requestId}`,
                  AbortSignal.any([signal, iteration.signal]),
                )
                .then(
                  (value) => ({ judged: value }),
                  () => ({ judged: true }),
                )
            : new Promise<never>(() => {});
        let result: RequestResult | { judged: boolean } | undefined;
        try {
          result = await Promise.race([
            answer,
            changed.then(() => undefined),
            timeout,
            abort,
            judge,
          ]);
        } finally {
          iteration.abort();
          if (timer) clearTimeout(timer);
        }
        signal.throwIfAborted();
        if (result && "status" in result) return result;
        if (result && "judged" in result) {
          if (result.judged) return { status: "interrupted", requestId };
          inspected = key;
        } else {
          changed = new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      }
    } finally {
      this.ports.listeners.delete(onChange);
    }
  }
}

export function createSendMessageTool(broker: MoAMessageBroker) {
  return defineTool({
    name: "SendMessage",
    description:
      "Send a notification or ask another MoA agent a question. Reply to a request using reply_to. Requests wait for an explicit answer, timeout, or priority input.",
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
        description: "notify (default) or request",
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
      reply_to: { type: "string", description: "Request ID being answered" },
    },
    output: {
      schema: { type: "string" },
      render: (_a, value) => [{ type: "text", text: value }],
    },
    execute: async (args, exec) => {
      if (!exec.agent) throw new Error("moa/agent-required");
      return JSON.stringify(
        await broker.send(
          exec.agent,
          sendMessageSchema.parse(args),
          toolOperationId(exec),
          exec.signal,
        ),
      );
    },
  });
}

import { createHash } from "node:crypto";
import { freezeMessage, MessageId } from "@deepseek-ai/dsh-llm";
import { SessionId, type SessionEvent } from "@deepseek-ai/dsh-session";
import {
  observeForTurn,
} from "../native.ts";
import type { HostAccess } from "../host-access.ts";
import { withManagedAgent } from "./residency.ts";
import { nativeOperationSeq } from "../capsule-participation.ts";
import { messageSchema } from "../state.ts";

declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    "moa-message": {
      kind: "moa-message";
      form: "relay";
      rootId: string;
      senderId: string;
      operationId: string;
      requestId?: string;
      replyTo?: string;
    };
  }
}
const routeKey = (id: string) => `moa:route:${id}`;
const receiptKey = (id: string) => `moa:receipt:${id}`;

function nativeMessage(envelope: MoAMessageEnvelope): UserMessage {
  const source = {
    kind: "moa-message" as const,
    form: "relay" as const,
    rootId: envelope.rootId,
    senderId: envelope.senderId,
    operationId: envelope.operationId,
    ...(envelope.requestId ? { requestId: envelope.requestId } : {}),
    ...(envelope.replyTo ? { replyTo: envelope.replyTo } : {}),
  };
  const text = `${envelope.requestId ? `Request ID: ${envelope.requestId}\n` : ""}${envelope.replyTo ? `Reply to: ${envelope.replyTo}\n` : ""}From: ${envelope.senderId}\n${envelope.message}`;
  return freezeMessage({
    id: MessageId(`moa-${createHash("sha256").update(JSON.stringify([envelope.rootId, envelope.operationId])).digest("hex")}`),
    role: "user" as const,
    source,
    content: [{ type: "text", text }],
  });
}

function isAnswer(message: UserMessage, route: RequestRoute): boolean {
  return message.source.kind === "moa-message" &&
    message.source.rootId === route.rootId &&
    message.source.senderId === route.targetId &&
    message.source.replyTo === route.requestId;
}

/** A persisted receipt is acceptance; only native model history proves delivery. */
function hasCommittedAnswer(events: readonly SessionEvent[], route: RequestRoute): boolean {
  if (events.some(event => event.type === "user/message" && isAnswer(event.data, route))) return true;
  const seq = nativeOperationSeq(route.operationId, route.senderId);
  const call = events.find(event => event.type === "tool/call" && event.seq === seq);
  if (call?.type !== "tool/call" || call.data.name !== "SendMessage") return false;
  return events.some(event => {
    if (event.type !== "tool/result" || event.data.turn !== call.data.turn || event.data.step !== call.data.step || event.data.message.toolCallId !== call.data.callId || event.data.message.isError) return false;
    try {
      const value: unknown = JSON.parse(event.data.message.content.filter(block => block.type === "text").map(block => block.text).join(""));
      return !!value && typeof value === "object" && "status" in value && value.status === "answered" && "requestId" in value && value.requestId === route.requestId && "answer" in value && value.answer === route.answer;
    } catch { return false; }
  });
}
/** Bind the broker to native session inboxes and the Project's durable aggregate. */
export function createNativeMessageBroker(
  host: HostAccess,
  judge: MessagePorts["judge"],
) {
  let detach = () => {};
  const ports: MessagePorts = {
    listeners: host.listeners,
    judge,
    dispose: () => detach(),
    async recover(rootId, brokerSignal, step) {
      const record = host.record(SessionId(rootId));
      if (record?.project.mode !== "enabled") return;
      const signal = AbortSignal.any([brokerSignal, host.closing.signal, ...(step ? [step.signal] : [])]);
      const routes = Object.entries(record.operations).filter(([key]) => key.startsWith("moa:route:")).map(([, value]) => value as unknown as RequestRoute);
      for (const route of routes) {
        if (route.state !== "answered" || route.answer === undefined || (step && route.senderId !== step.agent.id)) continue;
        const current = host.record(SessionId(rootId));
        if (current?.project.mode !== "enabled" || (route.senderId !== rootId && !current.workers.some(worker => worker.id === route.senderId && (worker.lifecycle === "active" || worker.lifecycle === "provisioning")))) continue;
        const senderId = SessionId(route.senderId);
        const live = host.ctx.agents.get(senderId);
        // An original live tool may still be returning its answer. Its next
        // pre-step observes the committed Tool Message, or repairs the gap.
        if (!step && live && (live.status === "running" || live.moaStopped)) continue;
        using observed = await observeForTurn(host.ctx, senderId, signal);
        const pending = live
          ? [...live.inbox.nextStep, ...live.inbox.nextTurn]
          : [...(observed.projections?.values.inbox?.["next-step"] ?? []), ...(observed.projections?.values.inbox?.["next-turn"] ?? [])].map(message => messageSchema.parse(message));
        if (hasCommittedAnswer(observed.events, route) || step?.messages.some(message => isAnswer(message, route)) || pending.some(message => isAnswer(message, route))) continue;
        const message = nativeMessage({ rootId, senderId: route.targetId, targetId: route.senderId, message: route.answer, operationId: `answer-recovery:${route.requestId}`, replyTo: route.requestId, delivery: "steer" });
        if (step) {
          signal.throwIfAborted();
          // Log admission before claiming it into this inference. A crash in
          // between remains recoverable from the same answered route.
          step.agent.send(message, "next-step", false);
          await host.ctx.sessions.flush(step.agent.session);
          signal.throwIfAborted();
          step.agent.inbox.remove(message.id);
          step.messages.push(message);
        } else {
          await withManagedAgent(host, senderId, signal, async sender => {
            if (hasCommittedAnswer(sender.session.snapshotEvents(), route) || [...sender.inbox.nextStep, ...sender.inbox.nextTurn].some(input => isAnswer(input, route))) return;
            sender.send(message, "next-step", true);
          });
        }
      }
    },
    membership(actor, targetId) {
      const record = host.record(actor.id) ?? host.owner(actor.id);
      if (
        !record ||
        record.project.mode !== "enabled" ||
        host.ctx.agents.get(actor.id) !== actor
      )
        throw new Error("moa/not-member");
      const member = (id: string) =>
        id === record.project.coordinatorSessionId ||
        record.workers.some(
          (w) =>
            w.id === id &&
            (w.lifecycle === "active" || w.lifecycle === "provisioning"),
        );
      if (!member(actor.id) || !member(targetId))
        throw new Error("moa/not-member");
      return record.project.coordinatorSessionId;
    },
    getRoute(root, id) {
      return host.record(SessionId(root))?.operations[routeKey(id)] as
        | RequestRoute
        | undefined;
    },
    async saveRoute(route) {
      await host.update(SessionId(route.rootId), (r) => ({
        ...r,
        operations: {
          ...r.operations,
          [routeKey(route.requestId)]: JSON.parse(JSON.stringify(route)),
        },
      }));
    },
    receipt(root, id) {
      return host.record(SessionId(root))?.operations[receiptKey(id)];
    },
    async saveReceipt(root, id, value) {
      await host.update(SessionId(root), (r) => ({
        ...r,
        operations: {
          ...r.operations,
          [receiptKey(id)]: JSON.parse(JSON.stringify(value)),
        },
      }));
    },
    async deliver(envelope, signal) {
      signal.throwIfAborted();
      const targetId = SessionId(envelope.targetId);
      const message = nativeMessage(envelope);
      // A retry after admission but before its receipt must not enqueue twice.
      using observed = await observeForTurn(host.ctx, targetId, signal);
      const prior = observed.events.findLast(
        (event) =>
          event.type === "agent/inbox/spliced" &&
          JSON.stringify(event.data).includes(
            JSON.stringify(envelope.operationId),
          ),
      );
      let priorId: MessageId | undefined;
      if (prior && prior.type === "agent/inbox/spliced") {
        const inserted = prior.data.inserted.find(
          (m) =>
            m.source.kind === "moa-message" &&
            m.source.operationId === envelope.operationId &&
            m.source.rootId === envelope.rootId,
        );
        if (inserted) priorId = inserted.id;
      }
      const admit = (signal: AbortSignal) => priorId
        ? Promise.resolve(priorId)
        : withManagedAgent(host, targetId, signal, async (target) => {
        target.send(message, envelope.delivery === "queue" ? "next-turn" : "next-step", true);
        return message.id;
      });
      if (envelope.senderId === envelope.rootId && targetId !== envelope.rootId) {
        const sender = host.ctx.agents.get(SessionId(envelope.senderId));
        if (!sender) throw new Error("moa/sender-unavailable");
        const receipt = await host.admitWorkerMessage(
          sender,
          { action: "send", worker_id: targetId, message: envelope.message, delivery: envelope.delivery ?? "steer" },
          envelope.operationId,
          signal,
          admit,
        );
        if (!("messageId" in receipt) || !receipt.messageId) throw new Error("moa/message-admission-missing");
        return MessageId(receipt.messageId);
      }
      return admit(signal);
    },
  };
  const broker = new MoAMessageBroker(ports);
  detach = host.ctx.on("agent/pre-step", async ({ agent, signal }, next) => {
    const decision = await next();
    const record = host.record(agent.id) ?? host.owner(agent.id);
    if (decision.kind !== "enter" || !record) return decision;
    const messages = [...decision.messages];
    await broker.recover(record.project.coordinatorSessionId, { agent, signal, messages });
    return { ...decision, messages };
  });
  return broker;
}
