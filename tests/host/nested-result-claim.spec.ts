import { expect, it, vi } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { fixture, response } from "./fixture.ts";

it("does not readmit a nested result after native inbox claim but before prompt assembly", async () => {
  const f = await fixture();
  const initial = Promise.withResolvers<void>();
  const releaseInitial = Promise.withResolvers<void>();
  const assembling = Promise.withResolvers<void>();
  const releaseAssembly = Promise.withResolvers<void>();
  let leaderId = "", leaderCalls = 0, resultId = "", held = false;
  try {
    const { agent: root } = await f.ctx.agents.create({
      sessionId: SessionId("nested-result-root"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(root.id, true, 0, "enable");
    f.adapter.handler = async options => {
      if (options.sessionId === root.id) return response("root summary");
      if (!leaderId) leaderId = options.sessionId;
      if (options.sessionId === leaderId && leaderCalls++ === 0) {
        initial.resolve();
        await releaseInitial.promise;
      }
      return response(options.sessionId === leaderId ? "leader summary" : "full Scout result");
    };
    const host = f.ctx.projectMode as any;
    const signal = new AbortController().signal;
    const [leader] = await host.moa.dispatch(root, [{
      name: "leader", task: "coordinate Scout", role: "General-purpose",
      workspace: "shared", nested: true,
    }], "leader", signal);
    await initial.promise;
    const target = f.ctx.agents.get(SessionId(leader.workerId))!;
    f.ctx.on("agent/inbox/claimed", ({ agent, message }) => {
      if (agent === target && message.source.kind === "project-mode-result")
        resultId = message.id;
    });
    target.ctx.on("system-prompt/assemble", async (assembly, _context, next) => {
      if (resultId && !held) {
        held = true;
        assembling.resolve();
        await releaseAssembly.promise;
      }
      return next();
    });
    const [scout] = await host.moa.dispatch(target, [{
      name: "Scout", task: "inspect", role: "General-purpose", workspace: "shared",
    }], "Scout", signal);
    await vi.waitFor(() => expect(host.record(root.id).deliveries.some((d: any) =>
      d.targetId === target.id && d.state === "admitted",
    )).toBe(true));
    releaseInitial.resolve();
    await assembling.promise;
    // The native inbox has drained this input, but its user/message is not
    // committed yet. Concurrent result reconciliation must respect the claim.
    await host.outbox.deliver(root.id);
    const replayed = [...target.inbox.nextStep, ...target.inbox.nextTurn].filter(m => m.id === resultId);
    releaseAssembly.resolve();
    await target.whenIdle();
    await f.ctx.projectMode.snapshot(root.id);
    await root.whenIdle();
    expect(replayed).toHaveLength(0);
    expect(target.session.snapshotEvents().filter(e => e.type === "user/message" && e.data.id === resultId)).toHaveLength(1);
    const completion = host.record(root.id).completions.find((c: any) => c.workerId === scout.workerId);
    expect(host.record(root.id).deliveries.find((d: any) => d.completionId === completion.id)).toMatchObject({
      targetId: target.id, state: "consumed", attempts: 1,
    });
  } finally {
    releaseInitial.resolve();
    releaseAssembly.resolve();
    await f.dispose();
  }
});
