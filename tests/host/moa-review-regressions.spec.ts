import { expect, it, vi } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { fixture, response } from "./fixture.ts";

it("unloads a nested family by draining only its root branches", async () => {
  const f = await fixture();
  const release = Promise.withResolvers<void>();
  const signal = new AbortController().signal;
  try {
    const { agent: root } = await f.ctx.agents.create({ sessionId: SessionId("review-unload-root"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(root.id, true, 0, "enable");
    f.adapter.handler = async (options) => {
      if (options.sessionId !== root.id) await release.promise;
      return response("done");
    };
    const host = f.ctx.projectMode as any;
    const [leader] = await host.moa.task(root, [{ name: "leader", task: "coordinate", workspace: "shared", role: "General-purpose", nested: true }], "leader", signal);
    const creator = f.ctx.agents.get(SessionId(leader.workerId))!;
    const [child] = await host.moa.task(creator, [{ name: "child", task: "inspect", workspace: "shared", role: "General-purpose" }], "child", signal);
    const drain = vi.spyOn(f.ctx.subagents, "drainChildren");
    release.resolve();
    await f.plugin.dispose();
    expect(drain.mock.calls.some(([parent, ids]) => parent.id === root.id && ids.includes(SessionId(leader.workerId)))).toBe(true);
    expect(drain.mock.calls.some(([parent, ids]) => parent.id === root.id && ids.includes(SessionId(child.workerId)))).toBe(false);
    expect(f.ctx.agents.get(SessionId(child.workerId))).toBeUndefined();
    expect(f.ctx.tools.get("Task", root)).toBeUndefined();
  } finally { release.resolve(); await f.dispose(); }
});

it("does not resume a Worker after deletion wins a pending native hydration", async () => {
  const f = await fixture();
  const signal = new AbortController().signal;
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const key = Symbol.for("dsh.subagent.withResidentChild");
  const runtime = f.ctx.subagents as any;
  const original = runtime[key].bind(runtime);
  try {
    const { agent: root } = await f.ctx.agents.create({ sessionId: SessionId("review-delete-root"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(root.id, true, 0, "enable");
    const host = f.ctx.projectMode as any;
    const [child] = await host.moa.task(root, [{ name: "child", task: "inspect", workspace: "shared", role: "General-purpose" }], "child", signal);
    const childId = SessionId(child.workerId);
    await expect.poll(() => f.ctx.agents.get(childId)).toBeUndefined();
    let resumed = false;
    f.adapter.handler = (options) => { if (options.sessionId === childId) resumed = true; return response("done"); };
    runtime[key] = async (parent: any, id: any, control: any, use: any) => {
      if (id === childId) { entered.resolve(); await release.promise; }
      return original(parent, id, control, use);
    };
    const sending = host.messages.send(root, { target: childId, message: "new work", mode: "notify", delivery: "steer" }, "race-send", signal);
    const outcome = sending.then(() => "delivered", () => "rejected");
    await entered.promise;
    await host.moa.kill(root, childId, signal, { destroy: true });
    release.resolve();
    expect(await outcome).toBe("rejected");
    expect(resumed).toBe(false);
  } finally { runtime[key] = original; release.resolve(); await f.dispose(); }
});

it("does not inherit an old approval wait into a fresh Fork lifecycle", async () => {
  const f = await fixture();
  const model = Promise.withResolvers<void>();
  const answer = Promise.withResolvers<"allowed-once">();
  const signal = new AbortController().signal;
  try {
    const { ApprovalService } = await import("@deepseek-ai/dsh-user-approval");
    await f.ctx.plugin(ApprovalService);
    f.ctx.on("approval/request", () => answer.promise);
    const { agent: root } = await f.ctx.agents.create({ sessionId: SessionId("review-fork-root"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(root.id, true, 0, "enable");
    f.adapter.handler = async (options) => { if (options.sessionId !== root.id) await model.promise; return response("done"); };
    const host = f.ctx.projectMode as any;
    const [receipt] = await host.moa.task(root, [{ name: "source", task: "inspect", workspace: "shared", role: "General-purpose" }], "source", signal);
    const source = f.ctx.agents.get(SessionId(receipt.workerId))!;
    await expect.poll(() => source.session.snapshotEvents().some(event => event.type === "turn/start")).toBe(true);
    const deciding = f.ctx.approval.request({ agent: source, toolName: "write", reason: "pending source-only approval" });
    expect(host.moa.lifecycle(source)).toBe("Waiting");
    const fork = await host.moa.fork(root, source.id, { name: "fork", task: "separate branch", workspace: "shared", role: "General-purpose" }, "fork", signal);
    const child = f.ctx.agents.get(SessionId(fork.workerId))!;
    await expect.poll(() => child.session.snapshotEvents().some(event => event.type === "turn/start" && event.seq >= child.session.inheritedEventCount)).toBe(true);
    expect(host.moa.lifecycle(child)).toBe("Running");
    answer.resolve("allowed-once");
    await deciding;
  } finally { answer.resolve("allowed-once"); model.resolve(); await f.dispose(); }
});

it("keeps a nested Worker's native direct-parent address in its capsule", async () => {
  const f = await fixture();
  const release = Promise.withResolvers<void>();
  const signal = new AbortController().signal;
  try {
    const { ProjectStore } = await import("../../packages/project-mode/src/client/store.ts");
    const { agent: root } = await f.ctx.agents.create({ sessionId: SessionId("review-address-root"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(root.id, true, 0, "enable");
    f.adapter.handler = async (options) => { if (options.sessionId !== root.id) await release.promise; return response("done"); };
    const host = f.ctx.projectMode as any;
    const [leader] = await host.moa.task(root, [{ name: "leader", task: "coordinate", workspace: "shared", role: "General-purpose", nested: true }], "leader", signal);
    const creator = f.ctx.agents.get(SessionId(leader.workerId))!;
    const [child] = await host.moa.task(creator, [{ name: "child", task: "inspect", workspace: "shared", role: "General-purpose" }], "child", signal);
    const state = await f.ctx.projectMode.snapshot(root.id);
    const store = new ProjectStore(0);
    store.accept(state!);
    const capsule = store.turn(root.id, 0, false).find(item => item.workerId === child.workerId)!;
    expect(capsule).toBeDefined();
    expect(capsule.address.parentSessionId).toBe(creator.id);
    expect(f.ctx.agents.get(SessionId(child.workerId))?.session.header.parentSession).toBe(capsule.address.parentSessionId);
    store.dispose();
  } finally { release.resolve(); await f.dispose(); }
});

it("recovers a persisted answer when the Request waiter exits before its Tool Message commits", async () => {
  const f = await fixture();
  const signal = new AbortController().signal;
  const requestStarted = Promise.withResolvers<void>();
  let requester: any;
  let requestId = "";
  let interrupted = false;
  try {
    const { createNativeMessageBroker, sendMessageSchema } = await import("../../packages/project-mode/src/host/moa/messages.ts");
    const { agent: root } = await f.ctx.agents.create({ sessionId: SessionId("review-answer-root"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(root.id, true, 0, "enable");
    const host = f.ctx.projectMode as any;
    const originalUpdate = host.update.bind(host);
    vi.spyOn(host, "update").mockImplementation(async (id: any, change: any) => {
      const value = await originalUpdate(id, change);
      if (!interrupted && requester && Object.values(host.record(root.id).operations).some((operation: any) => operation?.state === "answered" && operation?.requestId === requestId)) {
        interrupted = true;
        requester.cancel({ kind: "parent" });
        // Sender's abort wins before the saved answer settles the old waiter.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      return value;
    });
    function call(id: string, args: object) {
      const content = JSON.stringify(args);
      return [
        { type: "block-start", index: 0, blockType: "tool-call" },
        { type: "tool-call-delta", index: 0, id, name: "SendMessage", argumentsDelta: content },
        { type: "block-end", index: 0, block: { type: "tool-call", id, name: "SendMessage", arguments: content } },
        { type: "finish", reason: { kind: "tool-calls" } },
      ] as any;
    }
    let workerSteps = 0, rootReplied = false;
    f.adapter.handler = (options) => {
      if (options.sessionId !== root.id) {
        requester = f.ctx.agents.get(SessionId(options.sessionId));
        requestStarted.resolve();
        if (++workerSteps === 1) return call("question", { target: root.id, message: "Need a decision", mode: "request", timeout_ms: 10000 });
        return response("received answer");
      }
      const message = options.messages.find(m => m.source.kind === "moa-message" && m.source.requestId);
      if (message?.source.kind === "moa-message" && !rootReplied) {
        rootReplied = true;
        requestId = message.source.requestId!;
        return call("reply", { target: message.source.senderId, message: "RETAIN THIS ANSWER", reply_to: requestId });
      }
      return response("root done");
    };
    await host.moa.task(root, [{ name: "requester", task: "ask", workspace: "shared", role: "General-purpose" }], "requester", signal);
    await requestStarted.promise;
    await expect.poll(() => interrupted).toBe(true);
    await root.whenIdle();
    const recovered = createNativeMessageBroker(host.access, async () => false);
    await recovered.recover(root.id);
    await recovered.send(root, sendMessageSchema.parse({ target: requester.id, message: "RETAIN THIS ANSWER", reply_to: requestId }), "retry-answer", signal);
    using observed = await f.ctx.sessionQuery.observeSession(requester.id);
    const received = observed.events.some(event => event.type === "user/message" && event.data.source.kind === "moa-message" && event.data.source.replyTo === requestId);
    const committedToolAnswer = observed.events.some(event => event.type === "tool/result" && !event.data.message.isError && JSON.stringify(event.data.message.content).includes("RETAIN THIS ANSWER"));
    expect(received || committedToolAnswer).toBe(true);
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("retains a dispatched capsule after a root handoff when the client reconnects", async () => {
  const f = await fixture();
  const tool = Promise.withResolvers<void>(), worker = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>(), resumed = Promise.withResolvers<void>();
  const signal = new AbortController().signal;
  try {
    const { createUserMessage } = await import("@deepseek-ai/dsh-llm");
    const { ProjectStore } = await import("../../packages/project-mode/src/client/store.ts");
    const { defineTool } = await import("@deepseek-ai/dsh-tools");
    f.ctx.tools.register(defineTool({ name: "review_root_slow", description: "Hold a root foreground call", backgroundOnMessage: true, parameters: {}, output: { schema: { type: "string" }, render: (_args, value: string) => [{ type: "text", text: value }] }, execute: async () => { started.resolve(); await tool.promise; return "slow result"; } }));
    const { agent: root } = await f.ctx.agents.create({ sessionId: SessionId("review-handoff-root"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(root.id, true, 0, "enable");
    const host = f.ctx.projectMode as any;
    let first = true, childId = "";
    f.adapter.handler = async (options) => {
      if (options.sessionId !== root.id) { await worker.promise; return response("worker done"); }
      if (!first) { resumed.resolve(); return response("responding to new input"); }
      first = false;
      const [created] = await host.moa.task(root, [{ name: "worker", task: "inspect", workspace: "shared", role: "General-purpose" }], "dispatch-before-handoff", signal);
      childId = created.workerId;
      return [
        { type: "block-start", index: 0, blockType: "tool-call" },
        { type: "tool-call-delta", index: 0, id: "root-slow", name: "review_root_slow", argumentsDelta: "{}" },
        { type: "block-end", index: 0, block: { type: "tool-call", id: "root-slow", name: "review_root_slow", arguments: "{}" } },
        { type: "finish", reason: { kind: "tool-calls" } },
      ] as any;
    };
    root.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "dispatch and investigate" }] }));
    await started.promise;
    root.steer(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "new urgent direction" }] }));
    await resumed.promise;
    expect(root.session.snapshotEvents().filter(event => event.type === "turn/end").map(event => event.data.reason.kind)).toEqual(["handoff"]);
    const snapshot = await f.ctx.projectMode.snapshot(root.id);
    expect(snapshot!.turnMemberships.some(member => member.coordinatorTurn === 1 && member.workerId === childId)).toBe(true);
    const fresh = new ProjectStore(0);
    fresh.accept(snapshot!);
    expect(fresh.turn(root.id, 1, true).some(capsule => capsule.workerId === childId)).toBe(true);
    const originalKey = fresh.turn(root.id, 1, true)[0].key;
    worker.resolve();
    await root.whenIdle();
    const finished = await f.ctx.projectMode.snapshot(root.id);
    fresh.accept(finished!);
    expect(fresh.turn(root.id, 1, true)[0]).toMatchObject({ key: originalKey, status: "completed" });
    fresh.dispose();
  } finally { tool.resolve(); worker.resolve(); await f.dispose(); }
});
