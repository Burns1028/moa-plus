import { expect, it } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage, type StreamChunk } from "@deepseek-ai/dsh-llm";
import { fixture, response } from "./fixture.ts";

it("rejects an invalid reportTo batch before admission and guides a native retry to the creator", async () => {
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("actual-creator-session"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    const access = (f.ctx.projectMode as any).access;
    const children: string[] = [];
    f.ctx.on("agent/created", ({ agent: child }) => children.push(child.id));
    const returned = Promise.withResolvers<void>();
    const invoke = (id: string, tasks: object[]): StreamChunk[] => {
      const block = { type: "tool-call" as const, id, name: "moa_dispatch", arguments: JSON.stringify({ tasks }) };
      return [
        { type: "block-start", index: 0, blockType: "tool-call" },
        { type: "tool-call-delta", index: 0, id, name: block.name, argumentsDelta: block.arguments },
        { type: "block-end", index: 0, block },
        { type: "finish", reason: { kind: "tool-calls" } },
      ];
    };
    const item = { name: "worker", task: "Return REPORT_TO_CREATOR_OK", role: "Explorer", workspace: "shared" };
    let main = 0;
    f.adapter.handler = async options => {
      if (options.sessionId !== agent.id) return response("REPORT_TO_CREATOR_OK");
      if (++main === 1) return invoke("invalid-recipient", [item, { ...item, name: "invalid", reportTo: "creator" }]);
      if (main === 2) {
        const failure = options.messages.findLast(message => message.role === "tool");
        expect(failure).toMatchObject({ role: "tool", isError: true });
        const feedback = JSON.stringify(failure!.content);
        expect(feedback).toContain("moa/invalid-report-to");
        expect(feedback).toContain("tasks[1].reportTo");
        expect(feedback).toContain("Omit reportTo");
        expect(feedback).toContain(agent.id);
        expect(feedback).not.toContain("moa/not-member");
        expect(children).toEqual([]);
        expect(await f.ctx.subagents.listChildren(agent.id)).toEqual([]);
        const record = access.record(agent.id);
        expect(record.workers).toEqual([]);
        expect(Object.keys(record.operations).filter(key => key.startsWith("moa:task:") || key.startsWith("moa:agent:"))).toEqual([]);
        return invoke("default-recipient", [item]);
      }
      if (options.messages.some(message => message.role === "user" && message.source.kind === "project-mode-result" && JSON.stringify(message.content).includes("REPORT_TO_CREATOR_OK"))) {
        returned.resolve();
        return response("Worker result reviewed");
      }
      return response("Awaiting the admitted Worker result");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Delegate one task and report the result." }] }));
    await returned.promise;
    await agent.whenIdle();
    expect(children).toHaveLength(1);
    const record = access.record(agent.id);
    const descriptor = record.operations[`moa:agent:${children[0]}`];
    expect(descriptor).toMatchObject({ creatorId: agent.id, reportTo: agent.id });
    expect(agent.session.snapshotEvents().filter(event => event.type === "user/message" && event.data.source.kind === "project-mode-result")).toHaveLength(1);
    expect(agent.session.snapshotEvents().findLast(event => event.type === "turn/end")).toMatchObject({ data: { reason: { kind: "completed" } } });
  } finally { await f.dispose(); }
});

it("admits a reserved MoA child through native activation with identity before its task", async () => {
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    const childRequest = Promise.withResolvers<void>();
    f.adapter.handler = (options) => {
      if (options.sessionId === "moa-reserved") childRequest.resolve();
      return response("done");
    };
    const workers = (f.ctx.projectMode as any).workers;
    const child = SessionId("moa-reserved");
    const result = await workers.spawnMoA(
      agent,
      {
        name: "reader",
        task: "inspect",
        childId: child,
        cwd: f.root,
        identity: "Agent ID: moa-reserved",
        provider: "spawn",
      },
      "moa-spawn",
      new AbortController().signal,
    );
    expect(result.workerId).toBe(child);
    await childRequest.promise;
    const request = f.adapter.requests.find((r) => r.sessionId === child)!;
    const text = JSON.stringify(request.messages);
    expect(text.indexOf("Agent ID: moa-reserved")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Agent ID: moa-reserved")).toBeLessThan(
      text.indexOf("inspect"),
    );
    expect(
      (
        await f.ctx.projectMode.controlForAgent(
          agent,
          { action: "list" },
          "list",
          new AbortController().signal,
        )
      ).some((w: any) => w.workerId === child),
    ).toBe(true);
  } finally {
    await f.dispose();
  }
});

it("forks a selected session through native activation with a fresh identity", async () => {
  const { createHistoryBranchProvider, prepareHistoryBranch } = await import(
    "../../packages/project-mode/src/host/moa/agents.ts"
  );
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    (f.ctx.projectMode as any).moa.dispose();
    const child = SessionId("fork-child");
    let seed: ReturnType<typeof prepareHistoryBranch> | undefined;
    const unregister = f.ctx.subagents.registerProvider(
      createHistoryBranchProvider((id) => id === child ? seed : undefined),
    );
    const { agent: source } = await f.ctx.agents.create({
      sessionId: SessionId("selected-source"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    source.followup(
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "inherited source fact" }],
      }),
    );
    await source.whenIdle();
    const events = source.session.snapshotEvents();
    seed = prepareHistoryBranch(events, events.at(-1)!.seq);
    const received = Promise.withResolvers<void>();
    f.adapter.handler = (options) => {
      if (options.sessionId === child) received.resolve();
      return response("done");
    };
    const workers = (f.ctx.projectMode as any).workers;
    await workers.spawnMoA(
      agent,
      {
        name: "fork",
        task: "branch task",
        childId: child,
        cwd: f.root,
        identity: "Agent ID: fork-child",
        provider: "moa-fork",
      },
      "fork",
      new AbortController().signal,
    );
    await received.promise;
    const messages = JSON.stringify(
      f.adapter.requests.find((r) => r.sessionId === child)!.messages,
    );
    expect(messages).toContain("inherited source fact");
    expect(messages.indexOf("inherited source fact")).toBeLessThan(
      messages.indexOf("Agent ID: fork-child"),
    );
    unregister();
  } finally {
    await f.dispose();
  }
});

it("keeps a nested child's native parent distinct from the project owner", async () => {
  const f = await fixture();
  const release = Promise.withResolvers<void>();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    f.adapter.handler = async (options) => {
      if (options.sessionId !== agent.id) await release.promise;
      return response("done");
    };
    const workers = (f.ctx.projectMode as any).workers;
    const access = (f.ctx.projectMode as any).access;
    const creatorId = SessionId("creator");
    await access.update(agent.id, (r: any) => ({
      ...r,
      operations: {
        ...r.operations,
        [`moa:agent:${creatorId}`]: { nested: true },
      },
    }));
    await workers.spawnMoA(
      agent,
      {
        name: "creator",
        task: "start",
        childId: creatorId,
        cwd: f.root,
        identity: "creator",
        provider: "spawn",
      },
      "creator-op",
      new AbortController().signal,
    );
    const creator = f.ctx.agents.get(creatorId)!;
    const child = SessionId("nested");
    const receipt = await workers.spawnMoA(
      creator,
      {
        name: "nested",
        task: "task",
        childId: child,
        cwd: f.root,
        identity: "nested",
        provider: "spawn",
      },
      "nested-op",
      new AbortController().signal,
    );
    expect(receipt.workerId).toBe(child);
    expect(
      (await f.ctx.subagents.listChildren(creatorId)).some(
        (item) => item.id === child,
      ),
    ).toBe(true);
    expect(
      (
        await f.ctx.projectMode.controlForAgent(
          agent,
          { action: "list" },
          "list",
          new AbortController().signal,
        )
      ).some((w: any) => w.workerId === child),
    ).toBe(true);
  } finally {
    release.resolve();
    await f.dispose();
  }
});

it("queries actual direct children and waits for native completion", async () => {
  const { MoAAgents } = await import(
    "../../packages/project-mode/src/host/moa/agents.ts"
  );
  const f = await fixture();
  const release = Promise.withResolvers<void>();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    f.adapter.handler = async (options) => {
      if (options.sessionId !== agent.id) await release.promise;
      return response("done");
    };
    const workers = (f.ctx.projectMode as any).workers;
    const access = (f.ctx.projectMode as any).access;
    const child = SessionId("wait-child");
    await workers.spawnMoA(
      agent,
      {
        name: "worker",
        task: "work",
        childId: child,
        cwd: f.root,
        identity: "worker",
        provider: "spawn",
      },
      "wait-spawn",
      new AbortController().signal,
    );
    const controls = new MoAAgents(access, workers);
    const initial = await controls.observe(
      agent,
      {},
      new AbortController().signal,
    );
    expect(initial.children[0].workerId).toBe(child);
    const pending = controls.observe(
      agent,
      { wait: "all", timeoutMs: 5000 },
      new AbortController().signal,
    );
    expect(controls.lifecycle(agent)).toBe("Waiting");
    release.resolve();
    expect((await pending).reason).toBe("done");
  } finally {
    release.resolve();
    await f.dispose();
  }
});

it("kills the native child without deleting its project membership", async () => {
  const { MoAAgents } = await import(
    "../../packages/project-mode/src/host/moa/agents.ts"
  );
  const f = await fixture();
  const release = Promise.withResolvers<void>();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    f.adapter.handler = async (options) => {
      if (options.sessionId !== agent.id) await release.promise;
      return response("done");
    };
    const workers = (f.ctx.projectMode as any).workers;
    const access = (f.ctx.projectMode as any).access;
    const child = SessionId("kill-child");
    await workers.spawnMoA(
      agent,
      {
        name: "worker",
        task: "work",
        childId: child,
        cwd: f.root,
        identity: "worker",
        provider: "spawn",
      },
      "kill-spawn",
      new AbortController().signal,
    );
    const controls = new MoAAgents(access, workers);
    const stopped = controls.stopWork(agent, child, new AbortController().signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const live = f.ctx.agents.get(child);
    if (live) expect(controls.lifecycle(live)).toBe("Aborting");
    release.resolve();
    expect(await stopped).toMatchObject({
      workerId: child,
      accepted: true,
      lifecycle: "Zombie",
    });
    expect(
      (await controls.observe(agent, {}, new AbortController().signal))
        .children[0].workerId,
    ).toBe(child);
  } finally {
    release.resolve();
    await f.dispose();
  }
});

it("runs moa_observe as a native model tool", async () => {
  const { MoAAgents } = await import(
    "../../packages/project-mode/src/host/moa/agents.ts"
  );
  const { createTeamObserver } = await import(
    "../../packages/project-mode/src/host/moa/tools.ts"
  );
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    const controls = new MoAAgents(
      (f.ctx.projectMode as any).access,
      (f.ctx.projectMode as any).workers,
    );
    let count = 0;
    f.adapter.handler = () =>
      ++count === 1
        ? [
            { type: "block-start", index: 0, blockType: "tool-call" },
            {
              type: "tool-call-delta",
              index: 0,
              id: "query",
              name: "moa_observe",
              argumentsDelta: "{}",
            },
            {
              type: "block-end",
              index: 0,
              block: {
                type: "tool-call",
                id: "query",
                name: "moa_observe",
                arguments: "{}",
              },
            },
            { type: "finish", reason: { kind: "tool-calls" } },
          ]
        : response("done");
    agent.followup(
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "query" }],
      }),
    );
    await agent.whenIdle();
    expect(count).toBe(2);
    expect(
      f.adapter.requests[1].messages.some(
        (m) =>
          m.role === "tool" && JSON.stringify(m.content).includes("children"),
      ),
    ).toBe(true);
  } finally {
    await f.dispose();
  }
});

it("creates a shared moa_dispatch with durable identity and workspace facts before native execution", async () => {
  const { MoAAgents } = await import(
    "../../packages/project-mode/src/host/moa/agents.ts"
  );
  const f = await fixture();
  const release = Promise.withResolvers<void>();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    const seen = Promise.withResolvers<void>();
    f.adapter.handler = async (options) => {
      if (options.sessionId !== agent.id) {
        seen.resolve();
        await release.promise;
      }
      return response("done");
    };
    const access = (f.ctx.projectMode as any).access;
    const controls = new MoAAgents(access, (f.ctx.projectMode as any).workers);
    const [receipt] = await controls.dispatch(
      agent,
      [
        {
          name: "worker",
          task: "inspect",
          role: "Explorer",
          workspace: "shared",
        },
      ],
      "task-tool",
      new AbortController().signal,
    );
    await seen.promise;
    expect(
      access.record(agent.id).operations[`moa:agent:${receipt.workerId}`],
    ).toMatchObject({
      creatorId: agent.id,
      reportTo: agent.id,
      role: "Explorer",
      nested: false,
      workspace: { mode: "shared", ownerId: receipt.workerId },
    });
    const messages = JSON.stringify(
      f.adapter.requests.find((r) => r.sessionId === receipt.workerId)!
        .messages,
    );
    expect(messages).toContain(`Agent ID: ${receipt.workerId}`);
  } finally {
    release.resolve();
    await f.dispose();
  }
});

it("defaults moa_dispatch to an isolated current-content workspace", async () => {
  const { MoAAgents } = await import(
    "../../packages/project-mode/src/host/moa/agents.ts"
  );
  const { execFileSync } = await import("node:child_process");
  const { writeFile, readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const f = await fixture();
  const release = Promise.withResolvers<void>();
  try {
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: f.root });
    git("init");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.com");
    await writeFile(join(f.root, "tracked.txt"), "committed");
    git("add", "tracked.txt");
    git("commit", "-m", "initial");
    await writeFile(join(f.root, "tracked.txt"), "dirty snapshot");
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    f.adapter.handler = async (options) => {
      if (options.sessionId !== agent.id) await release.promise;
      return response("done");
    };
    const access = (f.ctx.projectMode as any).access;
    const controls = new MoAAgents(access, (f.ctx.projectMode as any).workers);
    const [receipt] = await controls.dispatch(
      agent,
      [{ name: "worker", task: "work", role: "General-purpose" }],
      "isolated-task",
      new AbortController().signal,
    );
    const descriptor = access.record(agent.id).operations[
      `moa:agent:${receipt.workerId}`
    ];
    expect(descriptor.workspace.mode).toBe("isolated");
    expect(
      await readFile(
        join(descriptor.workspace.directory, "tracked.txt"),
        "utf8",
      ),
    ).toBe("dirty snapshot");
    expect(descriptor.workspace.directory).not.toBe(f.root);
  } finally {
    release.resolve();
    await f.dispose();
  }
});

it("runs moa_dispatch as a native model tool and admits a child", async () => {
  const { MoAAgents } = await import(
    "../../packages/project-mode/src/host/moa/agents.ts"
  );
  const { createWorkDispatcher } = await import(
    "../../packages/project-mode/src/host/moa/tools.ts"
  );
  const f = await fixture();
  const release = Promise.withResolvers<void>();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    const controls = new MoAAgents(
      (f.ctx.projectMode as any).access,
      (f.ctx.projectMode as any).workers,
    );
    const called = Promise.withResolvers<void>();
    let count = 0;
    const args = JSON.stringify({
      tasks: [
        {
          name: "worker",
          task: "inspect",
          role: "Explorer",
          workspace: "shared",
        },
      ],
    });
    f.adapter.handler = async (options) => {
      if (options.sessionId !== agent.id) {
        await release.promise;
        return response("worker done");
      }
      if (count > 0) called.resolve();
      return ++count === 1
        ? [
            { type: "block-start", index: 0, blockType: "tool-call" },
            {
              type: "tool-call-delta",
              index: 0,
              id: "task",
              name: "moa_dispatch",
              argumentsDelta: args,
            },
            {
              type: "block-end",
              index: 0,
              block: {
                type: "tool-call",
                id: "task",
                name: "moa_dispatch",
                arguments: args,
              },
            },
            { type: "finish", reason: { kind: "tool-calls" } },
          ]
        : response("done");
    };
    agent.followup(
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "delegate" }],
      }),
    );
    await called.promise;
    expect(count).toBe(2);
    expect(
      await f.ctx.projectMode.controlForAgent(
        agent,
        { action: "list" },
        "list",
        new AbortController().signal,
      ),
    ).toHaveLength(1);
    release.resolve();
  } finally {
    release.resolve();
    await f.dispose();
  }
});

it("Fork carries selected source history into a fresh child identity", async () => {
  const { MoAAgents } = await import(
    "../../packages/project-mode/src/host/moa/agents.ts"
  );
  const f = await fixture();
  const release = Promise.withResolvers<void>();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    agent.followup(
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "remember this source fact" }],
      }),
    );
    await agent.whenIdle();
    const seen = Promise.withResolvers<void>();
    f.adapter.handler = async (options) => {
      if (options.sessionId !== agent.id) {
        seen.resolve();
        await release.promise;
      }
      return response("done");
    };
    const controls = new MoAAgents(
      (f.ctx.projectMode as any).access,
      (f.ctx.projectMode as any).workers,
    );
    const receipt = await controls.branch(
      agent,
      agent.id,
      {
        name: "fork",
        task: "branch task",
        role: "Planner",
        workspace: "shared",
      },
      "fork-tool",
      new AbortController().signal,
    );
    await seen.promise;
    const messages = JSON.stringify(
      f.adapter.requests.find((r) => r.sessionId === receipt.workerId)!
        .messages,
    );
    expect(
      messages.indexOf("remember this source fact"),
    ).toBeGreaterThanOrEqual(0);
    expect(messages.indexOf("remember this source fact")).toBeLessThan(
      messages.indexOf(`Agent ID: ${receipt.workerId}`),
    );
    const record = (f.ctx.projectMode as any).access.record(agent.id);
    expect(record.operations["moa:fork:fork-tool"]).toMatchObject({
      sourceId: agent.id,
      watermark: expect.any(Number),
    });
    expect(record.operations["moa:fork:fork-tool"]).not.toHaveProperty("seed");
    await f.ctx.projectMode.snapshot(agent.id);
    expect(
      (f.ctx.projectMode as any).access
        .record(agent.id)
        .completions.filter((c: any) => c.workerId === receipt.workerId),
    ).toHaveLength(0);
    expect(
      record.operations[`moa:agent:${receipt.workerId}`],
    ).not.toHaveProperty("forkSeed");
    controls.dispose();
  } finally {
    release.resolve();
    await f.dispose();
  }
});

it("runs Fork as a native model tool", async () => {
  const { MoAAgents } = await import(
    "../../packages/project-mode/src/host/moa/agents.ts"
  );
  const { createContextBrancher } = await import(
    "../../packages/project-mode/src/host/moa/tools.ts"
  );
  const f = await fixture();
  const release = Promise.withResolvers<void>();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    const controls = new MoAAgents(
      (f.ctx.projectMode as any).access,
      (f.ctx.projectMode as any).workers,
    );
    const called = Promise.withResolvers<void>();
    let count = 0;
    const args = JSON.stringify({
      source: agent.id,
      name: "fork",
      task: "inspect",
      role: "Explorer",
      workspace: "shared",
    });
    f.adapter.handler = async (options) => {
      if (options.sessionId !== agent.id) {
        await release.promise;
        return response("worker done");
      }
      if (count > 0) called.resolve();
      return ++count === 1
        ? [
            { type: "block-start", index: 0, blockType: "tool-call" },
            {
              type: "tool-call-delta",
              index: 0,
              id: "fork",
              name: "moa_branch",
              argumentsDelta: args,
            },
            {
              type: "block-end",
              index: 0,
              block: {
                type: "tool-call",
                id: "fork",
                name: "moa_branch",
                arguments: args,
              },
            },
            { type: "finish", reason: { kind: "tool-calls" } },
          ]
        : response("done");
    };
    agent.followup(
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "branch this" }],
      }),
    );
    await called.promise;
    expect(
      await f.ctx.projectMode.controlForAgent(
        agent,
        { action: "list" },
        "list",
        new AbortController().signal,
      ),
    ).toHaveLength(1);
    release.resolve();
    controls.dispose();
  } finally {
    release.resolve();
    await f.dispose();
  }
});

it("restricts Explorer's native execution tools to read-only capabilities", async () => {
  const { applyRoleRestrictions } = await import(
    "../../packages/project-mode/src/host/moa/roles.ts"
  );
  const f = await fixture();
  try {
    for (const name of ["read", "grep", "glob", "write", "bash"])
      f.ctx.tools.register({
        name,
        description: name,
        parameters: { type: "object", properties: {} },
        output: {
          schema: { type: "string" },
          render: (_a, v) => [{ type: "text", text: String(v) }],
        },
        execute: async () => "ok",
      });
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("reader"),
      meta: { cwd: f.root },
    });
    const dispose = applyRoleRestrictions(f.ctx, agent, "Explorer");
    expect(f.ctx.tools.get("read", agent)).toBeDefined();
    expect(f.ctx.tools.get("grep", agent)).toBeDefined();
    expect(f.ctx.tools.get("glob", agent)).toBeDefined();
    expect(f.ctx.tools.get("write", agent)).toBeUndefined();
    expect(f.ctx.tools.get("bash", agent)).toBeUndefined();
    dispose();
    expect(f.ctx.tools.get("write", agent)).toBeDefined();
  } finally {
    await f.dispose();
  }
});

it("moa_context writes only inside the shared context using the acting sandbox policy", async () => {
  const { MoAAgents } = await import(
    "../../packages/project-mode/src/host/moa/agents.ts"
  );
  const { default: Policy, setSandboxMode } = await import(
    "@deepseek-ai/dsh-sandbox-policy"
  );
  const { default: Loader } = await import("@deepseek-ai/cordis-plugin-loader");
  const { default: Group } = await import("@deepseek-ai/cordis-plugin-group");
  const { default: Presets } = await import(
    "@deepseek-ai/dsh-agent-preset-registry"
  );
  const f = await fixture(undefined, { sandboxMode: "workspace-write" });
  try {
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
      sessionId: SessionId("parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
      setup: async (ctx) => {
        await f.ctx.agentPresets.mount(ctx);
      },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    const controls = new MoAAgents(
      (f.ctx.projectMode as any).access,
      (f.ctx.projectMode as any).workers,
    );
    await controls.sharedContext(
      agent,
      { action: "write", path: "fact.md", content: "reusable fact" },
      new AbortController().signal,
    );
    expect(
      await controls.sharedContext(
        agent,
        { action: "read", path: "fact.md" },
        new AbortController().signal,
      ),
    ).toMatchObject({ content: "reusable fact" });
    await expect(
      controls.sharedContext(
        agent,
        { action: "write", path: "../notes.md", content: "bad" },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/path/);
    setSandboxMode(agent.session, "read-only");
    await expect(
      controls.sharedContext(
        agent,
        { action: "write", path: "denied.md", content: "bad" },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/read.only|denied/i);
  } finally {
    await f.dispose();
  }
});

it("runs moa_context as a native model tool", async () => {
  const { MoAAgents } = await import(
    "../../packages/project-mode/src/host/moa/agents.ts"
  );
  const { createSharedContextAccess } = await import(
    "../../packages/project-mode/src/host/moa/tools.ts"
  );
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    const controls = new MoAAgents(
      (f.ctx.projectMode as any).access,
      (f.ctx.projectMode as any).workers,
    );
    let count = 0;
    const args = JSON.stringify({
      action: "write",
      path: "fact.md",
      content: "persisted",
    });
    f.adapter.handler = () =>
      ++count === 1
        ? [
            { type: "block-start", index: 0, blockType: "tool-call" },
            {
              type: "tool-call-delta",
              index: 0,
              id: "context",
              name: "moa_context",
              argumentsDelta: args,
            },
            {
              type: "block-end",
              index: 0,
              block: {
                type: "tool-call",
                id: "context",
                name: "moa_context",
                arguments: args,
              },
            },
            { type: "finish", reason: { kind: "tool-calls" } },
          ]
        : response("done");
    agent.followup(
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "record fact" }],
      }),
    );
    await agent.whenIdle();
    expect(
      await controls.sharedContext(
        agent,
        { action: "read", path: "fact.md" },
        new AbortController().signal,
      ),
    ).toMatchObject({ content: "persisted" });
  } finally {
    await f.dispose();
  }
});

it("deduplicates concurrent moa_dispatch retries before workspace and activation", async () => {
  const { MoAAgents } = await import(
    "../../packages/project-mode/src/host/moa/agents.ts"
  );
  const f = await fixture();
  const release = Promise.withResolvers<void>();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    f.adapter.handler = async (options) => {
      if (options.sessionId !== agent.id) await release.promise;
      return response("done");
    };
    const controls = new MoAAgents(
      (f.ctx.projectMode as any).access,
      (f.ctx.projectMode as any).workers,
    );
    const input = [
      {
        name: "worker",
        task: "work",
        role: "Explorer" as const,
        workspace: "shared" as const,
      },
    ];
    const [a, b] = await Promise.all([
      controls.dispatch(agent, input, "same", new AbortController().signal),
      controls.dispatch(agent, input, "same", new AbortController().signal),
    ]);
    expect(a).toEqual(b);
    expect(await f.ctx.subagents.listChildren(agent.id)).toHaveLength(1);
  } finally {
    release.resolve();
    await f.dispose();
  }
});
