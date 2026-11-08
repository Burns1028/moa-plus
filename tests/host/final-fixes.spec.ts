import { expect, it, vi } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type { Agent } from "@deepseek-ai/dsh-agent";
import ProjectMode from "../../packages/project-mode/src/host/index.ts";
import { fixture, response } from "./fixture.ts";

const names = [
  "subagent",
  "subagent_fork",
  "list_agents",
  "send_message",
  "interrupt_agent",
  "list_subagent_models",
];
const tool = (name: string) => ({
  name,
  description: "native sentinel",
  parameters: { type: "object" as const, properties: {} },
  output: { schema: { type: "string" as const }, render: () => [] },
  execute: async () => "native",
});
const input = (text: string) =>
  createUserMessage({
    source: { kind: "user" },
    content: [{ type: "text", text }],
  });
async function parent(f: Awaited<ReturnType<typeof fixture>>, id: string) {
  const { agent } = await f.ctx.agents.create({
    sessionId: SessionId(id),
    meta: { cwd: f.root },
    agentOptions: { provider: "test", model: "test" },
  });
  await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
  return agent;
}
async function stoppedBeforeRelease(agent: Agent) {
  agent.cancel({ kind: "user" }, { keepInbox: true });
  let idle = false;
  void agent.whenIdle().then(() => {
    idle = true;
  });
  await vi.waitFor(() => expect(idle).toBe(true), {
    timeout: 400,
    interval: 5,
  });
  expect(
    agent.session
      .snapshotEvents()
      .filter((e) => e.type === "turn/end")
      .at(-1),
  ).toMatchObject({ data: { reason: { kind: "aborted" } } });
}

it("owns native tool restrictions independently of an earlier mask and restores only its own layer", async () => {
  const f = await fixture();
  try {
    for (const name of [...names, "unrelated"])
      f.ctx.tools.register(tool(name));
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("masked"),
      meta: { cwd: f.root },
    });
    const prior = agent.ctx.tools.restrict({ deny: names });
    const unrelated = agent.ctx.tools.restrict({ deny: ["unrelated"] });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    prior();
    for (const name of names)
      expect(f.ctx.tools.get(name, agent), name).toBeUndefined();
    expect(f.ctx.tools.get("Task", agent)).toBeDefined();
    await f.ctx.projectMode.setEnabled(
      agent.id,
      false,
      f.ctx.projectMode.mode(agent.id).revision,
      "off",
    );
    for (const name of names)
      expect(f.ctx.tools.get(name, agent)).toBeDefined();
    expect(f.ctx.tools.get("unrelated", agent)).toBeUndefined();
    unrelated();
  } finally {
    await f.dispose();
  }
});

it("reconciles all six late native tools synchronously through registration, removal, reload and disable", async () => {
  const f = await fixture();
  try {
    const agent = await parent(f, "late-tools");
    const { agent: ordinary } = await f.ctx.agents.create({
      sessionId: SessionId("ordinary-late"),
    });
    for (const name of names) {
      const remove = f.ctx.tools.register(tool(name));
      expect(f.ctx.tools.get(name, agent), name).toBeUndefined();
      expect(f.ctx.tools.get(name, ordinary)).toBeDefined();
      expect(f.ctx.tools.get(name)).toBeDefined();
      remove();
      f.ctx.tools.register(tool(name));
      expect(f.ctx.tools.get(name, agent), name).toBeUndefined();
    }
    expect(
      f.ctx.tools.schemas(agent).filter((t) => t.name === "Task"),
    ).toHaveLength(1);
    await f.plugin.dispose();
    for (const name of names)
      expect(f.ctx.tools.get(name, agent)).toBeDefined();
    expect(f.ctx.tools.get("Task", agent)).toBeUndefined();
    await f.ctx.plugin(ProjectMode, { completionVerification: false });
    for (const name of names)
      expect(f.ctx.tools.get(name, agent)).toBeUndefined();
    expect(
      f.ctx.tools.schemas(agent).filter((t) => t.name === "Task"),
    ).toHaveLength(1);
    await f.ctx.projectMode.setEnabled(
      agent.id,
      false,
      f.ctx.projectMode.mode(agent.id).revision,
      "off",
    );
    for (const name of names)
      expect(f.ctx.tools.get(name, agent)).toBeDefined();
  } finally {
    await f.dispose();
  }
});

it("native Stop releases an unrelated queued job wait while its worker and native queue survive", async () => {
  const f = await fixture();
  const workerGate = Promise.withResolvers<void>(),
    jobGate = Promise.withResolvers<void>(),
    entered = Promise.withResolvers<void>();
  try {
    const agent = await parent(f, "job-stop"),
      other = await parent(f, "other-project");
    const host = f.ctx.projectMode as any;
    await host.jobs;
    let workerId: ReturnType<typeof SessionId>;
    let first = true;
    f.adapter.handler = async (options) => {
      if (options.sessionId !== agent.id) {
        await workerGate.promise;
        return response("worker final");
      }
      if (first) {
        first = false;
        const receipt = (await f.ctx.projectMode.controlForAgent(
          agent,
          { action: "spawn", name: "worker", task: "one" },
          "spawn",
          new AbortController().signal,
        )) as { workerId: ReturnType<typeof SessionId> };
        workerId = receipt.workerId;
        await f.ctx.projectMode.controlForAgent(
          agent,
          {
            action: "send",
            worker_id: workerId,
            message: "two",
            delivery: "queue",
          },
          "queue",
          new AbortController().signal,
        );
        host.enqueue(agent.id, async () => {
          entered.resolve();
          await jobGate.promise;
          await host.update(other.id, (r: any) => ({
            ...r,
            reminders: { ...r.reminders, unrelated: true },
          }));
        });
      }
      return response("coordinator final");
    };
    agent.followup(input("go"));
    await entered.promise;
    await vi.waitFor(() => expect(host.turns.waiting.has(agent.id)).toBe(true));
    const child = f.ctx.agents.get(workerId!)!;
    await stoppedBeforeRelease(agent);
    expect(child.status).toBe("running");
    expect(child.inbox.nextTurn).toHaveLength(1);
    expect(host.turns.waiting.has(agent.id)).toBe(false);
    jobGate.resolve();
    await host.jobs;
    expect(host.record(other.id).reminders.unrelated).toBe(true);
    expect(agent.inbox.nextStep).toHaveLength(0);
    workerGate.resolve();
    await child.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    await agent.whenIdle();
    const results = agent.session
      .snapshotEvents()
      .filter(
        (e) =>
          e.type === "user/message" &&
          e.data.source.kind === "project-mode-result",
      );
    expect(results).toHaveLength(2);
    expect(new Set(results.map((e) => e.data.id)).size).toBe(2);
  } finally {
    workerGate.resolve();
    jobGate.resolve();
    await f.dispose();
  }
});

it("native Stop releases a cold observation before its backend responds and disposes the late lease", async () => {
  const f = await fixture();
  const gate = Promise.withResolvers<void>(),
    entered = Promise.withResolvers<void>();
  try {
    const agent = await parent(f, "cold-stop");
    const receipt = (await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "spawn", name: "worker", task: "one" },
      "spawn",
      new AbortController().signal,
    )) as { workerId: ReturnType<typeof SessionId> };
    await f.ctx.agents.get(receipt.workerId)?.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    await agent.whenIdle();
    await f.ctx.subagents.drainChildren(agent, [receipt.workerId]);
    const host = f.ctx.projectMode as any;
    await host.jobs;
    const native = f.ctx.sessionQuery.observeSession.bind(f.ctx.sessionQuery);
    let querySignal: AbortSignal | undefined;
    let disposed = false;
    f.ctx.sessionQuery.observeSession = async (id, options) => {
      if (id !== receipt.workerId) return native(id, options);
      querySignal = options?.signal;
      entered.resolve();
      await gate.promise;
      // Deliberately ignore cancellation at the test backend boundary: the
      // plugin must release even a slow backend and dispose a returned lease.
      const observation = await native(id);
      const dispose = observation[Symbol.dispose].bind(observation);
      return {
        ...observation,
        [Symbol.dispose]() {
          disposed = true;
          dispose();
        },
      };
    };
    agent.followup(input("status"));
    await entered.promise;
    await stoppedBeforeRelease(agent);
    expect(querySignal?.aborted).toBe(true);
    gate.resolve();
    await vi.waitFor(() => expect(disposed).toBe(true));
    expect(agent.inbox.nextStep).toHaveLength(0);
    expect(host.turns.waiting.has(agent.id)).toBe(false);
    f.ctx.sessionQuery.observeSession = native;
  } finally {
    gate.resolve();
    await f.dispose();
  }
});

it.each(["admission", "ingestion"] as const)(
  "native Stop releases managed pre-step %s and a later turn consumes each canonical result once",
  async (stage) => {
    const f = await fixture();
    const gate = Promise.withResolvers<void>(),
      entered = Promise.withResolvers<void>();
    let pending: Promise<unknown> | undefined;
    try {
      const agent = await parent(f, `normalize-${stage}`);
      const signal = new AbortController().signal;
      const receipt = (await f.ctx.projectMode.controlForAgent(
        agent,
        { action: "spawn", name: "worker", task: "one" },
        "spawn",
        signal,
      )) as { workerId: ReturnType<typeof SessionId> };
      await f.ctx.agents.get(receipt.workerId)?.whenIdle();
      await f.ctx.projectMode.snapshot(agent.id);
      await agent.whenIdle();
      const host = f.ctx.projectMode as any,
        original = host.update.bind(host);
      let blocked = false;
      host.update = async (
        id: ReturnType<typeof SessionId>,
        change: (r: any) => any,
      ) => {
        const next = change(host.record(id));
        if (
          !blocked &&
          id === agent.id &&
          (stage === "admission"
            ? next.assignments.some(
                (a: any) =>
                  a.operationId === "two" && a.admission === "accepted",
              )
            : next.completions.length === 2)
        ) {
          blocked = true;
          await gate.promise;
        }
        return original(id, change);
      };
      f.ctx.on("agent/pre-step", async ({ agent: subject }, next) => {
        const decision = await next();
        if (
          subject === agent &&
          decision.kind === "enter" &&
          decision.messages.some((m) => m.source.kind === "subagent-settled")
        )
          entered.resolve();
        return decision;
      });
      pending = f.ctx.projectMode.controlForAgent(
        agent,
        {
          action: "send",
          worker_id: receipt.workerId,
          message: "two",
          delivery: "queue",
        },
        "two",
        signal,
      );
      await entered.promise;
      await vi.waitFor(() => expect(blocked).toBe(true));
      await stoppedBeforeRelease(agent);
      expect(host.outbox.normalizing.has(agent.id)).toBe(false);
      const remove = vi.spyOn(agent.inbox, "remove");
      gate.resolve();
      await pending;
      await f.ctx.agents.get(receipt.workerId)?.whenIdle();
      await f.ctx.projectMode.snapshot(agent.id);
      await agent.whenIdle();
      const events = agent.session.snapshotEvents();
      const results = events.filter(
        (e) =>
          e.type === "user/message" &&
          e.data.source.kind === "project-mode-result",
      );
      expect(results).toHaveLength(2);
      expect(new Set(results.map((e) => e.data.id)).size).toBe(2);
      expect(
        events.filter(
          (e) =>
            e.type === "user/message" &&
            e.data.source.kind === "subagent-settled",
        ),
      ).toHaveLength(0);
      expect(remove.mock.calls).toHaveLength(0);
      expect(
        host
          .record(agent.id)
          .deliveries.every((d: any) => d.state === "consumed"),
      ).toBe(true);
    } finally {
      gate.resolve();
      await pending?.catch(() => {});
      await f.dispose();
    }
  },
);

it("reconciles a native registration made reentrantly during its own tools/change notification", async () => {
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("reentrant-tools"),
      meta: { cwd: f.root },
    });
    let registered = false;
    f.ctx.on("tools/change", () => {
      if (!registered && f.ctx.tools.get("Task", agent)) {
        registered = true;
        f.ctx.tools.register(tool("subagent"));
      }
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    expect(registered).toBe(true);
    expect(f.ctx.tools.get("subagent", agent)).toBeUndefined();
    expect(
      f.ctx.tools.schemas(agent).filter((t) => t.name === "Task"),
    ).toHaveLength(1);
  } finally {
    await f.dispose();
  }
});

it("native Stop releases a parked inbox update without a stale reminder or queue mutation", async () => {
  const f = await fixture();
  const gate = Promise.withResolvers<void>(),
    entered = Promise.withResolvers<void>(),
    finished = Promise.withResolvers<void>();
  let coordinator: Agent | undefined;
  try {
    const agent = await parent(f, "parked-update");
    coordinator = agent;
    const host = f.ctx.projectMode as any;
    let workerId: ReturnType<typeof SessionId> | undefined,
      first = true;
    const signal = new AbortController().signal;
    f.adapter.handler = async (options) => {
      if (options.sessionId !== agent.id) {
        await new Promise<void>((_, reject) => {
          const aborted = () => reject(options.signal!.reason);
          options.signal!.addEventListener("abort", aborted, { once: true });
          if (options.signal!.aborted) aborted();
        });
        return [];
      }
      if (first) {
        first = false;
        const receipt = (await f.ctx.projectMode.controlForAgent(
          agent,
          { action: "spawn", name: "parked", task: "one" },
          "spawn",
          signal,
        )) as { workerId: ReturnType<typeof SessionId> };
        workerId = receipt.workerId;
        await f.ctx.projectMode.controlForAgent(
          agent,
          {
            action: "send",
            worker_id: workerId,
            message: "parked native queue",
            delivery: "queue",
          },
          "queued",
          signal,
        );
        await f.ctx.projectMode.controlForAgent(
          agent,
          { action: "interrupt", worker_id: workerId },
          "stop-worker",
          signal,
        );
        await f.ctx.agents.get(workerId)?.whenIdle();
      }
      return response("reviewed");
    };
    const nativeObserve = f.ctx.sessionQuery.observeSession.bind(
        f.ctx.sessionQuery,
      ),
      nativeUpdate = host.update.bind(host);
    host.update = async (
      id: ReturnType<typeof SessionId>,
      change: (r: any) => any,
    ) => {
      if (
        id === agent.id &&
        Object.keys(change(host.record(id)).reminders).length
      ) {
        entered.resolve();
        await gate.promise;
        try {
          return await nativeUpdate(id, change);
        } finally {
          finished.resolve();
        }
      }
      return nativeUpdate(id, change);
    };
    const steer = vi.spyOn(agent, "steer");
    agent.followup(input("inspect parked work"));
    await entered.promise;
    await stoppedBeforeRelease(agent);
    gate.resolve();
    await finished.promise;
    await host.jobs;
    expect(
      steer.mock.calls.filter(([m]) => m.source.kind === "project-mode-notice"),
    ).toHaveLength(0);
    expect(agent.inbox.nextStep).toHaveLength(0);
    expect(Object.keys(host.record(agent.id).reminders)).toHaveLength(0);
    using observation = await nativeObserve(workerId!);
    expect(observation.projections?.values.inbox?.["next-turn"]).toHaveLength(
      1,
    );
    f.ctx.sessionQuery.observeSession = nativeObserve;
    host.update = nativeUpdate;
  } finally {
    gate.resolve();
    await coordinator?.whenIdle();
    await f.dispose();
  }
});

it("native steer reaches the next step in the same turn before an unrelated job releases, without losing worker results", async () => {
  const f = await fixture();
  const workerGate = Promise.withResolvers<void>(),
    jobGate = Promise.withResolvers<void>(),
    entered = Promise.withResolvers<void>();
  let coordinator: Agent | undefined;
  try {
    const agent = (coordinator = await parent(f, "job-steer")),
      other = await parent(f, "other-steer-project");
    const host = f.ctx.projectMode as any;
    await host.jobs;
    let workerId: ReturnType<typeof SessionId>,
      first = true,
      steered = false;
    const signal = new AbortController().signal,
      correction = input("change coordinator plan now");
    f.adapter.handler = async (options) => {
      if (options.sessionId !== agent.id) {
        await workerGate.promise;
        return response("worker final");
      }
      if (first) {
        first = false;
        const receipt = (await f.ctx.projectMode.controlForAgent(
          agent,
          { action: "spawn", name: "worker", task: "one" },
          "spawn",
          signal,
        )) as { workerId: ReturnType<typeof SessionId> };
        workerId = receipt.workerId;
        await f.ctx.projectMode.controlForAgent(
          agent,
          {
            action: "send",
            worker_id: workerId,
            message: "two",
            delivery: "queue",
          },
          "queued",
          signal,
        );
        host.enqueue(agent.id, async () => {
          entered.resolve();
          await jobGate.promise;
          await host.update(other.id, (r: any) => ({
            ...r,
            reminders: { ...r.reminders, unrelated: true },
          }));
        });
      } else if (
        JSON.stringify(options.messages).includes("change coordinator plan now")
      )
        steered = true;
      return response("coordinator report");
    };
    agent.followup(input("go"));
    await entered.promise;
    await vi.waitFor(() => expect(host.turns.waiting.has(agent.id)).toBe(true));
    // Generic worker/projection notifications alone must not bypass the job barrier.
    const requests = f.adapter.requests.length;
    host.notify();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(f.adapter.requests).toHaveLength(requests);
    expect(
      agent.session.snapshotEvents().filter((e) => e.type === "turn/end"),
    ).toHaveLength(0);
    agent.steer(correction);
    await vi.waitFor(() => expect(steered).toBe(true), {
      timeout: 400,
      interval: 5,
    });
    expect(
      agent.session.snapshotEvents().filter((e) => e.type === "turn/start"),
    ).toHaveLength(1);
    expect(
      agent.session.snapshotEvents().filter((e) => e.type === "turn/end"),
    ).toHaveLength(0);
    const child = f.ctx.agents.get(workerId!)!;
    expect(child.status).toBe("running");
    expect(child.inbox.nextTurn).toHaveLength(1);
    jobGate.resolve();
    await host.jobs;
    expect(host.record(other.id).reminders.unrelated).toBe(true);
    workerGate.resolve();
    await child.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    await agent.whenIdle();
    const events = agent.session.snapshotEvents();
    const corrections = events.filter(
      (e) => e.type === "user/message" && e.data.id === correction.id,
    );
    const results = events.filter(
      (e) =>
        e.type === "user/message" &&
        e.data.source.kind === "project-mode-result",
    );
    expect(corrections).toHaveLength(1);
    expect(results).toHaveLength(2);
    expect(
      results.map(
        (e) =>
          e.data.source.kind === "project-mode-result" &&
          e.data.source.workerTurn,
      ),
    ).toEqual([1, 2]);
    expect(corrections[0]!.seq).toBeLessThan(results[0]!.seq);
    expect(new Set(results.map((e) => e.data.id)).size).toBe(2);
    expect(events.filter((e) => e.type === "turn/start")).toHaveLength(1);
    expect(events.filter((e) => e.type === "turn/end")).toMatchObject([
      { data: { reason: { kind: "completed" } } },
    ]);
  } finally {
    workerGate.resolve();
    jobGate.resolve();
    await coordinator?.whenIdle();
    await f.dispose();
  }
});

it("native steer preempts a cold observation in the same turn and releases its late lease without aborting the turn", async () => {
  const f = await fixture();
  const gate = Promise.withResolvers<void>(),
    entered = Promise.withResolvers<void>();
  let coordinator: Agent | undefined;
  try {
    const agent = (coordinator = await parent(f, "query-steer"));
    const receipt = (await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "spawn", name: "worker", task: "one" },
      "spawn",
      new AbortController().signal,
    )) as { workerId: ReturnType<typeof SessionId> };
    await f.ctx.agents.get(receipt.workerId)?.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    await agent.whenIdle();
    await f.ctx.subagents.drainChildren(agent, [receipt.workerId]);
    const host = f.ctx.projectMode as any;
    await host.jobs;
    const original = f.ctx.sessionQuery.observeSession.bind(f.ctx.sessionQuery);
    let first = true,
      querySignal: AbortSignal | undefined,
      disposed = false,
      steered = false;
    f.ctx.sessionQuery.observeSession = async (id, options) => {
      if (id !== receipt.workerId || !first) return original(id, options);
      first = false;
      querySignal = options?.signal;
      entered.resolve();
      await gate.promise;
      const observed = await original(id);
      return {
        ...observed,
        [Symbol.dispose]() {
          disposed = true;
          observed[Symbol.dispose]();
        },
      };
    };
    f.adapter.handler = (options) => {
      if (JSON.stringify(options.messages).includes("revise summary now"))
        steered = true;
      return response("revised summary");
    };
    const baselineTurns = agent.session
      .snapshotEvents()
      .filter((e) => e.type === "turn/start").length;
    agent.followup(input("inspect"));
    await entered.promise;
    agent.steer(input("revise summary now"));
    await vi.waitFor(() => expect(steered).toBe(true), {
      timeout: 400,
      interval: 5,
    });
    expect(querySignal?.aborted).toBe(true);
    await agent.whenIdle();
    const events = agent.session.snapshotEvents();
    expect(events.filter((e) => e.type === "turn/start")).toHaveLength(
      baselineTurns + 1,
    );
    expect(events.filter((e) => e.type === "turn/end").at(-1)).toMatchObject({
      data: { reason: { kind: "completed" } },
    });
    const requestCount = f.adapter.requests.length;
    gate.resolve();
    await vi.waitFor(() => expect(disposed).toBe(true));
    expect(f.adapter.requests).toHaveLength(requestCount);
    expect(agent.inbox.nextStep).toHaveLength(0);
    expect(host.turns.waiting.has(agent.id)).toBe(false);
    f.ctx.sessionQuery.observeSession = original;
  } finally {
    gate.resolve();
    await coordinator?.whenIdle();
    await f.dispose();
  }
});

it("native steer preempts a parked reminder write without late mutation or steering from the previous guard", async () => {
  const f = await fixture();
  const writeGate = Promise.withResolvers<void>(),
    modelGate = Promise.withResolvers<void>(),
    entered = Promise.withResolvers<void>(),
    writeFinished = Promise.withResolvers<void>();
  let coordinator: Agent | undefined;
  try {
    const agent = (coordinator = await parent(f, "parked-steer"));
    const host = f.ctx.projectMode as any,
      original = host.update.bind(host);
    let first = true,
      steered = false,
      workerId: ReturnType<typeof SessionId>;
    const signal = new AbortController().signal;
    host.update = async (
      id: ReturnType<typeof SessionId>,
      change: (r: any) => any,
    ) => {
      if (
        id === agent.id &&
        Object.keys(change(host.record(id)).reminders).length
      ) {
        entered.resolve();
        await writeGate.promise;
        try {
          return await original(id, change);
        } finally {
          writeFinished.resolve();
        }
      }
      return original(id, change);
    };
    f.adapter.handler = async (options) => {
      if (options.sessionId !== agent.id) {
        await new Promise<void>((_, reject) => {
          const abort = () => reject(options.signal!.reason);
          options.signal!.addEventListener("abort", abort, { once: true });
          if (options.signal!.aborted) abort();
        });
        return [];
      }
      if (first) {
        first = false;
        const receipt = (await f.ctx.projectMode.controlForAgent(
          agent,
          { action: "spawn", name: "parked", task: "one" },
          "spawn",
          signal,
        )) as { workerId: ReturnType<typeof SessionId> };
        workerId = receipt.workerId;
        await f.ctx.projectMode.controlForAgent(
          agent,
          {
            action: "send",
            worker_id: workerId,
            message: "queued",
            delivery: "queue",
          },
          "queue",
          signal,
        );
        await f.ctx.projectMode.controlForAgent(
          agent,
          { action: "interrupt", worker_id: workerId },
          "interrupt",
          signal,
        );
        await f.ctx.agents.get(workerId)?.whenIdle();
      } else if (
        JSON.stringify(options.messages).includes("remove parked worker now")
      ) {
        steered = true;
        await modelGate.promise;
        // Only this explicit coordinator decision deletes the retained work.
        await f.ctx.projectMode.controlForAgent(
          agent,
          { action: "delete", worker_id: workerId },
          "delete-after-steer",
          signal,
        );
      }
      return response("coordinator report");
    };
    const steer = vi.spyOn(agent, "steer");
    agent.followup(input("go"));
    await entered.promise;
    agent.steer(input("remove parked worker now"));
    await vi.waitFor(() => expect(steered).toBe(true), {
      timeout: 400,
      interval: 5,
    });
    const child = f.ctx.agents.get(workerId!)!;
    expect(child.status).toBe("idle");
    expect(child.inbox.nextTurn).toHaveLength(1);
    expect(
      agent.session.snapshotEvents().filter((e) => e.type === "turn/start"),
    ).toHaveLength(1);
    writeGate.resolve();
    await writeFinished.promise;
    expect(host.record(agent.id).reminders).toEqual({});
    expect(
      steer.mock.calls.filter(
        ([message]) => message.source.kind === "project-mode-notice",
      ),
    ).toHaveLength(0);
    expect(child.inbox.nextTurn).toHaveLength(1);
    modelGate.resolve();
    await agent.whenIdle();
    const events = agent.session.snapshotEvents();
    expect(events.filter((e) => e.type === "turn/start")).toHaveLength(1);
    expect(events.filter((e) => e.type === "turn/end")).toMatchObject([
      { data: { reason: { kind: "completed" } } },
    ]);
    expect(
      events.filter(
        (e) =>
          e.type === "user/message" &&
          e.data.source.kind === "project-mode-result",
      ),
    ).toHaveLength(1);
  } finally {
    writeGate.resolve();
    modelGate.resolve();
    await coordinator?.whenIdle();
    await f.dispose();
  }
});
