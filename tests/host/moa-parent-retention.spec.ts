import { expect, it } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import type { SessionController } from "@deepseek-ai/dsh-api-session-controller";
import { fixture, response } from "./fixture.ts";

async function family() {
  const f = await fixture();
  const release = Promise.withResolvers<void>();
  const signal = new AbortController().signal;
  const root = await f.ctx.agents.create({ sessionId: SessionId("ui-family-root"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
  await f.ctx.projectMode.setEnabled(root.agent.id, true, 0, "enable");
  f.adapter.handler = async (options) => { if (options.sessionId !== root.agent.id) await release.promise; return response("initial result"); };
  const host = f.ctx.projectMode as any;
  const [leader] = await host.moa.dispatch(root.agent, [{ name: "leader", task: "coordinate", role: "General-purpose", workspace: "shared", nested: true }], "leader", signal);
  const parent = f.ctx.agents.get(SessionId(leader.workerId))!;
  const [child] = await host.moa.dispatch(parent, [{ name: "child", task: "inspect", role: "General-purpose", workspace: "shared", reportTo: root.agent.id }], "child", signal);
  release.resolve();
  await expect.poll(() => f.ctx.agents.get(parent.id)).toBeUndefined();
  await expect.poll(() => f.ctx.agents.get(SessionId(child.workerId))).toBeUndefined();
  await root.agent.whenIdle();
  return { ...f, rootHandle: root, parentId: parent.id, childId: SessionId(child.workerId), release };
}

it("retains a cold native parent chain for human input without inventing parent work", async () => {
  const f = await family();
  const control = new AbortController();
  let stream: AsyncGenerator<unknown> | undefined;
  try {
    await f.rootHandle.dispose();
    const resolver: Pick<SessionController, "resolveAgent"> = { resolveAgent: (id) => f.ctx.agents.resume({ resumeSessionId: id, agentOptions: { provider: "test", model: "test" } }) };
    await f.ctx.provide("sessionController", resolver as SessionController);
    let parentTurns: number;
    {
      using before = await f.ctx.sessionQuery.observeSession(f.parentId);
      parentTurns = before.events.filter(event => event.type === "turn/start").length;
    }
    f.adapter.requests.length = 0;
    f.adapter.handler = () => response("human task result");
    stream = (f.ctx.projectMode as any).followWorkerParent(f.rootHandle.agent.id, f.childId, control.signal);
    expect(await stream!.next()).toMatchObject({ done: false, value: { workerId: f.childId, parentSessionId: f.parentId } });
    expect(f.ctx.agents.get(f.rootHandle.agent.id)).toBeDefined();
    expect(f.ctx.agents.get(f.parentId)).toBeDefined();
    expect(f.ctx.agents.get(f.childId)).toBeDefined();
    expect(f.adapter.requests).toHaveLength(0);
    const receipt = await f.ctx.subagents.prompt({ parentSessionId: f.parentId, childSessionId: f.childId, requestId: "human-child-input" as any, mode: "continuable", delivery: "steer", content: [{ type: "text", text: "human changed this nested task" }] }, new AbortController().signal);
    expect(receipt.messageId).toBeTruthy();
    await expect.poll(() => f.adapter.requests.filter(request => request.sessionId === f.childId).length).toBe(1);
    await f.ctx.agents.get(f.childId)!.whenIdle();
    expect(f.adapter.requests.some(request => request.sessionId === f.parentId)).toBe(false);
    control.abort();
    await stream!.return(undefined);
    await expect.poll(() => f.ctx.agents.get(f.childId)).toBeUndefined();
    await expect.poll(() => f.ctx.agents.get(f.parentId)).toBeUndefined();
    using after = await f.ctx.sessionQuery.observeSession(f.parentId);
    expect(after.events.filter(event => event.type === "turn/start")).toHaveLength(parentTurns);
  } finally { control.abort(); await stream?.return(undefined); await f.dispose(); }
});

it.each(["delete", "unload"] as const)("releases a visible nested parent's residency on %s", async (action) => {
  const f = await family();
  const control = new AbortController();
  let stream: AsyncGenerator<unknown> | undefined;
  try {
    stream = (f.ctx.projectMode as any).followWorkerParent(f.rootHandle.agent.id, f.childId, control.signal);
    await stream!.next();
    if (action === "delete") {
      await f.ctx.projectMode.controlForAgent(f.rootHandle.agent, { action: "delete", worker_id: f.childId }, "delete-child", new AbortController().signal);
    } else await f.plugin.dispose();
    expect(await stream!.next()).toEqual({ value: undefined, done: true });
    await expect.poll(() => f.ctx.agents.get(f.parentId)).toBeUndefined();
  } finally { control.abort(); await stream?.return(undefined); await f.dispose(); }
});

it("closing the view releases its hold without cancelling the human's running task", async () => {
  const f = await family();
  const control = new AbortController();
  const running = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>();
  let stream: AsyncGenerator<unknown> | undefined;
  try {
    f.adapter.handler = async options => {
      if (options.sessionId === f.childId) { running.resolve(); await finish.promise; }
      return response("human work completed after the view closed");
    };
    stream = (f.ctx.projectMode as any).followWorkerParent(f.rootHandle.agent.id, f.childId, control.signal);
    await stream!.next();
    await f.ctx.subagents.prompt({ parentSessionId: f.parentId, childSessionId: f.childId, requestId: "long-human-input" as any, mode: "continuable", delivery: "steer", content: [{ type: "text", text: "keep working when I close the tab" }] }, new AbortController().signal);
    await running.promise;
    control.abort();
    await stream!.return(undefined);
    const child = f.ctx.agents.get(f.childId)!;
    expect(child.status).toBe("running");
    expect(child.moaAborting).toBe(false);
    finish.resolve();
    await expect.poll(() => f.ctx.agents.get(f.childId)).toBeUndefined();
    await expect.poll(() => f.ctx.agents.get(f.parentId)).toBeUndefined();
    await f.rootHandle.agent.whenIdle();
    expect(JSON.stringify(f.rootHandle.agent.session.snapshotEvents())).toContain("human work completed after the view closed");
  } finally { finish.resolve(); control.abort(); await stream?.return(undefined); await f.dispose(); }
});

it("validates the owning project before retaining any native parent", async () => {
  const f = await family();
  try {
    const stream = (f.ctx.projectMode as any).followWorkerParent(SessionId("unrelated"), f.childId, new AbortController().signal);
    await expect(stream.next()).rejects.toThrow("not-owned");
    expect(f.ctx.agents.get(f.parentId)).toBeUndefined();
  } finally { await f.dispose(); }
});

it("uses the existing native Remote session authorization before parent acquisition", async () => {
  const f = await family();
  try {
    const { default: Access } = await import("@deepseek-ai/dsh-api-remote-access");
    const { Peer } = await import("@deepseek-ai/dsh-client-connection");
    await f.ctx.plugin(Access);
    const peer = new Peer(f.ctx, { principal: { kind: "parent-retention-guest" } as never });
    const call = f.ctx.extend({ invocation: { request: { namespace: "projectMode", method: "followWorkerParent", args: {} }, service: "projectMode", peer, signal: new AbortController().signal, uplink: () => ({ async *[Symbol.asyncIterator]() {} }) } });
    const stream = call.projectMode.followWorkerParent(f.rootHandle.agent.id, f.childId, new AbortController().signal)[Symbol.asyncIterator]();
    await expect(stream.next()).rejects.toThrow("unauthorized");
    expect(f.ctx.agents.get(f.parentId)).toBeUndefined();
    expect(f.ctx.agents.get(f.childId)).toBeUndefined();
  } finally { await f.dispose(); }
});
