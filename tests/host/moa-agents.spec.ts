import { expect, it } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { fixture, response } from "./fixture.ts";

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
  const { createForkProvider, prepareForkSeed } = await import(
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
    const seeds = new Map();
    const unregister = f.ctx.subagents.registerProvider(
      createForkProvider(seeds),
    );
    const child = SessionId("fork-child");
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
    seeds.set(child, prepareForkSeed(events, events.at(-1)!.seq));
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
    expect(seeds.has(child)).toBe(false);
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
    const initial = await controls.query(
      agent,
      {},
      new AbortController().signal,
    );
    expect(initial.children[0].workerId).toBe(child);
    const pending = controls.query(
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
    expect(
      await controls.kill(agent, child, new AbortController().signal),
    ).toMatchObject({ workerId: child, accepted: true });
    expect(
      (await controls.query(agent, {}, new AbortController().signal))
        .children[0].workerId,
    ).toBe(child);
  } finally {
    release.resolve();
    await f.dispose();
  }
});

it("runs QueryAgent as a native model tool", async () => {
  const { MoAAgents } = await import(
    "../../packages/project-mode/src/host/moa/agents.ts"
  );
  const { createQueryAgentTool } = await import(
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
    const dispose = agent.ctx.tools.register(createQueryAgentTool(controls));
    let count = 0;
    f.adapter.handler = () =>
      ++count === 1
        ? [
            { type: "block-start", index: 0, blockType: "tool-call" },
            {
              type: "tool-call-delta",
              index: 0,
              id: "query",
              name: "QueryAgent",
              argumentsDelta: "{}",
            },
            {
              type: "block-end",
              index: 0,
              block: {
                type: "tool-call",
                id: "query",
                name: "QueryAgent",
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
    dispose();
  } finally {
    await f.dispose();
  }
});
