import { it, expect } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage, type GenerateOptions } from "@deepseek-ai/dsh-llm";
import { fixture, response } from "./fixture.ts";
import { coordinatorPrompt } from "../../packages/moa/src/host/coordinator-prompt.ts";

function systemText(request: GenerateOptions) {
  return request.messages
    .filter((message) => message.role === "system")
    .flatMap((message) => message.content)
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function prompt(text: string) {
  return createUserMessage({
    source: { kind: "user" },
    content: [{ type: "text", text }],
  });
}

it("puts coordinator policy in the actual system message and removes it on plugin disposal", async () => {
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("guidance-coordinator"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    agent.followup(prompt("盘点磁盘使用情况，分类给我"));
    await agent.whenIdle();
    const first = f.adapter.requests[0];
    expect(first.tools?.some((tool) => tool.name === "control_workers")).toBe(
      true,
    );
    const system = systemText(first);
    expect(system).toContain("MoA coordinator");
    expect(system).toContain("control_workers");
    expect(system).toContain(coordinatorPrompt);
    expect(system).toContain("shared index");
    expect(system).toContain("existing worker");
    expect(system).toContain("steer");
    expect(system).toContain("queue");
    // Presets that own their complete system message still need the same role
    // in required runtime context. These two prompt surfaces must not drift.
    const coordinatorPolicy = system
      .slice(system.indexOf("You are the MoA coordinator"))
      .trim();
    const runtime = first.messages
      .filter((message) => message.source.kind === "runtime-context")
      .flatMap((message) => message.content)
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    expect(runtime).toContain(coordinatorPolicy);

    const snapshot = await f.ctx.projectMode.snapshot(agent.id);
    await expect(
      f.ctx.projectMode.setEnabled(
        agent.id,
        false,
        snapshot!.revision,
        "disable",
      ),
    ).rejects.toThrow("project-mode/session-mode-locked");
    await f.plugin.dispose();
    agent.followup(prompt("普通会话"));
    await agent.whenIdle();
    expect(systemText(f.adapter.requests.at(-1)!)).not.toContain(
      "MoA coordinator",
    );
  } finally {
    await f.dispose();
  }
});

it("does not give the coordinator policy to workers or ordinary sessions", async () => {
  const f = await fixture();
  const seen = Promise.withResolvers<GenerateOptions>();
  const gate = Promise.withResolvers<void>();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("guidance-parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    f.adapter.handler = async (request) => {
      if (request.sessionId !== agent.id) {
        seen.resolve(request);
        await gate.promise;
      }
      return response("done");
    };
    const receipt = await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "spawn", name: "inventory", task: "Do the inventory" },
      "spawn",
      new AbortController().signal,
    );
    const workerRequest = await seen.promise;
    expect(systemText(workerRequest)).not.toContain("MoA coordinator");
    expect(JSON.stringify(workerRequest)).toContain("MoA worker");
    gate.resolve();
    await f.ctx.agents
      .get((receipt as { workerId: ReturnType<typeof SessionId> }).workerId)!
      .whenIdle();
    await agent.whenIdle();
    const { agent: ordinary } = await f.ctx.agents.create({
      sessionId: SessionId("guidance-ordinary"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    ordinary.followup(prompt("hello"));
    await ordinary.whenIdle();
    expect(systemText(f.adapter.requests.at(-1)!)).not.toContain(
      "MoA coordinator",
    );
  } finally {
    gate.resolve();
    await f.dispose();
  }
});

it("omits hidden tool guidance only from the coordinator and restores it on disposal", async () => {
  const f = await fixture();
  const workflowGuidance =
    "Native workflow guidance: prefer plain subagent calls.";
  const unrelatedGuidance =
    "A workflow report is an ordinary project document.";
  try {
    f.ctx.systemPrompt.section({
      name: "tool:workflow",
      order: 2600,
      text: workflowGuidance,
    });
    f.ctx.systemPrompt.section({
      name: "tool:workflow-report",
      order: 2601,
      text: unrelatedGuidance,
    });
    const create = async (id: string) =>
      (
        await f.ctx.agents.create({
          sessionId: SessionId(id),
          meta: { cwd: f.root },
          agentOptions: { provider: "test", model: "test" },
        })
      ).agent;
    const coordinator = await create("guidance-tools-parent");
    const ordinary = await create("guidance-tools-ordinary");
    await f.ctx.projectMode.setEnabled(coordinator.id, true, 0, "on");
    coordinator.followup(prompt("Inspect project"));
    ordinary.followup(prompt("Ordinary work"));
    await Promise.all([coordinator.whenIdle(), ordinary.whenIdle()]);
    const parentRequest = f.adapter.requests.find(
      (r) => r.sessionId === coordinator.id,
    )!;
    const ordinaryRequest = f.adapter.requests.find(
      (r) => r.sessionId === ordinary.id,
    )!;
    expect(systemText(parentRequest)).not.toContain(workflowGuidance);
    expect(systemText(parentRequest)).toContain(unrelatedGuidance);
    expect(systemText(ordinaryRequest)).toContain(workflowGuidance);

    const workerRequest = Promise.withResolvers<GenerateOptions>();
    f.adapter.handler = (request) => {
      if (request.sessionId !== coordinator.id) workerRequest.resolve(request);
      return response("done");
    };
    await f.ctx.projectMode.controlForAgent(
      coordinator,
      { action: "spawn", name: "investigation", task: "Inspect the evidence" },
      "spawn-guidance",
      new AbortController().signal,
    );
    expect(systemText(await workerRequest.promise)).toContain(workflowGuidance);
    await coordinator.whenIdle();
    await f.plugin.dispose();
    coordinator.followup(prompt("Continue after plugin disposal"));
    await coordinator.whenIdle();
    expect(systemText(f.adapter.requests.at(-1)!)).toContain(workflowGuidance);
  } finally {
    await f.dispose();
  }
});
