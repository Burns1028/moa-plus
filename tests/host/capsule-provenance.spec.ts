import { expect, it, vi } from "vitest";
import {
  SessionId,
  SessionSeq,
  type SessionEvent,
} from "@deepseek-ai/dsh-session";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { projection } from "../../packages/moa/src/host/state.ts";
import { fixture, response } from "./fixture.ts";

const input = (text: string) =>
  createUserMessage({
    source: { kind: "user" },
    content: [{ type: "text", text }],
  });

it("native projection records human anchors and exact result receipt provenance without creating a turn", () => {
  let state = projection.init({} as any, 0 as any);
  const apply = (type: string, seq: number, data: unknown) => {
    state = projection.apply(state, {
      type,
      seq: SessionSeq(seq),
      time: seq,
      data,
      ...(type === "user/message" ? { surfaceOp: "append" } : {}),
    } as SessionEvent);
  };
  apply("turn/start", 1, { turn: 7 });
  const first = input("work"),
    second = input("可以");
  apply("user/message", 3, first);
  expect(state.segmentStartSeq).toBe(3);
  apply("user/message", 8, second);
  expect(state.turn).toBe(7);
  expect(state.segmentStartSeq).toBe(8);
  const result = createUserMessage({
    source: {
      kind: "project-mode-result",
      form: "relay",
      completionId: "done",
      workerId: SessionId("child"),
      workerTurn: 1,
    },
    content: [{ type: "text", text: "done" }],
  });
  apply("user/message", 10, result);
  apply("user/message", 12, input("later"));
  expect(state.resultAnchors[result.id]).toEqual({
    coordinatorTurn: 7,
    segmentStartSeq: 8,
    participationSeq: 10,
  });
});

it("passive human steer/get/list leave earlier membership in place; received completion creates the later segment's own membership", async () => {
  const f = await fixture(),
    gate = Promise.withResolvers<void>();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("segment-owner"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    let workerId!: ReturnType<typeof SessionId>,
      requests = 0;
    f.adapter.handler = async (options) => {
      if (options.sessionId !== agent.id) {
        await gate.promise;
        return response("worker result");
      }
      if (++requests === 1) {
        const receipt = (await f.ctx.projectMode.controlForAgent(
          agent,
          { action: "spawn", name: "worker", task: "work" },
          "spawn",
          new AbortController().signal,
        )) as any;
        workerId = receipt.workerId;
      } else {
        await f.ctx.projectMode.controlForAgent(
          agent,
          { action: "list" },
          "list",
          new AbortController().signal,
        );
        await f.ctx.projectMode.controlForAgent(
          agent,
          { action: "get", worker_id: workerId },
          "get",
          new AbortController().signal,
        );
      }
      return response("coordinator response");
    };
    const first = input("work");
    agent.followup(first);
    await vi.waitFor(() => expect(requests).toBe(1));
    await vi.waitFor(() =>
      expect((f.ctx.projectMode as any).turns.waiting.has(agent.id)).toBe(true),
    );
    const initial = await f.ctx.projectMode.snapshot(agent.id),
      firstMembership = initial.turnMemberships[0];
    const firstEvent = agent.session
      .snapshotEvents()
      .find((e) => e.type === "user/message" && e.data.id === first.id)!;
    expect(firstMembership.segmentStartSeq).toBe(firstEvent.seq);
    const later = input("可以");
    agent.steer(later);
    await vi.waitFor(() => expect(requests).toBe(2));
    await vi.waitFor(() =>
      expect((f.ctx.projectMode as any).turns.waiting.has(agent.id)).toBe(true),
    );
    expect(
      (await f.ctx.projectMode.snapshot(agent.id)).turnMemberships,
    ).toEqual([firstMembership]);
    gate.resolve();
    await f.ctx.agents.get(workerId)!.whenIdle();
    await agent.whenIdle();
    const final = await f.ctx.projectMode.snapshot(agent.id);
    expect(final.turnMemberships).toHaveLength(2);
    expect(final.turnMemberships[0]).toEqual(firstMembership);
    const laterEvent = agent.session
      .snapshotEvents()
      .find((e) => e.type === "user/message" && e.data.id === later.id)!;
    expect(final.turnMemberships[1]).toMatchObject({
      coordinatorTurn: firstMembership.coordinatorTurn,
      segmentStartSeq: laterEvent.seq,
      workerId,
      participationKind: "result",
    });
    expect(final.closedTurnOutcomes.map((o) => o.segmentStartSeq)).toEqual([
      firstEvent.seq,
      laterEvent.seq,
    ]);
  } finally {
    gate.resolve();
    await f.dispose();
  }
});

it("rebuilds pre-upgrade capsule ownership from canonical tool sequence identities and retains frozen outcomes", async () => {
  const { repairCapsuleOwnership } = await import(
    "../../packages/moa/src/host/capsule-participation.ts"
  );
  const { snapshot } = await import("../client/fixture.ts");
  const s = snapshot(),
    op1 = 'tool:["parent",5,"spawn-call"]',
    op2 = 'tool:["parent",10,"send-call"]';
  const record: any = {
    project: s.project,
    workers: [
      {
        id: "child",
        name: "worker",
        description: "work",
        creationOperationId: op1,
        lifecycle: "active",
        createdAt: 1,
      },
    ],
    assignments: [
      {
        id: "a",
        operationId: op1,
        workerId: "child",
        coordinatorTurn: 1,
        delivery: "steer",
        messageId: "m",
        admission: "accepted",
      },
      {
        id: "b",
        operationId: op2,
        workerId: "child",
        coordinatorTurn: 1,
        delivery: "steer",
        messageId: "n",
        admission: "accepted",
      },
    ],
    completions: [],
    deliveries: [],
    memberships: [
      {
        ...s.turnMemberships[0],
        coordinatorTurn: 1,
        firstOperationId: op1,
        firstCallId: op1,
      },
    ],
    outcomes: [
      {
        coordinatorSessionId: "parent",
        coordinatorTurn: 1,
        workerId: "child",
        status: "completed",
        completionIds: [],
        summary: "frozen",
      },
    ],
    operations: {},
    toggles: {},
    reminders: {},
  };
  const events = [
    { type: "turn/start", seq: 1, data: { turn: 1 } },
    { type: "user/message", seq: 3, surfaceOp: "append", data: input("first") },
    {
      type: "tool/call",
      seq: 5,
      data: {
        turn: 1,
        step: 1,
        callId: "spawn-call",
        name: "control_workers",
        arguments: "{}",
      },
    },
    { type: "user/message", seq: 8, surfaceOp: "append", data: input("later") },
    {
      type: "tool/call",
      seq: 10,
      data: {
        turn: 1,
        step: 2,
        callId: "send-call",
        name: "control_workers",
        arguments: "{}",
      },
    },
  ] as SessionEvent[];
  const repaired = repairCapsuleOwnership?.(record, events) ?? record;
  expect(repaired.memberships.map((m) => m.segmentStartSeq)).toEqual([3, 8]);
  expect(repaired.assignments.map((a) => a.participationSeq)).toEqual([5, 10]);
  expect(repaired.outcomes.map((o) => [o.segmentStartSeq, o.summary])).toEqual([
    [3, "frozen"],
    [8, "frozen"],
  ]);
  expect(repairCapsuleOwnership(repaired, events)).toBe(repaired);
});

it("deduplicates repeated steer/queue assignments and later results per human segment while retaining earlier memberships", async () => {
  const f = await fixture(),
    gate = Promise.withResolvers<void>();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("repeat-owner"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    let workerId!: ReturnType<typeof SessionId>,
      requests = 0;
    f.adapter.handler = async (options) => {
      if (options.sessionId !== agent.id) {
        await gate.promise;
        return response("worker result");
      }
      const count = ++requests;
      if (count === 1)
        workerId = (
          (await f.ctx.projectMode.controlForAgent(
            agent,
            { action: "spawn", name: "worker", task: "work" },
            "spawn",
            new AbortController().signal,
          )) as any
        ).workerId;
      if (count === 2)
        for (const delivery of ["steer", "queue"] as const)
          await f.ctx.projectMode.controlForAgent(
            agent,
            {
              action: "send",
              worker_id: workerId,
              message: delivery,
              delivery,
            },
            delivery,
            new AbortController().signal,
          );
      return response("coordinator response");
    };
    const wait = async (count: number) => {
      await vi.waitFor(() => expect(requests).toBe(count));
      await vi.waitFor(() =>
        expect((f.ctx.projectMode as any).turns.waiting.has(agent.id)).toBe(
          true,
        ),
      );
    };
    agent.followup(input("first"));
    await wait(1);
    const initial = (await f.ctx.projectMode.snapshot(agent.id))
      .turnMemberships[0];
    agent.steer(input("send updates"));
    await wait(2);
    const dispatched = (await f.ctx.projectMode.snapshot(agent.id))
      .turnMemberships;
    expect(dispatched).toHaveLength(2);
    expect(dispatched[0]).toEqual(initial);
    expect(dispatched[1].participationKind).toBe("send");
    agent.steer(input("可以"));
    await wait(3);
    expect(
      (await f.ctx.projectMode.snapshot(agent.id)).turnMemberships,
    ).toEqual(dispatched);
    gate.resolve();
    await f.ctx.agents.get(workerId)!.whenIdle();
    await agent.whenIdle();
    const final = await f.ctx.projectMode.snapshot(agent.id);
    expect(final.turnMemberships).toHaveLength(3);
    expect(final.turnMemberships.slice(0, 2)).toEqual(dispatched);
    expect(final.turnMemberships[2].completionIds).toHaveLength(2);
    expect(
      new Set(final.turnMemberships.map((m) => m.coordinatorTurn)).size,
    ).toBe(1);
    expect(final.closedTurnOutcomes).toHaveLength(3);
  } finally {
    gate.resolve();
    await f.dispose();
  }
});

it("replaying an accepted assignment retains its original native turn and segment after later human input", async () => {
  const { WorkerOperations } = await import(
    "../../packages/moa/src/host/worker-operations.ts"
  );
  const { snapshot } = await import("../client/fixture.ts");
  let record: any = {
    project: snapshot().project,
    workers: [{ id: "child", lifecycle: "active" }],
    assignments: [
      {
        id: "assignment",
        operationId: "original",
        workerId: "child",
        coordinatorTurn: 1,
        segmentStartSeq: 3,
        participationSeq: 5,
        participationKind: "send",
        messageId: "accepted",
        admission: "accepted",
        delivery: "steer",
      },
    ],
    operations: {},
    memberships: [],
  };
  const host: any = {
    closing: new AbortController(),
    requireCoordinator: () => record,
    record: () => record,
    worker: () => record.workers[0],
    notify: () => {},
    update: async (_id: unknown, change: any) => {
      record = change(record);
    },
    ctx: {
      sessionProjections: {
        stateOf: (_session: unknown, key: string) =>
          key === "turnBoundary"
            ? { lastTurn: 2 }
            : { turn: 2, segmentStartSeq: 30, lastSeq: 35 },
      },
    },
  };
  const operations = new WorkerOperations(host);
  const receipt = (await operations.controlForAgent(
    { id: SessionId("parent"), session: {} } as any,
    {
      action: "send",
      worker_id: SessionId("child"),
      message: "retry",
      delivery: "steer",
    },
    "original",
    new AbortController().signal,
  )) as any;
  expect(receipt.coordinatorTurn).toBe(1);
  expect(record.memberships[0]).toMatchObject({
    coordinatorTurn: 1,
    segmentStartSeq: 3,
    participationSeq: 5,
  });
});

it("anchors parallel native dispatch to its encoded tool-call event rather than another call's latest seq", async () => {
  const { WorkerOperations } = await import(
    "../../packages/moa/src/host/worker-operations.ts"
  );
  const { snapshot } = await import("../client/fixture.ts");
  let record: any = {
    project: snapshot().project,
    workers: [],
    assignments: [],
    operations: {},
    memberships: [],
  };
  const host: any = {
    closing: new AbortController(),
    errors: new Map(),
    requireCoordinator: () => record,
    record: () => record,
    notify: () => {},
    enqueue: () => {},
    update: async (_id: unknown, change: any) => {
      record = change(record);
    },
    ctx: {
      workingDirectory: { get: () => "/p" },
      subagents: {
        startActivation: async () => ({
          messageId: "accepted",
          result: Promise.resolve({}),
        }),
      },
      sessionProjections: {
        stateOf: (_session: unknown, key: string) =>
          key === "turnBoundary"
            ? { lastTurn: 2 }
            : { turn: 2, segmentStartSeq: 30, lastSeq: 35 },
      },
    },
  };
  const operations = new WorkerOperations(host);
  await operations.controlForAgent(
    { id: SessionId("parent"), session: {} } as any,
    { action: "spawn", name: "worker", task: "work" },
    'tool:["parent",34,"call"]',
    new AbortController().signal,
  );
  expect(record.assignments[0].participationSeq).toBe(34);
  expect(record.memberships[0].participationSeq).toBe(34);
});

it("recovers frozen outcomes for result-only segments in later closed turns without rewriting the interrupted original", async () => {
  const { repairCapsuleOwnership } = await import(
    "../../packages/moa/src/host/capsule-participation.ts"
  );
  const { MoAStore } = await import(
    "../../packages/moa/src/client/store.ts"
  );
  const { snapshot, sid } = await import("../client/fixture.ts");
  const s = snapshot(),
    operationId = 'tool:["parent",5,"spawn"]';
  const original = {
    coordinatorSessionId: "parent",
    coordinatorTurn: 1,
    workerId: "child",
    status: "stopped",
    completionIds: [],
    summary: "Original interrupted outcome",
  };
  const completion = (id: string, outcome: string, seq: number) => ({
    id,
    workerId: "child",
    workerTurn: seq,
    turnEndSeq: seq + 1,
    assignmentIds: ["a"],
    outcome,
    settledAt: seq,
    lastAssistant: {
      messageId: `message-${id}`,
      seq,
      content: [{ type: "text", text: `result ${id}` }],
    },
  });
  const record: any = {
    project: s.project,
    workers: [
      {
        id: "child",
        name: "worker",
        description: "work",
        creationOperationId: operationId,
        lifecycle: "deleted",
        createdAt: 1,
      },
    ],
    assignments: [
      {
        id: "a",
        operationId,
        workerId: "child",
        coordinatorTurn: 1,
        delivery: "steer",
        messageId: "assignment",
        admission: "accepted",
      },
    ],
    completions: [
      completion("c", "completed", 10),
      completion("d", "error", 12),
      completion("later", "completed", 100),
    ],
    deliveries: [],
    memberships: [
      {
        ...s.turnMemberships[0],
        coordinatorTurn: 1,
        firstOperationId: operationId,
        firstCallId: operationId,
      },
    ],
    outcomes: [original],
    operations: {},
    toggles: {},
    reminders: {},
  };
  const result = (id: string) =>
    createUserMessage({
      source: {
        kind: "project-mode-result",
        form: "relay",
        completionId: id,
        workerId: SessionId("child"),
        workerTurn: 1,
      },
      content: [{ type: "text", text: `result ${id}` }],
    });
  const events = [
    { type: "turn/start", seq: 1, data: { turn: 1 } },
    { type: "user/message", seq: 3, surfaceOp: "append", data: input("work") },
    {
      type: "tool/call",
      seq: 5,
      data: {
        turn: 1,
        step: 1,
        callId: "spawn",
        name: "control_workers",
        arguments: "{}",
      },
    },
    {
      type: "turn/end",
      seq: 7,
      data: { turn: 1, reason: { kind: "aborted" } },
    },
    { type: "turn/start", seq: 8, data: { turn: 2 } },
    { type: "user/message", seq: 10, surfaceOp: "append", data: result("c") },
    {
      type: "user/message",
      seq: 11,
      surfaceOp: "append",
      data: input("check again"),
    },
    { type: "user/message", seq: 12, surfaceOp: "append", data: result("d") },
    {
      type: "turn/end",
      seq: 14,
      data: { turn: 2, reason: { kind: "completed" } },
    },
    { type: "turn/start", seq: 16, data: { turn: 3 } },
    {
      type: "user/message",
      seq: 20,
      surfaceOp: "append",
      data: result("later"),
    },
  ] as SessionEvent[];
  const repaired = repairCapsuleOwnership(record, events);
  expect(repaired.outcomes.find((o) => o.coordinatorTurn === 1)).toEqual({
    ...original,
    segmentStartSeq: 3,
  });
  const store = new MoAStore();
  store.accept({
    ...s,
    turnMemberships: repaired.memberships as any,
    closedTurnOutcomes: repaired.outcomes as any,
    workers: [
      { ...s.workers[0], phase: "working", progressText: "Later live work" },
    ],
  });
  expect(store.turn(sid("parent"), 2, true, 8).map((c) => c.status)).toEqual([
    "completed",
  ]);
  expect(store.turn(sid("parent"), 2, true, 11).map((c) => c.status)).toEqual([
    "failed",
  ]);
  expect(store.turn(sid("parent"), 2, true, 8)[0].text).not.toBe(
    "Later live work",
  );
  expect(
    repaired.outcomes.find(
      (o) => o.coordinatorTurn === 2 && o.segmentStartSeq === 8,
    ),
  ).toMatchObject({
    completionIds: ["c"],
    lastResultMessageId: "message-c",
    lastResultSeq: 10,
  });
  expect(repaired.outcomes.some((o) => o.coordinatorTurn === 3)).toBe(false);
  expect(repairCapsuleOwnership(repaired, events)).toBe(repaired);
});
