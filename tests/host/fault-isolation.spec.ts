import { expect, it, vi } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { fixture, response } from "./fixture.ts";

type RecoveryProbe = {
  enqueue(id: ReturnType<typeof SessionId>, work: () => Promise<void>): void;
  recover(id: ReturnType<typeof SessionId>): Promise<void>;
  jobs: Promise<void>;
};
const input = () =>
  createUserMessage({
    source: { kind: "user" },
    content: [{ type: "text", text: "Continue the project" }],
  });
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function parent(f: Fixture, id: string) {
  const { agent } = await f.ctx.agents.create({
    sessionId: SessionId(id),
    meta: { cwd: f.root },
    agentOptions: { provider: "test", model: "test" },
  });
  await f.ctx.projectMode.setEnabled(agent.id, true, 0, `enable-${id}`);
  return agent;
}
async function failRecoveryOnce(f: Fixture, id: ReturnType<typeof SessionId>) {
  const host = f.ctx.projectMode as unknown as RecoveryProbe;
  await host.jobs;
  const observe = f.ctx.sessionQuery.observeSession.bind(f.ctx.sessionQuery);
  const spy = vi
    .spyOn(f.ctx.sessionQuery, "observeSession")
    .mockImplementation((sessionId, options) =>
      sessionId === id
        ? Promise.reject(new Error("temporary project observation failure"))
        : observe(sessionId, options),
    );
  try {
    host.enqueue(id, () => host.recover(id));
    await host.jobs;
  } finally {
    spy.mockRestore();
  }
}

it("keeps recovered background failures from poisoning another Project or future turns", async () => {
  const f = await fixture();
  try {
    const a = await parent(f, "fault-a"),
      b = await parent(f, "fault-b");
    f.adapter.handler = () => response("done");
    b.followup(input());
    await b.whenIdle();
    const lastReason = (agent: typeof a) =>
      agent.session
        .snapshotEvents()
        .filter((event) => event.type === "turn/end")
        .at(-1)!.data.reason.kind;
    expect(lastReason(b)).toBe("completed");
    await failRecoveryOnce(f, a.id);
    b.followup(input());
    await b.whenIdle();
    expect(lastReason(b)).toBe("completed");
    a.followup(input());
    await a.whenIdle();
    expect(lastReason(a)).toBe("completed");
  } finally {
    await f.dispose();
  }
});

it("still waits for its own Worker result after a background observation failure", async () => {
  const f = await fixture(),
    gate = Promise.withResolvers<void>();
  try {
    const agent = await parent(f, "fault-with-worker");
    let workerId: ReturnType<typeof SessionId> | undefined;
    f.adapter.handler = async (request) => {
      if (request.sessionId !== agent.id) {
        await gate.promise;
        return response("worker finished");
      }
      if (!workerId) {
        const receipt = (await f.ctx.projectMode.controlForAgent(
          agent,
          { action: "spawn", name: "working", task: "finish after release" },
          "spawn",
          new AbortController().signal,
        )) as { workerId: ReturnType<typeof SessionId> };
        workerId = receipt.workerId;
      }
      return response("coordinator reply");
    };
    agent.followup(input());
    await vi.waitFor(() => expect(workerId).toBeDefined());
    await failRecoveryOnce(f, agent.id);
    await vi.waitFor(() => expect(agent.status).toBe("running"));
    expect(
      agent.session.snapshotEvents().filter((e) => e.type === "turn/end"),
    ).toEqual([]);
    gate.resolve();
    await agent.whenIdle();
    expect(
      agent.session
        .snapshotEvents()
        .filter((e) => e.type === "turn/end")
        .at(-1)?.data.reason.kind,
    ).toBe("completed");
    expect(
      f.adapter.requests
        .filter((r) => r.sessionId === agent.id)
        .at(-1)
        ?.messages.some((m) => m.source.kind === "project-mode-result"),
    ).toBe(true);
  } finally {
    gate.resolve();
    await f.dispose();
  }
});
