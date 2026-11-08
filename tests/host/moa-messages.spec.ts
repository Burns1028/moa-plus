import { expect, it, vi } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { fixture } from "./fixture.ts";

it("exposes SendMessage only to MoA participants", async () => {
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("parent"),
      meta: { cwd: f.root },
    });
    const { agent: ordinary } = await f.ctx.agents.create({
      sessionId: SessionId("ordinary"),
      meta: { cwd: f.root },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    expect(f.ctx.tools.get("SendMessage", agent)).toBeDefined();
    expect(f.ctx.tools.get("SendMessage", ordinary)).toBeUndefined();
  } finally {
    await f.dispose();
  }
});

it("keeps a native tool call open until its explicit answer", async () => {
  const f = await fixture();
  const received = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let workerCalls = 0;
  let parentAnswered = false;
  let workerId = "";
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    f.adapter.handler = async (options) => {
      if (options.sessionId !== agent.id) {
        workerId = options.sessionId;
        if (++workerCalls === 1)
          return call("question", {
            target: agent.id,
            message: "Which plan?",
            mode: "request",
            timeout_ms: 10000,
          });
        expect(JSON.stringify(options.messages)).toContain("Use plan B");
        return response("finished");
      }
      const request = options.messages.find(
        (m) => m.source.kind === "moa-message" && m.source.requestId,
      );
      if (!request || request.source.kind !== "moa-message" || parentAnswered)
        return response("waiting");
      received.resolve();
      await release.promise;
      parentAnswered = true;
      return call("answer", {
        target: request.source.senderId,
        message: "Use plan B",
        reply_to: request.source.requestId,
      });
    };
    await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "spawn", name: "worker", task: "ask" },
      "spawn",
      new AbortController().signal,
    );
    await received.promise;
    expect(f.ctx.agents.get(SessionId(workerId))?.status).toBe("running");
    expect(workerCalls).toBe(1);
    release.resolve();
    await f.ctx.agents.get(SessionId(workerId))!.whenIdle();
    expect(workerCalls).toBe(2);
  } finally {
    release.resolve();
    await f.dispose();
  }
});

import { response } from "./fixture.ts";
import type { StreamChunk } from "@deepseek-ai/dsh-llm";
function call(id: string, input: object): StreamChunk[] {
  const args = JSON.stringify(input);
  return [
    { type: "block-start", index: 0, blockType: "tool-call" },
    {
      type: "tool-call-delta",
      index: 0,
      id,
      name: "SendMessage",
      argumentsDelta: args,
    },
    {
      type: "block-end",
      index: 0,
      block: { type: "tool-call", id, name: "SendMessage", arguments: args },
    },
    { type: "finish", reason: { kind: "tool-calls" } },
  ];
}

it("hands control back for human input and delivers a late reply to the native inbox", async () => {
  const f = await fixture();
  const parentSaw = Promise.withResolvers<void>();
  const releaseReply = Promise.withResolvers<void>();
  const interrupted = Promise.withResolvers<void>();
  const late = Promise.withResolvers<void>();
  let workerId = "";
  let parentAnswered = false;
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    f.adapter.handler = async (options) => {
      if (options.sessionId !== agent.id) {
        workerId = options.sessionId;
        const content = JSON.stringify(options.messages);
        if (content.includes("late answer")) {
          late.resolve();
          return response("read late answer");
        }
        if (content.includes("interrupted")) {
          interrupted.resolve();
          return response("handled interruption");
        }
        return call("question", {
          target: agent.id,
          message: "question",
          mode: "request",
          timeout_ms: 10000,
        });
      }
      const request = options.messages.find(
        (m) => m.source.kind === "moa-message" && m.source.requestId,
      );
      if (!request || request.source.kind !== "moa-message" || parentAnswered)
        return response("done");
      parentSaw.resolve();
      await releaseReply.promise;
      parentAnswered = true;
      return call("answer", {
        target: request.source.senderId,
        message: "late answer",
        reply_to: request.source.requestId,
      });
    };
    await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "spawn", name: "worker", task: "ask" },
      "spawn",
      new AbortController().signal,
    );
    await parentSaw.promise;
    const worker = f.ctx.agents.get(SessionId(workerId))!;
    worker.steer(
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "urgent human direction" }],
      }),
    );
    await interrupted.promise;
    releaseReply.resolve();
    await late.promise;
  } finally {
    releaseReply.resolve();
    await f.dispose();
  }
});

import {
  MoAMessageBroker,
  sendMessageSchema,
  type MessagePorts,
  type MoAMessageEnvelope,
  type RequestRoute,
} from "../../packages/project-mode/src/host/moa/messages.ts";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { UserMessage } from "@deepseek-ai/dsh-llm";

function brokerFixture(judge: MessagePorts["judge"] = async () => false) {
  const routes = new Map<string, RequestRoute>();
  const receipts = new Map<string, unknown>();
  const deliveries: MoAMessageEnvelope[] = [];
  const listeners = new Set<() => void>();
  const agent = (id: string) =>
    ({
      id,
      inbox: { nextStep: [] as UserMessage[], nextTurn: [] as UserMessage[] },
    }) as unknown as Agent;
  const ports: MessagePorts = {
    membership: () => "root",
    getRoute: (_root, id) => routes.get(id),
    saveRoute: async (route) => {
      routes.set(route.requestId, route);
    },
    receipt: (_root, id) => receipts.get(id),
    saveReceipt: async (_root, id, value) => {
      receipts.set(id, value);
    },
    deliver: async (message) => {
      deliveries.push(message);
      return message.operationId;
    },
    listeners,
    judge,
  };
  return {
    broker: new MoAMessageBroker(ports),
    agent,
    routes,
    deliveries,
    listeners,
  };
}

it("downgrades the closing wait-cycle edge and retains late reply routing", async () => {
  const f = brokerFixture();
  const a = f.agent("a"),
    b = f.agent("b");
  const signal = new AbortController().signal;
  const waiting = f.broker.send(
    a,
    sendMessageSchema.parse({
      target: "b",
      message: "question",
      mode: "request",
      timeout_ms: 5000,
    }),
    "a-request",
    signal,
  );
  await vi.waitFor(() => expect(f.deliveries).toHaveLength(1));
  const closing = await f.broker.send(
    b,
    sendMessageSchema.parse({
      target: "a",
      message: "other question",
      mode: "request",
      timeout_ms: 5000,
    }),
    "b-request",
    signal,
  );
  expect(closing).toMatchObject({ status: "downgraded" });
  await f.broker.send(
    b,
    sendMessageSchema.parse({
      target: "a",
      message: "answer",
      reply_to: "a-request",
    }),
    "reply",
    signal,
  );
  expect(await waiting).toMatchObject({ status: "answered", answer: "answer" });
  expect(f.deliveries).toHaveLength(2);
  expect(f.routes.get("b-request")?.state).toBe("ended");
});

it("rejudges the full unread batch as it grows without consuming it", async () => {
  const batches: number[] = [];
  const f = brokerFixture(async (_agent, messages) => {
    batches.push(messages.length);
    return messages.length === 2;
  });
  const a = f.agent("a");
  const pending = f.broker.send(
    a,
    sendMessageSchema.parse({
      target: "b",
      message: "question",
      mode: "request",
      timeout_ms: 5000,
    }),
    "request",
    new AbortController().signal,
  );
  await vi.waitFor(() => expect(f.deliveries).toHaveLength(1));
  const unread = a.inbox.nextStep as UserMessage[];
  unread.push(
    createUserMessage({
      source: {
        kind: "moa-message",
        form: "relay",
        rootId: "root",
        senderId: "c",
        operationId: "one",
      },
      content: [{ type: "text", text: "can wait" }],
    }),
  );
  f.listeners.forEach((fn) => fn());
  await vi.waitFor(() => expect(batches).toEqual([1]));
  unread.push(
    createUserMessage({
      source: {
        kind: "moa-message",
        form: "relay",
        rootId: "root",
        senderId: "d",
        operationId: "two",
      },
      content: [{ type: "text", text: "urgent" }],
    }),
  );
  f.listeners.forEach((fn) => fn());
  expect(await pending).toMatchObject({ status: "interrupted" });
  expect(batches).toEqual([1, 2]);
  expect(unread).toHaveLength(2);
});

it("honors the deadline even while the judge is pending", async () => {
  const f = brokerFixture(() => new Promise(() => {}));
  const a = f.agent("a");
  (a.inbox.nextStep as UserMessage[]).push(
    createUserMessage({
      source: {
        kind: "moa-message",
        form: "relay",
        rootId: "root",
        senderId: "c",
        operationId: "one",
      },
      content: [{ type: "text", text: "notice" }],
    }),
  );
  const result = await f.broker.send(
    a,
    sendMessageSchema.parse({
      target: "b",
      message: "question",
      mode: "request",
      timeout_ms: 20,
    }),
    "request",
    new AbortController().signal,
  );
  expect(result).toMatchObject({ status: "timeout" });
  expect(f.routes.get("request")?.state).toBe("ended");
});

it("cold-resumes an owned worker through the true native parent", async () => {
  const f = await fixture();
  const delivered = Promise.withResolvers<void>();
  let childId = "";
  let dispatch = false,
    sent = false;
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    f.adapter.handler = (options) => {
      if (options.sessionId !== agent.id) {
        if (JSON.stringify(options.messages).includes("cold notification"))
          delivered.resolve();
        return response("worker done");
      }
      if (dispatch && !sent) {
        sent = true;
        return call("cold-send", {
          target: childId,
          message: "cold notification",
        });
      }
      return response("parent done");
    };
    const result = await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "spawn", name: "worker", task: "first" },
      "spawn",
      new AbortController().signal,
    );
    childId = (result as { workerId: string }).workerId;
    await f.ctx.agents.get(SessionId(childId))?.whenIdle();
    await agent.whenIdle();
    await f.ctx.subagents.drainChildren(agent, [SessionId(childId)]);
    expect(f.ctx.agents.get(SessionId(childId))).toBeUndefined();
    dispatch = true;
    agent.followup(
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "send notification" }],
      }),
    );
    await delivered.promise;
  } finally {
    await f.dispose();
  }
});

it("reconciles a native inbox admission after a missing operation receipt", async () => {
  const f = await fixture();
  const release = Promise.withResolvers<void>();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    f.adapter.handler = async (options) => {
      if (options.sessionId !== agent.id) await release.promise;
      return response("done");
    };
    const created = await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "spawn", name: "worker", task: "hold" },
      "spawn",
      new AbortController().signal,
    );
    const childId = (created as { workerId: string }).workerId;
    const host = (f.ctx.projectMode as unknown as { access: HostAccess })
      .access;
    const input = sendMessageSchema.parse({ target: childId, message: "once" });
    const signal = new AbortController().signal;
    const first = createNativeMessageBroker(host, async () => false);
    const receipt = await first.send(agent, input, "stable-operation", signal);
    await host.update(agent.id, (record) => {
      const operations = { ...record.operations };
      delete operations["moa:receipt:stable-operation"];
      return { ...record, operations };
    });
    const recovered = createNativeMessageBroker(host, async () => false);
    expect(
      await recovered.send(agent, input, "stable-operation", signal),
    ).toEqual(receipt);
    const inbox = f.ctx.agents.get(SessionId(childId))!.inbox.nextStep;
    expect(
      inbox.filter(
        (message) =>
          message.source.kind === "moa-message" &&
          message.source.operationId === "stable-operation",
      ),
    ).toHaveLength(1);
  } finally {
    release.resolve();
    await f.dispose();
  }
});

import { createNativeMessageBroker } from "../../packages/project-mode/src/host/moa/messages.ts";
import type { HostAccess } from "../../packages/project-mode/src/host/host-access.ts";

it("preserves late reply routing after cancellation and broker restart", async () => {
  const f = brokerFixture();
  const a = f.agent("a"),
    b = f.agent("b");
  const controller = new AbortController();
  const pending = f.broker.send(
    a,
    sendMessageSchema.parse({
      target: "b",
      message: "question",
      mode: "request",
      timeout_ms: 5000,
    }),
    "request",
    controller.signal,
  );
  await vi.waitFor(() => expect(f.deliveries).toHaveLength(1));
  const reason = new Error("stop");
  controller.abort(reason);
  await expect(pending).rejects.toBe(reason);
  expect(f.routes.get("request")?.state).toBe("ended");
  // No in-memory waiter remains after restart. The retained route sends the
  // answer through the ordinary inbox rather than completing a stale tool.
  const newBroker = new MoAMessageBroker({
    membership: () => "root",
    getRoute: (_root, id) => f.routes.get(id),
    saveRoute: async (route) => {
      f.routes.set(route.requestId, route);
    },
    receipt: () => undefined,
    saveReceipt: async () => {},
    deliver: async (message) => {
      f.deliveries.push(message);
      return message.operationId;
    },
    judge: async () => false,
    listeners: f.listeners,
  });
  await newBroker.recover("root");
  await newBroker.send(
    b,
    sendMessageSchema.parse({
      target: "a",
      message: "late",
      reply_to: "request",
    }),
    "reply",
    new AbortController().signal,
  );
  expect(f.deliveries.at(-1)).toMatchObject({
    targetId: "a",
    replyTo: "request",
    message: "late",
  });
});

it("does not treat a queued notification as a priority next-step interruption", async () => {
  const f = brokerFixture();
  const a = f.agent("a");
  (a.inbox.nextTurn as UserMessage[]).push(
    createUserMessage({
      source: { kind: "user" },
      content: [{ type: "text", text: "later" }],
    }),
  );
  const result = await f.broker.send(
    a,
    sendMessageSchema.parse({
      target: "b",
      message: "question",
      mode: "request",
      timeout_ms: 20,
    }),
    "request",
    new AbortController().signal,
  );
  expect(result).toMatchObject({ status: "timeout" });
  expect(a.inbox.nextTurn).toHaveLength(1);
});

it("does not duplicate an explicit answer, while unknown replies remain ordinary mail", async () => {
  const f = brokerFixture();
  const a = f.agent("a"),
    b = f.agent("b");
  const signal = new AbortController().signal;
  const pending = f.broker.send(
    a,
    sendMessageSchema.parse({
      target: "b",
      message: "question",
      mode: "request",
      timeout_ms: 5000,
    }),
    "request",
    signal,
  );
  await vi.waitFor(() => expect(f.deliveries).toHaveLength(1));
  await Promise.all([
    f.broker.send(
      b,
      sendMessageSchema.parse({
        target: "a",
        message: "answer",
        reply_to: "request",
      }),
      "reply-1",
      signal,
    ),
    f.broker.send(
      b,
      sendMessageSchema.parse({
        target: "a",
        message: "answer again",
        reply_to: "request",
      }),
      "reply-2",
      signal,
    ),
  ]);
  expect(await pending).toMatchObject({ status: "answered", answer: "answer" });
  expect(f.deliveries).toHaveLength(1);
  await f.broker.send(
    b,
    sendMessageSchema.parse({
      target: "a",
      message: "unmatched",
      reply_to: "unknown",
    }),
    "unknown",
    signal,
  );
  expect(f.deliveries.at(-1)).toMatchObject({
    message: "unmatched",
    replyTo: "unknown",
  });
});

it("routes a native request and reply directly between two owned peers", async () => {
  const f = await fixture();
  const release = Promise.withResolvers<void>();
  const answered = Promise.withResolvers<void>();
  let aId = "",
    bId = "";
  let aCalls = 0,
    bReplied = false;
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    f.adapter.handler = async (options) => {
      if (options.sessionId === agent.id) return response("reviewed");
      await release.promise;
      if (options.sessionId === aId) {
        if (++aCalls === 1)
          return call("peer-question", {
            target: bId,
            message: "peer question",
            mode: "request",
            timeout_ms: 5000,
          });
        expect(JSON.stringify(options.messages)).toContain("peer answer");
        answered.resolve();
        return response("complete");
      }
      const request = options.messages.find(
        (m) => m.source.kind === "moa-message" && m.source.requestId,
      );
      if (request?.source.kind === "moa-message" && !bReplied) {
        bReplied = true;
        return call("peer-answer", {
          target: request.source.senderId,
          reply_to: request.source.requestId,
          message: "peer answer",
        });
      }
      return response("available");
    };
    const one = await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "spawn", name: "a", task: "ask" },
      "spawn-a",
      new AbortController().signal,
    );
    aId = (one as { workerId: string }).workerId;
    const two = await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "spawn", name: "b", task: "answer" },
      "spawn-b",
      new AbortController().signal,
    );
    bId = (two as { workerId: string }).workerId;
    release.resolve();
    await answered.promise;
  } finally {
    release.resolve();
    await f.dispose();
  }
});
