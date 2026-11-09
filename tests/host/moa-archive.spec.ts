import { expect, it, vi } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { WorkspaceActiveSessionError } from "@deepseek-ai/dsh-workspace";
import MoAPlugin from "../../packages/moa/src/host/index.ts";
import { fixture, response } from "./fixture.ts";

async function project(f: Awaited<ReturnType<typeof fixture>>, id: string) {
  const { agent } = await f.ctx.agents.create({
    sessionId: SessionId(id),
    meta: { cwd: f.root },
    agentOptions: { provider: "test", model: "test" },
  });
  await f.ctx.projectMode.setEnabled(agent.id, true, 0, `enable-${id}`);
  const receipt = await f.ctx.projectMode.controlForAgent(
    agent,
    { action: "spawn", name: `${id}-worker`, task: "work" },
    `spawn-${id}`,
    new AbortController().signal,
  );
  const workerId = SessionId((receipt as { workerId: string }).workerId);
  return { agent, workerId, worker: f.ctx.agents.get(workerId)! };
}

async function settled(
  f: Awaited<ReturnType<typeof fixture>>,
  parentId: ReturnType<typeof SessionId>,
  workerId: ReturnType<typeof SessionId>,
) {
  await vi.waitFor(async () => {
    const snapshot = await f.ctx.projectMode.snapshot(parentId);
    expect(snapshot!.workers.find((w) => w.workerId === workerId)?.status).toBe(
      "idle",
    );
    using observed = await f.ctx.sessionQuery.observeSession(parentId);
    expect(
      observed.events.some(
        (e) =>
          e.type === "user/message" &&
          e.data.source.kind === "project-mode-result" &&
          e.data.source.workerId === workerId,
      ),
    ).toBe(true);
  });
  await f.ctx.agents.get(parentId)?.whenIdle();
}

it("archives the Project family durably and restores only children archived with it", async () => {
  const f = await fixture(undefined, { workspace: true });
  try {
    const { agent, workerId, worker } = await project(f, "family");
    await settled(f, agent.id, workerId);
    const separate = await project(f, "separate");
    await settled(f, separate.agent.id, separate.workerId);
    const second = await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "spawn", name: "already-archived", task: "work" },
      "spawn-second",
      new AbortController().signal,
    );
    const secondId = SessionId((second as { workerId: string }).workerId);
    await settled(f, agent.id, secondId);
    const registry = f.ctx.workspaceRegistry;
    await registry.archiveSession(secondId);
    await registry.pinSession(workerId);
    const requests = f.adapter.requests.length;

    await registry.archiveSession(agent.id);
    await vi.waitFor(() =>
      expect(registry.archivedSessionIds).toContain(workerId),
    );
    expect(registry.archivedSessionIds).toEqual(
      expect.arrayContaining([agent.id, workerId, secondId]),
    );
    expect(registry.archivedSessionIds).not.toContain(separate.workerId);
    expect(registry.pinnedSessionIds).not.toContain(workerId);

    // Native Undo / restore returns the same sessions, but preserves a child
    // the user had independently archived before archiving the parent.
    await registry.unarchiveSession(agent.id);
    await vi.waitFor(() =>
      expect(registry.archivedSessionIds).not.toContain(workerId),
    );
    expect(registry.archivedSessionIds).toEqual([secondId]);
    expect(f.adapter.requests).toHaveLength(requests);
    expect((await f.ctx.projectMode.snapshot(agent.id))!.workers).toHaveLength(
      2,
    );
  } finally {
    await f.dispose();
  }
});

it("repairs an already archived parent's children on load and recovers a pending restore", async () => {
  const f = await fixture(undefined, { workspace: true });
  try {
    const { agent, workerId, worker } = await project(f, "recovery");
    await settled(f, agent.id, workerId);
    const requests = f.adapter.requests.length;
    await f.plugin.dispose();
    await f.ctx.workspaceRegistry.archiveSession(agent.id);
    expect(f.ctx.workspaceRegistry.archivedSessionIds).not.toContain(workerId);
    let plugin = await f.ctx.plugin(MoAPlugin, {});
    await vi.waitFor(() =>
      expect(f.ctx.workspaceRegistry.archivedSessionIds).toContain(workerId),
    );
    await plugin.dispose();
    await f.ctx.workspaceRegistry.unarchiveSession(agent.id);
    expect(f.ctx.workspaceRegistry.archivedSessionIds).toContain(workerId);
    plugin = await f.ctx.plugin(MoAPlugin, {});
    await vi.waitFor(() =>
      expect(f.ctx.workspaceRegistry.archivedSessionIds).not.toContain(
        workerId,
      ),
    );
    expect(f.adapter.requests).toHaveLength(requests);
  } finally {
    await f.dispose();
  }
});

it("preserves native busy refusal and archives children after explicit stop-and-archive", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture(undefined, { workspace: true });
  f.adapter.handler = async () => {
    await gate;
    return response("done");
  };
  try {
    const { agent, workerId, worker } = await project(f, "busy");
    await expect(
      f.ctx.workspaceRegistry.archiveSession(agent.id),
    ).rejects.toBeInstanceOf(WorkspaceActiveSessionError);
    expect(f.ctx.workspaceRegistry.archivedSessionIds).toEqual([]);
    await f.ctx.workspaceRegistry.archiveSession(agent.id, {
      stopActivity: true,
    });
    await vi.waitFor(() =>
      expect(f.ctx.workspaceRegistry.archivedSessionIds).toContain(workerId),
    );
    release();
    await worker.whenIdle();
    using observed = await f.ctx.sessionQuery.observeSession(workerId);
    expect(
      observed.events.some(
        (e) => e.type === "turn/end" && e.data.reason.kind === "aborted",
      ),
    ).toBe(true);
  } finally {
    release();
    await f.dispose();
  }
});
