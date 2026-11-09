import { expect, it, vi } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import MoAPlugin from "../../packages/moa/src/host/index.ts";
import { fixture, response } from "./fixture.ts";

it("unloads and reloads without permanently closing the surviving coordinator native child admission", async () => {
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("reload-admission"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    await f.plugin.dispose();
    await f.ctx.plugin(MoAPlugin, {});
    const receipt = (await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "spawn", name: "after-reload", task: "work" },
      "new-spawn",
      new AbortController().signal,
    )) as { workerId: ReturnType<typeof SessionId> };
    expect(receipt).toMatchObject({ accepted: true });
    await f.ctx.agents.get(receipt.workerId)?.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    await agent.whenIdle();
    expect(
      (await f.ctx.subagents.listChildren(agent.id)).map((w) => w.id),
    ).toContain(receipt.workerId);
  } finally {
    await f.dispose();
  }
});

it("records native capacity rejection as failed provisioning and lets the admitted work close normally", async () => {
  const f = await fixture(undefined, { maxActiveSubagents: 1 });
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("capacity-parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    const signal = new AbortController().signal;
    let first = true;
    f.adapter.handler = async (options) => {
      if (options.sessionId !== agent.id) {
        await gate;
        return response("worker done");
      }
      if (first) {
        first = false;
        await f.ctx.projectMode.controlForAgent(
          agent,
          { action: "spawn", name: "accepted", task: "work" },
          "accepted",
          signal,
        );
        await expect(
          f.ctx.projectMode.controlForAgent(
            agent,
            { action: "spawn", name: "overflow", task: "work" },
            "overflow",
            signal,
          ),
        ).rejects.toMatchObject({ code: "ACTIVATION_LIMIT_REACHED" });
        const snapshot = await f.ctx.projectMode.snapshot(agent.id);
        expect(
          snapshot?.workers.find((w) => w.name === "overflow"),
        ).toBeUndefined();
        const listed = (await f.ctx.projectMode.controlForAgent(
          agent,
          { action: "list" },
          "list-after-rejection",
          signal,
        )) as import("../../packages/moa/src/shared/index.ts").WorkerView[];
        expect(listed.map((w) => w.name)).toEqual(["accepted"]);
        const failed = (f.ctx.projectMode as any)
          .record(agent.id)
          .workers.find((w: { name: string }) => w.name === "overflow");
        expect(failed).toMatchObject({ lifecycle: "provision-failed" });
        expect(await f.ctx.subagents.listChildren(agent.id)).toHaveLength(1);
        await expect(
          f.ctx.projectMode.controlForAgent(
            agent,
            { action: "spawn", name: "overflow", task: "work" },
            "overflow",
            signal,
          ),
        ).rejects.toMatchObject({ code: "ACTIVATION_LIMIT_REACHED" });
        await f.ctx.projectMode.controlForAgent(
          agent,
          { action: "delete", worker_id: SessionId(failed.id) },
          "delete-rejected",
          signal,
        );
        release();
      }
      return response("reviewed");
    };
    agent.followup(
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "go" }],
      }),
    );
    await agent.whenIdle();
    const events = agent.session.snapshotEvents();
    expect(events.filter((e) => e.type === "turn/start")).toHaveLength(1);
    expect(events.filter((e) => e.type === "turn/end").at(-1)).toMatchObject({
      data: { reason: { kind: "completed" } },
    });
    const host = f.ctx.projectMode as any;
    expect(
      host
        .record(agent.id)
        .assignments.find((a: any) => a.operationId === "overflow"),
    ).toMatchObject({
      admission: "rejected",
      rejection: { code: "ACTIVATION_LIMIT_REACHED" },
    });
    expect(
      events.filter(
        (e) =>
          e.type === "user/message" &&
          e.data.source.kind === "project-mode-result",
      ),
    ).toHaveLength(1);
    const children = await f.ctx.subagents.listChildren(agent.id);
    await f.ctx.subagents.drainChildren(
      agent,
      children.map((child) => child.id),
    );
    const retried = (await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "spawn", name: "after-capacity-release", task: "work" },
      "fresh-operation",
      signal,
    )) as { accepted: boolean; workerId: ReturnType<typeof SessionId> };
    expect(retried.accepted).toBe(true);
    await f.ctx.agents.get(retried.workerId)?.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    await agent.whenIdle();
    expect(
      agent.session
        .snapshotEvents()
        .filter((event) => event.type === "turn/end")
        .at(-1),
    ).toMatchObject({ data: { reason: { kind: "completed" } } });
  } finally {
    release();
    await f.dispose();
  }
});

it("unload drains only Project-owned children and leaves another native child on the same parent running", async () => {
  const f = await fixture();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("owned-only"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    f.adapter.handler = async (options) => {
      if (options.sessionId !== agent.id) {
        await new Promise<void>((resolve, reject) => {
          const abort = () => reject(options.signal.reason);
          options.signal.addEventListener("abort", abort, { once: true });
          void gate.then(() => {
            options.signal.removeEventListener("abort", abort);
            resolve();
          });
          if (options.signal.aborted) abort();
        });
      }
      return response("done");
    };
    const signal = new AbortController().signal;
    const owned = (await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "spawn", name: "owned", task: "work" },
      "owned",
      signal,
    )) as { workerId: ReturnType<typeof SessionId> };
    const external = await f.ctx.subagents.startActivation({
      provider: "spawn",
      childId: SessionId("unmanaged-child"),
      label: "unmanaged",
      delivery: "caller",
      signal,
      request: {
        parent: agent,
        prompt: [{ type: "text", text: "ordinary native work" }],
        cwd: f.root,
      },
    });
    await f.plugin.dispose();
    expect(f.ctx.agents.get(owned.workerId)).toBeUndefined();
    expect(f.ctx.agents.get(external.childId)?.status).toBe("running");
    expect(f.ctx.agents.get(agent.id)).toBe(agent);
    release();
    await external.result;
  } finally {
    release();
    await f.dispose();
  }
});

it("retains uncertainty for an error thrown after a real native admission and reconciles without a duplicate child", async () => {
  const f = await fixture();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("late-error"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    f.adapter.handler = async (options) => {
      if (options.sessionId !== agent.id) {
        await new Promise<void>((resolve, reject) => {
          const abort = () => reject(options.signal.reason);
          options.signal.addEventListener("abort", abort, { once: true });
          void gate.then(() => {
            options.signal.removeEventListener("abort", abort);
            resolve();
          });
          if (options.signal.aborted) abort();
        });
      }
      return response("done");
    };
    const native = f.ctx.subagents.startActivation.bind(f.ctx.subagents);
    f.ctx.subagents.startActivation = async (...args: any[]) => {
      await (native as any)(...args);
      throw new Error("receipt transport failed after acceptance");
    };
    const request = { action: "spawn" as const, name: "worker", task: "work" },
      signal = new AbortController().signal;
    await expect(
      f.ctx.projectMode.controlForAgent(agent, request, "ambiguous", signal),
    ).rejects.toThrow("after acceptance");
    const host = f.ctx.projectMode as any;
    expect(host.record(agent.id).assignments[0].admission).toBe("unknown");
    f.ctx.subagents.startActivation = native;
    const recovered = (await f.ctx.projectMode.controlForAgent(
      agent,
      request,
      "ambiguous",
      signal,
    )) as { workerId: ReturnType<typeof SessionId> };
    expect(recovered).toMatchObject({ accepted: true });
    expect(await f.ctx.subagents.listChildren(agent.id)).toHaveLength(1);
    release();
    await f.ctx.agents.get(recovered.workerId)?.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    await agent.whenIdle();
  } finally {
    release();
    await f.dispose();
  }
});

it("keeps an existing Worker visible when its native execution fails", async () => {
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("failed-execution-parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    f.adapter.handler = (request) => {
      if (request.sessionId !== agent.id)
        throw new Error("worker execution failed");
      return response("reviewed failure");
    };
    const signal = new AbortController().signal;
    const receipt = (await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "spawn", name: "real-worker", task: "work" },
      "spawn",
      signal,
    )) as { workerId: ReturnType<typeof SessionId> };
    await vi.waitFor(async () => {
      const snapshot = await f.ctx.projectMode.snapshot(agent.id);
      expect(
        snapshot!.workers.find((w) => w.workerId === receipt.workerId)?.phase,
      ).toBe("failed");
    });
    await agent.whenIdle();
    const listed = (await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "list" },
      "list",
      signal,
    )) as import("../../packages/moa/src/shared/index.ts").WorkerView[];
    expect(listed).toEqual([
      expect.objectContaining({
        workerId: receipt.workerId,
        lifecycle: "active",
        phase: "failed",
      }),
    ]);
    expect((await f.ctx.projectMode.snapshot(agent.id))!.workers).toEqual([
      expect.objectContaining({
        workerId: receipt.workerId,
        lifecycle: "active",
      }),
    ]);
  } finally {
    await f.dispose();
  }
});
