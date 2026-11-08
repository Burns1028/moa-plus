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
}

type Wait = {
  route: RequestRoute;
  settle: (result: RequestResult) => void;
  replying?: Promise<RequestResult>;
};
/** Request matching and wait graph; the native Agent retains execution and inbox ownership. */
export class MoAMessageBroker {
  private waits = new Map<string, Wait>();
  private operations = new Map<string, Promise<unknown>>();
  private routeLocks = new Map<string, Promise<void>>();
  private disposed = new AbortController();
  constructor(private ports: MessagePorts) {}
  dispose() {
    this.disposed.abort();
  }
  async recover(_rootId: string) {
    /* Routes are loaded from the owning record on demand. */
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
    if (existing !== undefined) return Promise.resolve(existing);
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
            wait.replying = this.ports.saveRoute(answered).then(() => answer);
            await wait.replying;
            wait.settle(answer);
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
    this.waits.set(waitKey, { route, settle });
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
import { SessionId } from "@deepseek-ai/dsh-session";
import {
  observeForTurn,
  queueHostSubagentPrompt,
  resolveOrdinaryAgent,
  steerHostSubagentPrompt,
} from "../native.ts";
import type { HostAccess } from "../host-access.ts";

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
/** Bind the broker to native session inboxes and the Project's durable aggregate. */
export function createNativeMessageBroker(
  host: HostAccess,
  judge: MessagePorts["judge"],
) {
  return new MoAMessageBroker({
    listeners: host.listeners,
    judge,
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
      // A retry after admission but before its receipt must not enqueue twice.
      using observed = await observeForTurn(host.ctx, targetId, signal);
      const prior = observed.events.findLast(
        (event) =>
          event.type === "agent/inbox/spliced" &&
          JSON.stringify(event.data).includes(
            JSON.stringify(envelope.operationId),
          ),
      );
      if (prior && prior.type === "agent/inbox/spliced") {
        const inserted = prior.data.inserted.find(
          (m) =>
            m.source.kind === "moa-message" &&
            m.source.operationId === envelope.operationId &&
            m.source.rootId === envelope.rootId,
        );
        if (inserted) return inserted.id;
      }
      let target = host.ctx.agents.get(targetId);
      if (!target && targetId === envelope.rootId)
        target = await resolveOrdinaryAgent(host.ctx, targetId);
      if (target) {
        const id = MessageId(
          `moa-${createHash("sha256")
            .update(JSON.stringify([envelope.rootId, envelope.operationId]))
            .digest("hex")}`,
        );
        const message = freezeMessage({
          id,
          role: "user" as const,
          source,
          content: [{ type: "text", text }],
        });
        target.send(
          message,
          envelope.delivery === "queue" ? "next-turn" : "next-step",
          true,
        );
        return id;
      }
      // Native host continuation requires the true direct parent, not the sender.
      const root =
        host.ctx.agents.get(SessionId(envelope.rootId)) ??
        (await resolveOrdinaryAgent(host.ctx, SessionId(envelope.rootId)));
      if (!root) throw new Error("moa/root-unavailable");
      const pending = [root.id];
      let parent: Agent | undefined;
      while (pending.length) {
        const parentId = pending.shift()!;
        const children = await host.ctx.subagents.listChildren(
          parentId,
          signal,
        );
        if (children.some((child) => child.id === targetId)) {
          parent = host.ctx.agents.get(parentId);
          break;
        }
        pending.push(
          ...children
            .filter((child) => child.mode === "continuable")
            .map((child) => child.id),
        );
      }
      if (!parent) throw new Error("moa/direct-parent-unavailable");
      const deliver =
        envelope.delivery === "queue"
          ? queueHostSubagentPrompt
          : steerHostSubagentPrompt;
      return deliver(
        host.ctx.subagents,
        parent,
        targetId,
        [{ type: "text", text }],
        source,
        signal,
      );
    },
  });
}
