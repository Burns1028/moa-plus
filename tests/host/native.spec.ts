import { it, expect } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { fixture } from "./fixture.ts";

it("restricts only coordinator tools and restores them on disable", async () => {
  const f = await fixture();
  try {
    f.ctx.tools.register({
      name: "subagent",
      description: "native test sentinel",
      parameters: { type: "object", properties: {} },
      output: {
        schema: { type: "string" },
        render: (_a, v) => [{ type: "text", text: String(v) }],
      },
      execute: async () => "native",
    });
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    const { agent: ordinary } = await f.ctx.agents.create({
      sessionId: SessionId("ordinary"),
      meta: { cwd: f.root },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    expect(f.ctx.tools.get("subagent", agent)).toBeUndefined();
    expect(f.ctx.tools.get("subagent", ordinary)).toBeDefined();
    expect(f.ctx.tools.get("Task", agent)).toBeDefined();
    expect(f.ctx.tools.get("control_workers", agent)).toBeUndefined();
    await f.ctx.projectMode.setEnabled(agent.id, false, 1, "disable");
    expect(f.ctx.tools.get("subagent", agent)).toBeDefined();
  } finally {
    await f.dispose();
  }
});

it("installs role context before the first coordinator request", async () => {
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("role"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    agent.followup(
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "hello" }],
      }),
    );
    await agent.whenIdle();
    expect(JSON.stringify(f.adapter.requests[0])).toContain("coordinator");
    expect(JSON.stringify(f.adapter.requests[0])).toContain("notes.md");
  } finally {
    await f.dispose();
  }
});

it("creates an owned continuable worker immediately with role context before its first request and idempotent receipt", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const f = await fixture();
  try {
    f.adapter.handler = async (options) => {
      if (options.sessionId !== "parent") await gate;
      return (await import("./fixture.ts")).response("done");
    };
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    const signal = new AbortController().signal;
    const receipt = await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "spawn", name: "worker", task: "work" },
      "spawn-1",
      signal,
    );
    expect(receipt).toMatchObject({ accepted: true, operationId: "spawn-1" });
    const workerId = (receipt as { workerId: ReturnType<typeof SessionId> })
      .workerId;
    const worker = f.ctx.agents.get(workerId)!;
    expect(worker).toBeDefined();
    expect(worker.status).toBe("running");
    expect(
      await f.ctx.projectMode.controlForAgent(
        agent,
        { action: "spawn", name: "worker", task: "work" },
        "spawn-1",
        signal,
      ),
    ).toEqual(receipt);
    await new Promise((r) => setTimeout(r, 10));
    expect(
      JSON.stringify(f.adapter.requests.find((r) => r.sessionId === workerId)),
    ).toContain("MoA+ worker");
    expect(f.ctx.tools.get("control_workers", worker)).toBeUndefined();
    expect(
      (await f.ctx.subagents.listChildren(agent.id)).map((c) => c.id),
    ).toContain(workerId);
    release();
    await worker.whenIdle();
    await agent.whenIdle();
  } finally {
    release();
    await f.dispose();
  }
});

it("returns both queued turn finals in full and consumes results inside one coordinator turn", async () => {
  const f = await fixture();
  const signal = new AbortController().signal;
  let childId: ReturnType<typeof SessionId> | undefined,
    workerCalls = 0,
    parentCalls = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const full = "result ".repeat(20000);
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    f.adapter.handler = async (options) => {
      const { response } = await import("./fixture.ts");
      if (options.sessionId === "parent") {
        if (parentCalls++ === 0) {
          const receipt = (await f.ctx.projectMode.controlForAgent(
            agent,
            { action: "spawn", name: "worker", task: "first" },
            "first",
            signal,
          )) as { workerId: ReturnType<typeof SessionId> };
          childId = receipt.workerId;
          await f.ctx.projectMode.controlForAgent(
            agent,
            {
              action: "send",
              worker_id: childId,
              message: "second",
              delivery: "queue",
            },
            "second",
            signal,
          );
          release();
        }
        return response(parentCalls === 1 ? "Dispatched" : "Reviewed");
      }
      await gate;
      return response(++workerCalls === 1 ? full : "second final");
    };
    agent.followup(
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "go" }],
      }),
    );
    await agent.whenIdle();
    expect(workerCalls).toBe(2);
    const events = agent.session.snapshotEvents();
    expect(events.filter((e) => e.type === "turn/start")).toHaveLength(1);
    expect(events.filter((e) => e.type === "turn/end")).toHaveLength(1);
    const results = events.filter(
      (e) =>
        e.type === "user/message" &&
        e.data.source.kind === "project-mode-result",
    );
    expect(results).toHaveLength(2);
    expect(JSON.stringify(results)).toContain(full);
    for (const result of results)
      expect(result.data.source).toMatchObject({ senderSessionId: childId, senderName: "worker" });
    expect(results.map(result => result.data.content.slice(1))).toEqual([
      [{ type: "text", text: full }],
      [{ type: "text", text: "second final" }],
    ]);
    using child = await f.ctx.sessionQuery.observeSession(childId!);
    const assignment = child.events.find(event => event.type === "user/message" && event.data.source.kind === "project-mode-assignment");
    expect(assignment?.data.source).toMatchObject({ senderSessionId: agent.id, senderName: "Coordinator" });
    expect(assignment?.data.content).toEqual([{ type: "text", text: "second" }]);
    expect(
      (await f.ctx.projectMode.snapshot(agent.id))?.closedTurnOutcomes,
    ).toHaveLength(1);
  } finally {
    release();
    await f.dispose();
  }
});

it("keeps preset tools on workers and restores coordinator tools on draft disable or plugin disposal", async () => {
  const nativeNames = [
    "subagent",
    "subagent_fork",
    "list_agents",
    "send_message",
    "interrupt_agent",
    "list_subagent_models",
  ];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const f = await fixture();
  f.adapter.handler = async () => {
    await gate;
    return (await import("./fixture.ts")).response("done");
  };
  try {
    const { default: Loader } = await import(
      "@deepseek-ai/cordis-plugin-loader"
    );
    const { default: Group } = await import("@deepseek-ai/cordis-plugin-group");
    const { default: Presets } = await import(
      "@deepseek-ai/dsh-agent-preset-registry"
    );
    f.ctx.baseUrl = new URL("./", import.meta.url).href;
    await f.ctx.plugin(Loader);
    f.ctx.loader.builtins.group = Group;
    await f.ctx.plugin(Presets, { default: "standard" });
    await f.ctx.agentPresets.register({
      id: "standard",
      plugins: [
        { name: new URL("./fixtures/native-tools.mjs", import.meta.url).href },
      ],
    });
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("preset-parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
      setup: async (ctx) => {
        await f.ctx.agentPresets.mount(ctx);
      },
    });
    const { agent: ordinary } = await f.ctx.agents.create({
      sessionId: SessionId("preset-ordinary"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
      setup: async (ctx) => {
        await f.ctx.agentPresets.mount(ctx);
      },
    });
    for (const name of nativeNames)
      expect(f.ctx.tools.get(name, agent)).toBeDefined();
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    await f.ctx.projectMode.setEnabled(
      agent.id,
      false,
      f.ctx.projectMode.mode(agent.id).revision,
      "draft-off",
    );
    for (const name of nativeNames)
      expect(f.ctx.tools.get(name, agent)).toBeDefined();
    await f.ctx.projectMode.setEnabled(
      agent.id,
      true,
      f.ctx.projectMode.mode(agent.id).revision,
      "draft-on-again",
    );
    const receipt = (await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "spawn", name: "preset-child", task: "work" },
      "spawn",
      new AbortController().signal,
    )) as { workerId: ReturnType<typeof SessionId> };
    const child = f.ctx.agents.get(receipt.workerId)!;
    expect(f.ctx.agentPresets.composedPreset(child.ctx)).toBe("standard");
    for (const name of nativeNames) {
      expect(f.ctx.tools.get(name, agent), name).toBeUndefined();
      expect(f.ctx.tools.get(name, child), name).toBeUndefined();
      expect(f.ctx.tools.get(name, ordinary), name).toBeDefined();
    }
    expect(f.ctx.tools.get("SendMessage", agent)).toBeDefined();
    expect(f.ctx.tools.get("SendMessage", child)).toBeDefined();
    expect(f.ctx.tools.get("SendMessage", ordinary)).toBeUndefined();
    expect(f.ctx.tools.get("control_workers", child)).toBeUndefined();
    release();
    await child.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    await agent.whenIdle();
    const mode = f.ctx.projectMode.mode(agent.id);
    await expect(
      f.ctx.projectMode.setEnabled(agent.id, false, mode.revision, "off"),
    ).rejects.toThrow("project-mode/session-mode-locked");
    await f.plugin.dispose();
    for (const name of nativeNames)
      expect(f.ctx.tools.get(name, agent)).toBeDefined();
    expect(f.ctx.tools.get("control_workers", agent)).toBeUndefined();
  } finally {
    release();
    await f.dispose();
  }
});

it("history reads newest-relative windows and deletion retains native history", async () => {
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("history-parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    const signal = new AbortController().signal;
    const receipt = (await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "spawn", name: "history", task: "work" },
      "spawn",
      signal,
    )) as { workerId: ReturnType<typeof SessionId> };
    const worker = f.ctx.agents.get(receipt.workerId);
    await worker?.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    await agent.whenIdle();
    const page = await f.ctx.projectMode.history(
      agent.id,
      receipt.workerId,
      0,
      1,
      signal,
    );
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]?.role).toBe("assistant");
    expect(page.messages[0]?.text).toBe("done");
    const previous = await f.ctx.projectMode.history(
      agent.id,
      receipt.workerId,
      1,
      1,
      signal,
    );
    expect(previous.messages[0]?.role).toBe("user");
    const deleted = await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "delete", worker_id: receipt.workerId },
      "delete",
      signal,
    );
    expect(deleted).toMatchObject({
      lifecycle: "deleted",
      historyRetained: true,
    });
    const removed = await f.ctx.projectMode.snapshot(agent.id);
    expect(removed?.workers).toEqual([]);
    expect(removed?.turnMemberships).toEqual([]);
    expect(removed?.closedTurnOutcomes).toEqual([]);
    expect(
      await f.ctx.projectMode.controlForAgent(
        agent,
        { action: "list" },
        "list",
        signal,
      ),
    ).toEqual([]);
    // Older callers cannot recover deleted membership with this removed flag.
    expect(
      await f.ctx.projectMode.controlForAgent(
        agent,
        { action: "list", include_deleted: true } as any,
        "legacy-deleted-list",
        signal,
      ),
    ).toEqual([]);
    await expect(
      f.ctx.projectMode.controlForAgent(
        agent,
        { action: "get", worker_id: receipt.workerId },
        "deleted-get",
        signal,
      ),
    ).rejects.toThrow("inactive");
    await expect(
      f.ctx.projectMode
        .timeline(agent.id, receipt.workerId, 10, signal)
        [Symbol.asyncIterator]()
        .next(),
    ).rejects.toThrow("inactive");
    await expect(
      f.ctx.projectMode.controlForAgent(
        agent,
        {
          action: "send",
          worker_id: receipt.workerId,
          message: "no",
          delivery: "queue",
        },
        "after-delete",
        signal,
      ),
    ).rejects.toThrow("inactive");
    await expect(
      f.ctx.projectMode.history(agent.id, receipt.workerId, 0, 1, signal),
    ).rejects.toThrow("inactive");
    // Membership removal does not rewrite the native conversation log.
    using observed = await f.ctx.sessionQuery.observeSession(receipt.workerId);
    expect(
      observed.events.some(
        (e) =>
          e.type === "assistant/message" &&
          e.data.message.content.some(
            (b) => b.type === "text" && b.text === "done",
          ),
      ),
    ).toBe(true);
  } finally {
    await f.dispose();
  }
});

it("Stop aborts coordinator waiting without stopping the worker or clearing its queue", async () => {
  const f = await fixture();
  let entered!: () => void;
  const ready = new Promise<void>((r) => (entered = r));
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("stop-parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    let workerId: ReturnType<typeof SessionId> | undefined;
    let first = true;
    f.adapter.handler = async (options) => {
      const { response } = await import("./fixture.ts");
      if (options.sessionId !== agent.id) {
        await gate;
        return response("worker completed");
      }
      if (first) {
        first = false;
        const receipt = (await f.ctx.projectMode.controlForAgent(
          agent,
          { action: "spawn", name: "worker", task: "work" },
          "spawn",
          new AbortController().signal,
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
          new AbortController().signal,
        );
      }
      return response("Waiting");
    };
    f.ctx.on("agent/turn-stopping", ({ agent: subject }) => {
      if (subject === agent) entered();
    });
    agent.followup(
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "go" }],
      }),
    );
    // Project's earlier serial hook is waiting; use its externally observable waiting view.
    while (
      !(
        await f.ctx.projectMode.snapshot(agent.id)
      )?.coordinatorTurn?.phase.includes("waiting")
    )
      await new Promise((r) => setTimeout(r, 5));
    const child = f.ctx.agents.get(workerId!)!;
    expect(child.status).toBe("running");
    agent.cancel({ kind: "user" }, { keepInbox: true });
    await agent.whenIdle();
    expect(
      (await f.ctx.projectMode.snapshot(agent.id))?.closedTurnOutcomes[0],
    ).toMatchObject({
      status: "stopped",
      summary: "Coordinator turn interrupted; worker work may continue.",
    });
    expect(child.status).toBe("running");
    expect(child.inbox.nextTurn).toHaveLength(1);
    expect(
      agent.session.snapshotEvents().find((e) => e.type === "turn/end")?.data,
    ).toMatchObject({ reason: { kind: "aborted" } });
    release();
    await child.whenIdle();
    await agent.whenIdle();
  } finally {
    release();
    await f.dispose();
  }
});

it("history excludes runtime context and preserves committed task messages", async () => {
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("simple-history"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    const receipt = (await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "spawn", name: "worker", task: "actual assignment" },
      "spawn",
      new AbortController().signal,
    )) as { workerId: ReturnType<typeof SessionId> };
    await f.ctx.agents.get(receipt.workerId)?.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    await agent.whenIdle();
    const page = await f.ctx.projectMode.history(
      agent.id,
      receipt.workerId,
      0,
      10,
      new AbortController().signal,
    );
    expect(page.messages.map((m) => m.role)).toEqual(["assistant", "user"]);
    expect(page.messages.at(-1)?.text).toContain("actual assignment");
  } finally {
    await f.dispose();
  }
});

it("cold native continuation keeps worker Session identity and normalizes native settlement without duplicate model input", async () => {
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("cold-parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    const signal = new AbortController().signal;
    const receipt = (await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "spawn", name: "worker", task: "first" },
      "spawn",
      signal,
    )) as { workerId: ReturnType<typeof SessionId> };
    await f.ctx.agents.get(receipt.workerId)?.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    await agent.whenIdle();
    expect(f.ctx.agents.get(receipt.workerId)).toBeUndefined();
    await f.ctx.projectMode.controlForAgent(
      agent,
      {
        action: "send",
        worker_id: receipt.workerId,
        message: "second",
        delivery: "queue",
      },
      "send",
      signal,
    );
    await f.ctx.agents.get(receipt.workerId)?.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    await agent.whenIdle();
    const messages = agent.session
      .snapshotEvents()
      .filter((e) => e.type === "user/message");
    expect(
      messages.filter((e) => e.data.source.kind === "project-mode-result"),
    ).toHaveLength(2);
    expect(
      messages.filter((e) => e.data.source.kind === "subagent-settled"),
    ).toHaveLength(0);
    using observed = await f.ctx.sessionQuery.observeSession(receipt.workerId);
    expect(observed.events.filter((e) => e.type === "turn/end")).toHaveLength(
      2,
    );
  } finally {
    await f.dispose();
  }
});

it("does not substitute the previous final assistant when a later turn fails before output", async () => {
  const f = await fixture();
  try {
    let workers = 0;
    f.adapter.handler = (options) => {
      if (options.sessionId !== "no-final-parent" && workers++ > 0)
        throw new Error("failed before output");
      return [
        { type: "block-start", index: 0, blockType: "text" },
        { type: "text-delta", index: 0, text: "previous answer" },
        {
          type: "block-end",
          index: 0,
          block: { type: "text", text: "previous answer" },
        },
        { type: "finish", reason: { kind: "stop" } },
      ];
    };
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("no-final-parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    const signal = new AbortController().signal;
    const receipt = (await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "spawn", name: "worker", task: "first" },
      "spawn",
      signal,
    )) as { workerId: ReturnType<typeof SessionId> };
    await f.ctx.agents.get(receipt.workerId)?.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    await agent.whenIdle();
    await f.ctx.projectMode.controlForAgent(
      agent,
      {
        action: "send",
        worker_id: receipt.workerId,
        message: "second",
        delivery: "queue",
      },
      "send",
      signal,
    );
    await f.ctx.agents.get(receipt.workerId)?.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    await agent.whenIdle();
    const result = agent.session
      .snapshotEvents()
      .filter(
        (e) =>
          e.type === "user/message" &&
          e.data.source.kind === "project-mode-result",
      )
      .at(-1);
    expect(JSON.stringify(result)).toContain(
      "No final assistant message in this turn",
    );
    expect(JSON.stringify(result)).not.toContain("previous answer");
    expect(result?.type).toBe("user/message");
    if (result?.type !== "user/message") throw new Error("missing completion");
    // An empty result still reaches a real coordinator model request. The
    // coordinator can inspect history or dispatch again; absence is not a gate.
    expect(result.data.content).toHaveLength(1);
    expect(
      f.adapter.requests
        .filter((request) => request.sessionId === agent.id)
        .at(-1)?.messages,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: result.data.id,
          source: expect.objectContaining({ kind: "project-mode-result" }),
        }),
      ]),
    );
  } finally {
    await f.dispose();
  }
});

it("checks the native Remote principal and denies arbitrary session IDs", async () => {
  const f = await fixture();
  try {
    const { default: Access } = await import(
      "@deepseek-ai/dsh-api-remote-access"
    );
    const { Peer } = await import("@deepseek-ai/dsh-client-connection");
    await f.ctx.plugin(Access);
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("private"),
      meta: { cwd: f.root },
    });
    const peer = new Peer(f.ctx, {
      principal: { kind: "project-test-guest" } as never,
    });
    const call = f.ctx.extend({
      invocation: {
        request: { namespace: "projectMode", method: "setEnabled", args: {} },
        service: "projectMode",
        peer,
        signal: new AbortController().signal,
        uplink: () => ({ async *[Symbol.asyncIterator]() {} }),
      },
    });
    await expect(
      call.projectMode.setEnabled(agent.id, true, 0, "forged"),
    ).rejects.toThrow("unauthorized");
    expect(await call.projectMode.catalog()).toEqual([]);
    expect(f.ctx.projectMode.mode(agent.id).enabled).toBe(false);
  } finally {
    await f.dispose();
  }
});

it("reopens durable outbox without delivering already committed results again", async () => {
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("replay"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    const receipt = (await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "spawn", name: "worker", task: "work" },
      "spawn",
      new AbortController().signal,
    )) as { workerId: ReturnType<typeof SessionId> };
    await f.ctx.agents.get(receipt.workerId)?.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    await agent.whenIdle();
    const before = agent.session
      .snapshotEvents()
      .filter(
        (e) =>
          e.type === "user/message" &&
          e.data.source.kind === "project-mode-result",
      )
      .map((e) => e.data.id);
    expect(before).toHaveLength(1);
    await f.plugin.dispose();
    const { default: ProjectMode } = await import(
      "../../packages/project-mode/src/host/index.ts"
    );
    await f.ctx.plugin(ProjectMode, {});
    await f.ctx.projectMode.snapshot(agent.id);
    await agent.whenIdle();
    const after = agent.session
      .snapshotEvents()
      .filter(
        (e) =>
          e.type === "user/message" &&
          e.data.source.kind === "project-mode-result",
      )
      .map((e) => e.data.id);
    expect(after).toEqual(before);
    expect(
      await f.ctx.projectMode.controlForAgent(
        agent,
        { action: "spawn", name: "worker", task: "work" },
        "spawn",
        new AbortController().signal,
      ),
    ).toEqual(receipt);
  } finally {
    await f.dispose();
  }
});

it("reconciles an accepted spawn whose operation receipt was interrupted before storage commit", async () => {
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("recover-receipt"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    const receipt = (await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "spawn", name: "worker", task: "work" },
      "spawn",
      new AbortController().signal,
    )) as { workerId: ReturnType<typeof SessionId> };
    await f.ctx.agents.get(receipt.workerId)?.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    await agent.whenIdle();
    const host = f.ctx.projectMode as any;
    await host.update(agent.id, (r: any) => ({
      ...r,
      operations: {},
      assignments: r.assignments.map((a: any) => ({
        ...a,
        admission: "unknown",
        messageId: undefined,
      })),
      workers: r.workers.map((w: any) => ({ ...w, lifecycle: "provisioning" })),
    }));
    await f.plugin.dispose();
    const { default: ProjectMode } = await import(
      "../../packages/project-mode/src/host/index.ts"
    );
    await f.ctx.plugin(ProjectMode, {});
    const snapshot = await f.ctx.projectMode.snapshot(agent.id);
    expect(snapshot?.workers[0]?.lifecycle).toBe("active");
    expect(
      await f.ctx.projectMode.controlForAgent(
        agent,
        { action: "spawn", name: "worker", task: "work" },
        "spawn",
        new AbortController().signal,
      ),
    ).toMatchObject({ workerId: receipt.workerId, accepted: true });
    expect(await f.ctx.subagents.listChildren(agent.id)).toHaveLength(1);
  } finally {
    await f.dispose();
  }
});

it("deduplicates concurrent completion ingestion before coordinator admission", async () => {
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("concurrent-ingest"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    const receipt = (await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "spawn", name: "worker", task: "work" },
      "spawn",
      new AbortController().signal,
    )) as { workerId: ReturnType<typeof SessionId> };
    await f.ctx.agents.get(receipt.workerId)?.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    await agent.whenIdle();
    const host = f.ctx.projectMode as any;
    // Recreate the durable pre-ingestion cut, then race event and settlement ingestion.
    await host.update(agent.id, (r: any) => ({
      ...r,
      completions: [],
      deliveries: [],
    }));
    await Promise.all([
      host.ingest(receipt.workerId),
      host.ingest(receipt.workerId),
    ]);
    expect(host.record(agent.id).completions).toHaveLength(1);
    expect(host.record(agent.id).deliveries).toHaveLength(1);
    await agent.whenIdle();
  } finally {
    await f.dispose();
  }
});

it("initializes context through the coordinator scoped sandbox filesystem and preserves existing files", async () => {
  const f = await fixture();
  try {
    const { default: Policy, setSandboxMode } = await import(
      "@deepseek-ai/dsh-sandbox-policy"
    );
    const { SandboxedFileSystem } = await import("@deepseek-ai/dsh-fs-sandbox");
    const { readFile, writeFile } = await import("node:fs/promises");
    await f.ctx.plugin(Policy, { mode: "read-only" });
    const { default: Loader } = await import(
      "@deepseek-ai/cordis-plugin-loader"
    );
    const { default: Group } = await import("@deepseek-ai/cordis-plugin-group");
    const { default: Presets } = await import(
      "@deepseek-ai/dsh-agent-preset-registry"
    );
    f.ctx.baseUrl = new URL("./", import.meta.url).href;
    await f.ctx.plugin(Loader);
    f.ctx.loader.builtins.group = Group;
    await f.ctx.plugin(Presets, { default: "confined" });
    await f.ctx.agentPresets.register({
      id: "confined",
      plugins: [
        {
          name: "cordis:group",
          group: true,
          isolate: { fs: true },
          config: [
            {
              name: new URL("./fixtures/sandbox-fs.mjs", import.meta.url).href,
              config: { cwd: f.root },
            },
          ],
        },
      ],
    });
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("sandbox-parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
      setup: async (ctx) => {
        await f.ctx.agentPresets.mount(ctx);
      },
    });
    await expect(
      f.ctx.projectMode.setEnabled(agent.id, true, 0, "denied"),
    ).rejects.toThrow(/sandbox|denied/i);
    expect(f.ctx.projectMode.mode(agent.id).enabled).toBe(false);
    setSandboxMode(agent.session, "workspace-write");
    const mode = await f.ctx.projectMode.setEnabled(
      agent.id,
      true,
      0,
      "allowed",
    );
    expect(await readFile(mode.paths!.notes, "utf8")).toContain("Active tasks");
    await writeFile(mode.paths!.notes, "keep my notes");
    await f.ctx.projectMode.setEnabled(agent.id, false, mode.revision, "off");
    await f.ctx.projectMode.setEnabled(
      agent.id,
      true,
      f.ctx.projectMode.mode(agent.id).revision,
      "again",
    );
    expect(await readFile(mode.paths!.notes, "utf8")).toBe("keep my notes");
    const { join } = await import("node:path");
    const { rm, access } = await import("node:fs/promises");
    const index = join(mode.paths!.context, "index.md");
    await rm(index, { force: true });
    setSandboxMode(agent.session, "read-only");
    agent.followup(
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "Explain the current project" }],
      }),
    );
    await agent.whenIdle();
    expect(f.adapter.requests).toHaveLength(1);
    await expect(access(index)).rejects.toThrow();
    setSandboxMode(agent.session, "workspace-write");
    agent.followup(
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "Continue with shared context" }],
      }),
    );
    await agent.whenIdle();
    expect(await readFile(index, "utf8")).toContain("# Project context");
    expect(await readFile(mode.paths!.notes, "utf8")).toBe("keep my notes");
  } finally {
    await f.dispose();
  }
});

it("releases follow subscription when the consumer returns from a baseline", async () => {
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("follow-cleanup"),
      meta: { cwd: f.root },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    const service = f.ctx.projectMode as any;
    const before = service.listeners.size;
    const stream = f.ctx.projectMode
      .follow(agent.id, new AbortController().signal)
      [Symbol.asyncIterator]();
    expect((await stream.next()).value).toMatchObject({ type: "baseline" });
    await stream.return?.();
    expect(service.listeners.size).toBe(before);
  } finally {
    await f.dispose();
  }
});

it("emits one named parked-queue reminder, then lets the coordinator delete the worker in the same turn", async () => {
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("parked-parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    let workerId: ReturnType<typeof SessionId> | undefined,
      first = true;
    const signal = new AbortController().signal;
    f.adapter.handler = async (options) => {
      if (options.sessionId !== agent.id) {
        await new Promise<void>((_, reject) => {
          options.signal!.addEventListener(
            "abort",
            () => reject(options.signal!.reason),
            { once: true },
          );
        });
        return [];
      }
      if (first) {
        first = false;
        const receipt = (await f.ctx.projectMode.controlForAgent(
          agent,
          { action: "spawn", name: "parked-worker", task: "work" },
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
      } else if (
        JSON.stringify(options.messages).includes("parked worker input")
      ) {
        await f.ctx.projectMode.controlForAgent(
          agent,
          { action: "delete", worker_id: workerId! },
          "remove-worker",
          signal,
        );
      }
      return (await import("./fixture.ts")).response("reviewed");
    };
    agent.followup(
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "go" }],
      }),
    );
    await agent.whenIdle();
    const events = agent.session.snapshotEvents();
    expect(
      events.filter(
        (e) =>
          e.type === "user/message" &&
          e.data.source.kind === "project-mode-notice",
      ),
    ).toHaveLength(1);
    expect(events.filter((e) => e.type === "turn/start")).toHaveLength(1);
    expect((await f.ctx.projectMode.snapshot(agent.id))?.workers).toEqual([]);
  } finally {
    await f.dispose();
  }
});

it.each([1, 2, 3, 4, 5])(
  "normalizes cold native settlement before delayed canonical persistence, run %s",
  async () => {
    const f = await fixture();
    let release!: () => void;
    const delayed = new Promise<void>((r) => (release = r));
    try {
      const { agent } = await f.ctx.agents.create({
        sessionId: SessionId("settlement-race"),
        meta: { cwd: f.root },
        agentOptions: { provider: "test", model: "test" },
      });
      await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
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
      const baselineRequests = f.adapter.requests.filter(
        (r) => r.sessionId === agent.id,
      ).length;
      const baselineTurns = agent.session
        .snapshotEvents()
        .filter((e) => e.type === "turn/start").length;
      const host = f.ctx.projectMode as any,
        original = host.update.bind(host);
      let blocked = false,
        nativeNotices = 0;
      host.update = async (
        id: ReturnType<typeof SessionId>,
        change: (r: any) => any,
      ) => {
        if (
          id === agent.id &&
          !blocked &&
          change(host.record(id)).completions.length === 2
        ) {
          blocked = true;
          await delayed;
        }
        return original(id, change);
      };
      f.ctx.on("agent/pre-step", async ({ agent: subject }, next) => {
        const decision = await next();
        if (
          subject === agent &&
          decision.kind === "enter" &&
          decision.messages.some((m) => m.source.kind === "subagent-settled")
        ) {
          nativeNotices++;
          release();
        }
        return decision;
      });
      await f.ctx.projectMode.controlForAgent(
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
      await f.ctx.agents.get(receipt.workerId)?.whenIdle();
      await f.ctx.projectMode.snapshot(agent.id);
      await agent.whenIdle();
      expect(blocked).toBe(true);
      expect(nativeNotices).toBe(1);
      expect(
        f.adapter.requests.filter((r) => r.sessionId === agent.id),
      ).toHaveLength(baselineRequests + 1);
      const events = agent.session.snapshotEvents();
      expect(events.filter((e) => e.type === "turn/start")).toHaveLength(
        baselineTurns + 1,
      );
      expect(
        events.filter(
          (e) =>
            e.type === "user/message" &&
            e.data.source.kind === "project-mode-result",
        ),
      ).toHaveLength(2);
      expect(
        events.filter(
          (e) =>
            e.type === "user/message" &&
            e.data.source.kind === "subagent-settled",
        ),
      ).toHaveLength(0);
    } finally {
      release();
      await f.dispose();
    }
  },
);

it("treats a reused provider tool call ID in distinct native turns as distinct dispatches", async () => {
  const f = await fixture();
  try {
    const { ToolCallId } = await import("@deepseek-ai/dsh-llm");
    const { response } = await import("./fixture.ts");
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("reused-call"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    let dispatch = true;
    f.adapter.handler = (options) => {
      if (options.sessionId !== agent.id || !dispatch) return response("done");
      dispatch = false;
      const block = {
        type: "tool-call" as const,
        id: ToolCallId("provider-reuses-id"),
        name: "Task",
        arguments: JSON.stringify({
          tasks: [{ name: "worker", task: "work", role: "General-purpose", workspace: "shared" }],
        }),
      };
      return [
        { type: "block-start", index: 0, blockType: "tool-call" },
        {
          type: "tool-call-delta",
          index: 0,
          id: block.id,
          name: block.name,
          argumentsDelta: block.arguments,
        },
        { type: "block-end", index: 0, block },
        { type: "finish", reason: { kind: "tool-calls" } },
      ];
    };
    for (let turn = 0; turn < 2; turn++) {
      dispatch = true;
      agent.followup(
        createUserMessage({
          source: { kind: "user" },
          content: [{ type: "text", text: `work ${turn}` }],
        }),
      );
      await agent.whenIdle();
    }
    expect((await f.ctx.projectMode.snapshot(agent.id))?.workers).toHaveLength(
      2,
    );
    expect(await f.ctx.subagents.listChildren(agent.id)).toHaveLength(2);
  } finally {
    await f.dispose();
  }
});

it("wakes the same waiting coordinator turn for a user steer", async () => {
  const f = await fixture();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("steer-parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    let calls = 0;
    f.adapter.handler = async (options) => {
      if (options.sessionId !== agent.id) {
        await gate;
        return (await import("./fixture.ts")).response("worker done");
      }
      if (calls++ === 0)
        await f.ctx.projectMode.controlForAgent(
          agent,
          { action: "spawn", name: "worker", task: "work" },
          "spawn",
          new AbortController().signal,
        );
      else if (JSON.stringify(options.messages).includes("changed priority"))
        release();
      return (await import("./fixture.ts")).response("working");
    };
    agent.followup(
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "go" }],
      }),
    );
    while (
      (await f.ctx.projectMode.snapshot(agent.id))?.coordinatorTurn?.phase !==
      "waiting-workers"
    )
      await new Promise((r) => setTimeout(r, 5));
    agent.steer(
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "changed priority" }],
      }),
    );
    await agent.whenIdle();
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(
      agent.session.snapshotEvents().filter((e) => e.type === "turn/start"),
    ).toHaveLength(1);
    expect(
      agent.session
        .snapshotEvents()
        .filter(
          (e) =>
            e.type === "user/message" &&
            e.data.source.kind === "project-mode-result",
        ),
    ).toHaveLength(1);
  } finally {
    release();
    await f.dispose();
  }
});

it("follows an ordinary Session through its first enable without a catalog refresh", async () => {
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("ordinary-follow"),
      meta: { cwd: f.root },
    });
    const stream = f.ctx.projectMode
      .follow(agent.id, new AbortController().signal)
      [Symbol.asyncIterator]();
    const first = stream.next();
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    expect((await first).value).toMatchObject({
      type: "baseline",
      value: { project: { mode: "enabled" } },
    });
    await stream.return?.();
  } finally {
    await f.dispose();
  }
});

it("keeps unavailable worker activity unknown and fails native turn closure closed", async () => {
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("unknown-parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    const receipt = (await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "spawn", name: "worker", task: "work" },
      "spawn",
      new AbortController().signal,
    )) as { workerId: ReturnType<typeof SessionId> };
    await f.ctx.agents.get(receipt.workerId)?.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    await agent.whenIdle();
    const query = f.ctx.sessionQuery,
      observe = query.observeSession.bind(query);
    query.observeSession = async (id, options) => {
      if (id === receipt.workerId)
        throw new Error("unavailable fixture observation");
      return observe(id, options);
    };
    expect(
      (await f.ctx.projectMode.snapshot(agent.id))?.workers[0],
    ).toMatchObject({
      status: null,
      availability: "unavailable",
      queueLength: null,
    });
    agent.followup(
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "finish" }],
      }),
    );
    await agent.whenIdle();
    const end = agent.session
      .snapshotEvents()
      .filter((e) => e.type === "turn/end")
      .at(-1);
    expect(end?.type === "turn/end" && end.data.reason.kind).toBe("error");
    query.observeSession = observe;
  } finally {
    await f.dispose();
  }
});

it("reopens JSON domain and native Session persistence in a fresh runtime and reconciles consumption on resume", async () => {
  const first = await fixture(undefined, { keepFiles: true });
  let second: Awaited<ReturnType<typeof fixture>> | undefined;
  try {
    const { agent } = await first.ctx.agents.create({
      sessionId: SessionId("fresh-restart"),
      meta: { cwd: first.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await first.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    const receipt = (await first.ctx.projectMode.controlForAgent(
      agent,
      { action: "spawn", name: "worker", task: "work" },
      "spawn",
      new AbortController().signal,
    )) as { workerId: ReturnType<typeof SessionId> };
    await first.ctx.agents.get(receipt.workerId)?.whenIdle();
    await first.ctx.projectMode.snapshot(agent.id);
    await agent.whenIdle();
    const host = first.ctx.projectMode as any;
    const messageId = host.record(agent.id).deliveries[0].message.id;
    await host.update(agent.id, (r: any) => ({
      ...r,
      deliveries: r.deliveries.map((d: any) => ({ ...d, state: "pending" })),
    }));
    await first.dispose();
    second = await fixture(undefined, { root: first.root });
    const { agent: restored } = await second.ctx.agents.resume({
      resumeSessionId: agent.id,
      agentOptions: { provider: "test", model: "test" },
    });
    await second.ctx.projectMode.snapshot(agent.id);
    await restored.whenIdle();
    expect(
      (second.ctx.projectMode as any).record(agent.id).deliveries[0],
    ).toMatchObject({ state: "consumed", message: { id: messageId } });
    expect(second.adapter.requests).toHaveLength(0);
    expect(
      restored.session
        .snapshotEvents()
        .filter(
          (e) =>
            e.type === "user/message" &&
            e.data.source.kind === "project-mode-result",
        ),
    ).toHaveLength(1);
  } finally {
    if (second) await second.dispose();
    else {
      await first.dispose();
      await (
        await import("node:fs/promises")
      ).rm(first.root, { recursive: true, force: true });
    }
  }
});
