import { expect, it, vi } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { fixture, response } from "./fixture.ts";

async function parent(f: Awaited<ReturnType<typeof fixture>>, id: string) {
  const { agent } = await f.ctx.agents.create({
    sessionId: SessionId(id),
    meta: { cwd: f.root },
    agentOptions: { provider: "test", model: "test" },
  });
  await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
  return agent;
}
const input = () =>
  createUserMessage({
    source: { kind: "user" },
    content: [{ type: "text", text: "continue" }],
  });

it.each(["deleting", "deleted"] as const)(
  "keeps a %s worker tombstone after recovering an accepted native admission",
  async (state) => {
    const f = await fixture();
    const release = Promise.withResolvers<void>(),
      entered = Promise.withResolvers<void>();
    try {
      const agent = await parent(f, "deleted-receipt"),
        host = f.ctx.projectMode as any;
      const native = f.ctx.subagents.startActivation.bind(f.ctx.subagents);
      f.ctx.subagents.startActivation = async (...args: any[]) => {
        await (native as any)(...args);
        throw new Error("lost receipt");
      };
      await expect(
        f.ctx.projectMode.controlForAgent(
          agent,
          { action: "spawn", name: "w", task: "work" },
          "spawn",
          new AbortController().signal,
        ),
      ).rejects.toThrow("lost receipt");
      f.ctx.subagents.startActivation = native;
      const assignment = host.record(agent.id).assignments[0];
      const drain = f.ctx.subagents.drainChildren.bind(f.ctx.subagents);
      if (state === "deleting")
        f.ctx.subagents.drainChildren = async (...args: any[]) => {
          entered.resolve();
          await release.promise;
          return (drain as any)(...args);
        };
      const deletion = f.ctx.projectMode.controlForAgent(
        agent,
        { action: "delete", worker_id: SessionId(assignment.workerId) },
        "delete",
        new AbortController().signal,
      );
      if (state === "deleting") await entered.promise;
      else {
        await deletion;
        await host.guardTurn(agent, 1, new AbortController().signal);
      }
      if (state === "deleting")
        await host.workers.reconcileAssignment(agent, assignment.id);
      else await host.recover(agent.id);
      expect(host.record(agent.id).workers[0].lifecycle).toBe(state);
      release.resolve();
      await deletion;
      expect(host.record(agent.id).assignments[0].admission).toBe("accepted");
    } finally {
      release.resolve();
      await f.dispose();
    }
  },
);

it("closes a native turn when consumed delivery retains an exhausted error", async () => {
  const f = await fixture();
  try {
    const agent = await parent(f, "consumed-error"),
      host = f.ctx.projectMode as any;
    f.adapter.handler = () => response("done");
    const receipt = (await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "spawn", name: "w", task: "work" },
      "spawn",
      new AbortController().signal,
    )) as { workerId: ReturnType<typeof SessionId> };
    await f.ctx.agents.get(receipt.workerId)?.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    await agent.whenIdle();
    await host.update(agent.id, (r: any) => ({
      ...r,
      deliveries: r.deliveries.map((d: any) => ({
        ...d,
        state: "consumed",
        attempts: 99,
        lastError: "old error",
      })),
    }));
    expect(host.record(agent.id).deliveries.length).toBeGreaterThan(0);
    agent.followup(input());
    await agent.whenIdle();
    expect(
      agent.session
        .snapshotEvents()
        .filter((e) => e.type === "turn/end")
        .at(-1)?.data.reason.kind,
    ).toBe("completed");
  } finally {
    await f.dispose();
  }
});

it("does not block another Project snapshot or native turn on a pending Project job", async () => {
  const f = await fixture(),
    gate = Promise.withResolvers<void>(),
    entered = Promise.withResolvers<void>();
  try {
    const a = await parent(f, "pending-a"),
      b = await parent(f, "pending-b"),
      host = f.ctx.projectMode as any;
    await host.jobs;
    host.enqueue(a.id, async () => {
      entered.resolve();
      await gate.promise;
    });
    await entered.promise;
    const snapshot = f.ctx.projectMode.snapshot(b.id);
    await expect(
      Promise.race([
        snapshot.then(() => "ready"),
        new Promise((resolve) => setTimeout(() => resolve("blocked"), 250)),
      ]),
    ).resolves.toBe("ready");
    f.adapter.handler = () => response("done");
    b.followup(input());
    await vi.waitFor(() =>
      expect(
        b.session
          .snapshotEvents()
          .filter((e) => e.type === "turn/end")
          .at(-1)?.data.reason.kind,
      ).toBe("completed"),
    );
  } finally {
    gate.resolve();
    await f.dispose();
  }
});
