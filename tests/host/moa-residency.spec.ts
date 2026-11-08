import { expect, it, vi } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { fixture, response } from "./fixture.ts";
import { withManagedAgent } from "../../packages/project-mode/src/host/moa/residency.ts";
import { createUserMessage, type StreamChunk } from "@deepseek-ai/dsh-llm";

it("restores the true cold parent chain without inventing intermediate work", async () => {
  const f = await fixture();
  const signal = new AbortController().signal;
  const creatorId = SessionId("resident-creator"), childId = SessionId("resident-child");
  const release = Promise.withResolvers<void>();
  try {
    const { agent: root } = await f.ctx.agents.create({ sessionId: SessionId("resident-root"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(root.id, true, 0, "enable");
    const host = (f.ctx.projectMode as any).access;
    const workers = (f.ctx.projectMode as any).workers;
    await host.update(root.id, (r: any) => ({ ...r, operations: { ...r.operations, [`moa:agent:${creatorId}`]: { nested: true, role: "General-purpose" } } }));
    f.adapter.handler = async (options) => {
      if (options.sessionId === creatorId) await release.promise;
      return response("initial result");
    };
    await workers.spawnMoA(root, { childId: creatorId, name: "creator", task: "prepare", cwd: f.root, identity: "creator identity", provider: "spawn" }, "creator", signal);
    const creator = f.ctx.agents.get(creatorId)!;
    await workers.spawnMoA(creator, { childId, name: "child", task: "inspect", cwd: f.root, identity: "child identity", provider: "spawn" }, "child", signal);
    release.resolve();
    await expect.poll(() => f.ctx.agents.get(creatorId)).toBeUndefined();
    await expect.poll(() => f.ctx.agents.get(childId)).toBeUndefined();
    let before: number;
    {
      using observed = await f.ctx.sessionQuery.observeSession(creatorId);
      before = observed.events.length;
    }
    let resumedRequests = 0;
    f.adapter.handler = (options) => {
      if (options.sessionId === creatorId) throw new Error("Intermediate parent must not run");
      if (options.sessionId === childId) {
        resumedRequests++;
        expect(JSON.stringify(options.messages)).toContain("new peer instruction");
      }
      return response("resumed result");
    };
    const events: string[] = [];
    const offStart = f.ctx.on("subagent/start", (event) => { events.push(`start:${event.id}`); });
    const offEnd = f.ctx.on("subagent/end", (event) => { events.push(`end:${event.id}`); });
    await (f.ctx.projectMode as any).messages.send(root, { target: childId, message: "new peer instruction", mode: "notify" }, "resumed", signal);
    await expect.poll(() => resumedRequests).toBe(1);
    await expect.poll(() => f.ctx.agents.get(creatorId)).toBeUndefined();
    await expect.poll(() => f.ctx.agents.get(childId)).toBeUndefined();
    using observed = await f.ctx.sessionQuery.observeSession(creatorId);
    expect(observed.events.slice(before).filter((event) => event.type === "turn/start" || event.type === "user/message")).toEqual([]);
    expect(events.filter((event) => event.endsWith(creatorId))).toEqual([]);
    expect(events.filter((event) => event.endsWith(childId))).toEqual([`start:${childId}`, `end:${childId}`]);
    offStart(); offEnd();
  } finally {
    release.resolve();
    await f.dispose();
  }
});

it("retains callback residency across awaits and releases it on failure", async () => {
  const f = await fixture();
  const signal = new AbortController().signal;
  try {
    const { agent: root } = await f.ctx.agents.create({ sessionId: SessionId("borrow-root"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(root.id, true, 0, "enable");
    const receipt = await f.ctx.projectMode.controlForAgent(root, { action: "spawn", name: "borrowed", task: "inspect" }, "spawn", signal) as { workerId: SessionId };
    await expect.poll(() => f.ctx.agents.get(receipt.workerId)).toBeUndefined();
    const host = (f.ctx.projectMode as any).access;
    const entered = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>();
    const use = withManagedAgent(host, receipt.workerId, signal, async (agent) => {
      entered.resolve();
      await finish.promise;
      expect(f.ctx.agents.get(agent.id)).toBe(agent);
      throw new Error("callback failed");
    });
    const check = expect(use).rejects.toThrow("callback failed");
    await entered.promise;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(f.ctx.agents.get(receipt.workerId)).toBeDefined();
    finish.resolve();
    await check;
    await expect.poll(() => f.ctx.agents.get(receipt.workerId)).toBeUndefined();
  } finally { await f.dispose(); }
});

it.each(["ordinary", "result queued during worker observation"])("retains a sleeping worker and the coordinator obligation until a background result returns (%s)", async (boundary) => {
  const f = await fixture();
  const release = Promise.withResolvers<void>();
  const viewEntered = Promise.withResolvers<void>(), releaseView = Promise.withResolvers<void>(), viewReturned = Promise.withResolvers<void>();
  const ingestEntered = Promise.withResolvers<void>(), releaseIngest = Promise.withResolvers<void>();
  let viewSpy: ReturnType<typeof vi.spyOn> | undefined, ingestSpy: ReturnType<typeof vi.spyOn> | undefined;
  const signal = new AbortController().signal;
  try {
    Object.assign((f.ctx.projectMode as any).config, { backgroundStrategy: "after-seconds", backgroundAfterSeconds: 0 });
    f.ctx.tools.register({ name: "residency_slow", description: "Slow owned work", parameters: { type: "object", properties: {} }, output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: String(value) }] }, execute: async () => { await release.promise; return "actual slow result"; } });
    const { agent: root } = await f.ctx.agents.create({ sessionId: SessionId("background-root"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(root.id, true, 0, "enable");
    let childId: SessionId | undefined, childCalls = 0, rootCalls = 0;
    const slept = Promise.withResolvers<void>();
    f.adapter.handler = async (options) => {
      if (options.sessionId === root.id) {
        if (++rootCalls === 1) {
          const receipt = await f.ctx.projectMode.controlForAgent(root, { action: "spawn", name: "slow worker", task: "run and report" }, "spawn-background", signal) as { workerId: SessionId };
          childId = receipt.workerId;
        }
        return response("coordinating");
      }
      if (++childCalls === 1) return [
        { type: "block-start", index: 0, blockType: "tool-call" },
        { type: "tool-call-delta", index: 0, id: "slow", name: "residency_slow", argumentsDelta: "{}" },
        { type: "block-end", index: 0, block: { type: "tool-call", id: "slow", name: "residency_slow", arguments: "{}" } },
        { type: "finish", reason: { kind: "tool-calls" } },
      ] as StreamChunk[];
      if (childCalls === 2) { slept.resolve(); return response("waiting for background"); }
      expect(JSON.stringify(options.messages)).toContain("actual slow result");
      return response("final actual result");
    };
    root.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "perform the task" }] }));
    await slept.promise;
    await expect.poll(() => f.ctx.agents.get(childId!)?.status).toBe("idle");
    expect(f.ctx.agents.get(childId!)).toBeDefined();
    expect(f.ctx.agents.get(childId!)?.moaHasPendingBackground).toBe(true);
    const snapshot = await f.ctx.projectMode.snapshot(root.id);
    expect(snapshot?.workers[0].status).toBe("busy");
    expect(root.session.snapshotEvents().some(event => event.type === "turn/end")).toBe(false);
    const host = f.ctx.projectMode as any;
    let endedBeforeIngestion = 0;
    if (boundary !== "ordinary") {
      await host.access.settledJobs(root.id);
      // Let native turn/end enqueue its result while the guard awaits real views.
      const view = host.view.bind(host), ingest = host.ingest.bind(host);
      let heldView = false, heldIngest = false;
      viewSpy = vi.spyOn(host, "view").mockImplementation(async (...args: any[]) => {
        if (!heldView && args[0].id === childId) {
          heldView = true;
          viewEntered.resolve();
          await releaseView.promise;
          const actual = await view(...args);
          viewReturned.resolve();
          return actual;
        }
        return view(...args);
      });
      ingestSpy = vi.spyOn(host, "ingest").mockImplementation(async (id: any) => {
        if (!heldIngest && id === childId && childCalls === 3) {
          heldIngest = true;
          ingestEntered.resolve();
          await releaseIngest.promise;
        }
        return ingest(id);
      });
      host.notify();
      await viewEntered.promise;
    }
    release.resolve();
    if (boundary !== "ordinary") {
      await ingestEntered.promise;
      await expect.poll(() => f.ctx.agents.get(childId!)?.status ?? "idle").toBe("idle");
      releaseView.resolve();
      await viewReturned.promise;
      await new Promise<void>(resolve => setImmediate(resolve));
      endedBeforeIngestion = root.session.snapshotEvents().filter(event => event.type === "turn/end").length;
      releaseIngest.resolve();
      await host.access.settledJobs(root.id);
    }
    await root.whenIdle();
    await expect.poll(() => f.ctx.agents.get(childId!)).toBeUndefined();
    expect(childCalls).toBe(3);
    expect(JSON.stringify(root.session.snapshotEvents())).toContain("final actual result");
    const rootEvents = root.session.snapshotEvents();
    const timeline = rootEvents.filter(event => event.type === "turn/start" || event.type === "turn/end" || event.type === "user/message" && event.data.source.kind === "project-mode-result")
      .map(event => ({ type: event.type, seq: event.seq, data: event.data }));
    expect(rootEvents.filter(event => event.type === "turn/end"), JSON.stringify(timeline)).toHaveLength(1);
    expect(endedBeforeIngestion).toBe(0);
  } finally { release.resolve(); releaseView.resolve(); releaseIngest.resolve(); viewSpy?.mockRestore(); ingestSpy?.mockRestore(); await f.dispose(); }
});
