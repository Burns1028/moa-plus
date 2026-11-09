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

it.each(["native", "ptc"])("keeps a %s-composed protocol call open until its explicit answer beyond the background timer", async (presentation) => {
  const f = await fixture(undefined, { backgroundStrategy: "after-seconds", backgroundAfterSeconds: 0.01 });
  const received = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let workerCalls = 0;
  let parentAnswered = false;
  let workerId = "";
  try {
    if (presentation === "ptc") {
      await f.ctx.plugin((await import("@deepseek-ai/dsh-subprocess-local")).default);
      await f.ctx.plugin((await import("@deepseek-ai/dsh-sandbox-local")).default);
      await f.ctx.plugin((await import("@deepseek-ai/dsh-ptc-runtime-node")).default);
    }
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    if (presentation === "ptc") f.ctx.on("agent/created", ({ agent: child }) => { if (child.id !== agent.id) child.ctx.tools.presentAs("ptc"); });
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
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(f.ctx.agents.get(SessionId(workerId))?.status).toBe("running");
    expect(workerCalls).toBe(1);
    expect(f.adapter.requests.find(options => options.sessionId === workerId)?.tools?.map(tool => tool.name)).toContain("SendMessage");
    release.resolve();
    await f.ctx.agents.get(SessionId(workerId))!.whenIdle();
    expect(workerCalls).toBe(2);
    const recovered = createNativeMessageBroker((f.ctx.projectMode as any).access, async () => false);
    await recovered.recover(agent.id);
    await recovered.recover(agent.id);
    using observed = await f.ctx.sessionQuery.observeSession(SessionId(workerId));
    expect(observed.events.filter(event => event.type === "turn/start")).toHaveLength(1);
    expect(observed.events.filter(event => event.type === "tool/call" && event.data.name === "run_code")).toHaveLength(0);
    expect(observed.events.filter(event => event.type === "user/message" && event.data.source.kind === "moa-background-result")).toHaveLength(0);
    expect(observed.events.filter(event => event.type === "user/message" && event.data.source.kind === "moa-message" && event.data.source.replyTo)).toHaveLength(0);
    expect(workerCalls).toBe(2);
    recovered.dispose();
  } finally {
    release.resolve();
    await f.dispose();
  }
});

it("wakes a cold sender for a saved but uncommitted answer once without inventing a root assignment", async () => {
  const f = await fixture();
  const signal = new AbortController().signal;
  try {
    const { agent: root } = await f.ctx.agents.create({ sessionId: SessionId("answer-recovery-root"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(root.id, true, 0, "enable");
    const host = f.ctx.projectMode as any;
    const [worker] = await host.moa.task(root, [{ name: "sender", task: "initial work", role: "General-purpose", workspace: "shared" }], "initial", signal);
    const workerId = SessionId(worker.workerId);
    await expect.poll(() => f.ctx.agents.get(workerId)).toBeUndefined();
    await root.whenIdle();
    const assignments = host.record(root.id).assignments.length;
    await host.access.update(root.id, (record: any) => ({ ...record, operations: { ...record.operations,
      "moa:route:saved-request": { rootId: root.id, senderId: workerId, targetId: root.id, requestId: "saved-request", operationId: "saved-request", state: "answered", answer: "saved exact answer" },
      "moa:receipt:saved-request": { status: "answered", requestId: "saved-request", answer: "saved exact answer" },
    } }));
    let calls = 0;
    f.adapter.handler = options => {
      if (options.sessionId === workerId) {
        calls++;
        expect(JSON.stringify(options.messages)).toContain("saved exact answer");
      }
      return response("used the answer");
    };
    const broker = createNativeMessageBroker(host.access, async () => false);
    await broker.recover(root.id);
    await expect.poll(() => calls).toBe(1);
    await expect.poll(() => f.ctx.agents.get(workerId)).toBeUndefined();
    await broker.recover(root.id);
    using observed = await f.ctx.sessionQuery.observeSession(workerId);
    const replies = observed.events.filter(event => event.type === "user/message" && event.data.source.kind === "moa-message" && event.data.source.replyTo === "saved-request");
    expect(replies).toHaveLength(1);
    expect(replies[0].data.source).toMatchObject({ senderSessionId: root.id, senderName: "Coordinator" });
    expect(host.record(root.id).assignments).toHaveLength(assignments);
    expect(calls).toBe(1);
    broker.dispose();
  } finally { await f.dispose(); }
});

it("reclaims an answer lost after inbox claim into the next explicit wake before inference", async () => {
  const f = await fixture();
  const signal = new AbortController().signal;
  try {
    const { agent: root } = await f.ctx.agents.create({ sessionId: SessionId("claim-answer-root"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(root.id, true, 0, "enable");
    const host = f.ctx.projectMode as any;
    const [worker] = await host.moa.task(root, [{ name: "sender", task: "initial work", role: "General-purpose", workspace: "shared" }], "initial", signal);
    const workerId = SessionId(worker.workerId);
    await expect.poll(() => f.ctx.agents.get(workerId)).toBeUndefined();
    await root.whenIdle();
    await host.access.update(root.id, (record: any) => ({ ...record, operations: { ...record.operations,
      "moa:route:claimed-request": { rootId: root.id, senderId: workerId, targetId: root.id, requestId: "claimed-request", operationId: "claimed-request", state: "answered", answer: "answer survives claim" },
    } }));
    let stopped = false;
    const off = f.ctx.on("agent/pre-step", async ({ agent }, next) => {
      const decision = await next();
      if (!stopped && agent.id === workerId && decision.kind === "enter" && decision.messages.some(message => message.source.kind === "moa-message" && message.source.replyTo === "claimed-request")) {
        stopped = true;
        agent.cancel({ kind: "parent" });
      }
      return decision;
    });
    const broker = createNativeMessageBroker(host.access, async () => false);
    await broker.recover(root.id);
    await expect.poll(() => stopped).toBe(true);
    await expect.poll(() => f.ctx.agents.get(workerId)).toBeUndefined();
    off();
    {
      using observed = await f.ctx.sessionQuery.observeSession(workerId);
      expect(observed.events.some(event => event.type === "user/message" && event.data.source.kind === "moa-message" && event.data.source.replyTo === "claimed-request")).toBe(false);
    }
    let calls = 0;
    f.adapter.handler = options => {
      if (options.sessionId === workerId) {
        calls++;
        expect(JSON.stringify(options.messages)).toContain("answer survives claim");
        expect(JSON.stringify(options.messages)).toContain("resume explicitly");
      }
      return response("recovered");
    };
    await host.messages.send(root, sendMessageSchema.parse({ target: workerId, message: "resume explicitly" }), "resume", signal);
    await expect.poll(() => calls).toBe(1);
    await expect.poll(() => f.ctx.agents.get(workerId)).toBeUndefined();
    await broker.recover(root.id);
    using observed = await f.ctx.sessionQuery.observeSession(workerId);
    expect(observed.events.filter(event => event.type === "user/message" && event.data.source.kind === "moa-message" && event.data.source.replyTo === "claimed-request")).toHaveLength(1);
    expect(calls).toBe(1);
    broker.dispose();
  } finally { await f.dispose(); }
});

it("restores a saved answer through the actual Host restart path without repeating the Request", async () => {
  let f = await fixture(undefined, { keepFiles: true });
  const signal = new AbortController().signal;
  try {
    const { agent: root } = await f.ctx.agents.create({ sessionId: SessionId("restart-answer-root"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(root.id, true, 0, "enable");
    const host = f.ctx.projectMode as any;
    const [worker] = await host.moa.task(root, [{ name: "sender", task: "initial work", role: "General-purpose", workspace: "shared" }], "initial", signal);
    const workerId = SessionId(worker.workerId);
    await expect.poll(() => f.ctx.agents.get(workerId)).toBeUndefined();
    await root.whenIdle();
    await host.access.update(root.id, (record: any) => ({ ...record, operations: { ...record.operations,
      "moa:route:restart-request": { rootId: root.id, senderId: workerId, targetId: root.id, requestId: "restart-request", operationId: "restart-request", state: "answered", answer: "answer survives restart" },
      "moa:receipt:restart-request": { status: "answered", requestId: "restart-request", answer: "answer survives restart" },
    } }));
    const directory = f.root;
    await f.dispose();
    f = await fixture(undefined, { root: directory });
    let calls = 0;
    f.adapter.handler = options => {
      if (options.sessionId === workerId) {
        calls++;
        expect(JSON.stringify(options.messages)).toContain("answer survives restart");
      }
      return response("resumed without asking again");
    };
    await f.ctx.agents.resume({ resumeSessionId: root.id, agentOptions: { provider: "test", model: "test" } });
    await expect.poll(() => calls).toBe(1);
    await expect.poll(() => f.ctx.agents.get(workerId)).toBeUndefined();
    using observed = await f.ctx.sessionQuery.observeSession(workerId);
    expect(observed.events.filter(event => event.type === "user/message" && event.data.source.kind === "moa-message" && event.data.source.replyTo === "restart-request")).toHaveLength(1);
    expect(observed.events.filter(event => event.type === "tool/call" && event.data.name === "SendMessage")).toHaveLength(0);
  } finally { await f.dispose(); }
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

it.each(["native", "ptc"])("keeps Request interruption in its original native turn when %s background policy is also enabled", async (presentation) => {
  const f = await fixture(undefined, { backgroundStrategy: "new-message", backgroundAfterSeconds: 0.01 });
  const parentSaw = Promise.withResolvers<void>();
  const releaseReply = Promise.withResolvers<void>();
  const interrupted = Promise.withResolvers<void>();
  const late = Promise.withResolvers<void>();
  const receiptHeld = Promise.withResolvers<void>();
  const releaseReceipt = Promise.withResolvers<void>();
  let workerId = "", parentAnswered = false;
  let workerCalls = 0;
  let receiptSpy: ReturnType<typeof vi.spyOn> | undefined;
  try {
    if (presentation === "ptc") {
      await f.ctx.plugin((await import("@deepseek-ai/dsh-subprocess-local")).default);
      await f.ctx.plugin((await import("@deepseek-ai/dsh-sandbox-local")).default);
      await f.ctx.plugin((await import("@deepseek-ai/dsh-ptc-runtime-node")).default);
    }
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("protocol-parent"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    const host = f.ctx.projectMode as any;
    const originalUpdate = host.update.bind(host);
    let held = false;
    receiptSpy = vi.spyOn(host, "update").mockImplementation(async (id: any, update: any) => {
      const result = await originalUpdate(id, update);
      if (!held && Object.values(host.record(id)?.operations ?? {}).some((value: any) => value?.status === "interrupted")) {
        held = true;
        receiptHeld.resolve();
        await releaseReceipt.promise;
      }
      return result;
    });
    if (presentation === "ptc") f.ctx.on("agent/created", ({ agent: child }) => { if (child.id !== agent.id) child.ctx.tools.presentAs("ptc"); });
    f.adapter.handler = async options => {
      if (options.sessionId !== agent.id) {
        workerId = options.sessionId;
        workerCalls++;
        const content = JSON.stringify(options.messages);
        if (content.includes("the late protocol answer")) { late.resolve(); return response("used the late answer"); }
        if (content.includes("interrupted")) { interrupted.resolve(); return response("handled urgent input"); }
        const input = { target: agent.id, message: "Which direction?", mode: "request", timeout_ms: 10000 };
        return call("question", input);
      }
      const request = options.messages.find(message => message.source.kind === "moa-message" && message.source.requestId);
      if (!request || request.source.kind !== "moa-message" || parentAnswered) return response("waiting");
      parentSaw.resolve();
      await releaseReply.promise;
      parentAnswered = true;
      return call("answer", { target: request.source.senderId, message: "the late protocol answer", reply_to: request.source.requestId });
    };
    await f.ctx.projectMode.controlForAgent(agent, { action: "spawn", name: "requester", task: "Ask and wait for the answer" }, "spawn", new AbortController().signal);
    await parentSaw.promise;
    const worker = f.ctx.agents.get(SessionId(workerId))!;
    // The timer must already have expired when the urgent message arrives.
    await new Promise(resolve => setTimeout(resolve, 40));
    worker.steer(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "urgent human instruction" }] }));
    await receiptHeld.promise;
    expect(worker.session.snapshotEvents().filter(event => event.type === "tool/result" && event.data.message.toolCallId === "question")).toHaveLength(0);
    worker.steer(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "second urgent direction during receipt persistence" }] }));
    releaseReceipt.resolve();
    await interrupted.promise;
    expect(JSON.stringify(f.adapter.requests.filter(options => options.sessionId === workerId).at(-1)?.messages)).toContain("second urgent direction during receipt persistence");
    const events = worker.session.snapshotEvents();
    expect(events.filter(event => event.type === "turn/start")).toHaveLength(1);
    expect(events.filter(event => event.type === "turn/end" && event.data.reason.kind === "handoff")).toHaveLength(0);
    const result = events.find(event => event.type === "tool/result" && event.data.message.toolCallId === "question");
    expect(result?.type).toBe("tool/result");
    if (result?.type === "tool/result") {
      expect(JSON.stringify(result.data.message.content)).toContain("interrupted");
      expect(result.data.meta ?? {}).not.toHaveProperty("moaBackground");
    }
    expect(workerCalls).toBe(2);
    releaseReply.resolve();
    await late.promise;
    await agent.whenIdle();
    using observed = await f.ctx.sessionQuery.observeSession(SessionId(workerId));
    expect(observed.events.filter(event => event.type === "user/message" && event.data.source.kind === "moa-message" && event.data.source.replyTo)).toHaveLength(1);
    expect(observed.events.filter(event => event.type === "user/message" && event.data.source.kind === "moa-background-result")).toHaveLength(0);
  } finally { releaseReceipt.resolve(); releaseReply.resolve(); receiptSpy?.mockRestore(); await f.dispose(); }
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
    const delivered = inbox.filter(
      (message) =>
        message.source.kind === "moa-message" &&
        message.source.operationId === "stable-operation",
    );
    expect(delivered).toHaveLength(1);
    expect(delivered[0].source).toMatchObject({ senderSessionId: agent.id, senderName: "Coordinator" });
    expect(delivered[0].content).toEqual([{ type: "text", text: `From: ${agent.id}\nonce` }]);
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
    using observed = await f.ctx.sessionQuery.observeSession(SessionId(bId));
    const request = observed.events.find(event => event.type === "user/message" && event.data.source.kind === "moa-message" && event.data.source.requestId);
    expect(request?.data.source).toMatchObject({ senderId: aId, senderSessionId: aId, senderName: "a" });
  } finally {
    release.resolve();
    await f.dispose();
  }
});
