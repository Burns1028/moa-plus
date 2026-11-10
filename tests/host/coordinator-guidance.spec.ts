import { it, expect } from "vitest";
import { join } from "node:path";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage, type GenerateOptions } from "@deepseek-ai/dsh-llm";
import Loader from "@deepseek-ai/cordis-plugin-loader";
import Presets from "@deepseek-ai/dsh-agent-preset-registry";
import { fixture, response } from "./fixture.ts";
import { coordinatorPrompt } from "../../packages/project-mode/src/host/prompts/coordinator.ts";

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

function runtimeText(request: GenerateOptions) {
  return (
    request.messages
      .filter((message) => message.source.kind === "runtime-context")
      .at(-1)?.content.filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n") ?? ""
  );
}

function policyCopies(request: GenerateOptions) {
  return (
    request.messages
      .flatMap((message) => message.content)
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .split(coordinatorPrompt).length - 1
  );
}

it("describes distinct work ownership and selective knowledge contributions in actual model inputs", async () => {
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("guidance-work-ownership"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    agent.followup(prompt("Continue from the existing evidence and assign the remaining work."));
    await agent.whenIdle();
    const coordinator = f.adapter.requests.find((request) => request.sessionId === agent.id)!;
    const policy = `${systemText(coordinator)}\n${runtimeText(coordinator)}`;
    expect(policy).toContain("Give each workstream a clear owner");
    expect(policy).toContain("Reuse completed results and existing checks");
    expect(policy).toContain("unresolved question");

    const seen = Promise.withResolvers<GenerateOptions>();
    f.adapter.handler = (request) => {
      if (request.sessionId !== agent.id) seen.resolve(request);
      return response("done");
    };
    const receipt = await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "spawn", name: "reviewer", task: "Review the existing evidence without modifying any file." },
      "selective-memory",
      new AbortController().signal,
    ) as { workerId: SessionId };
    // Native ownership may release a completed Worker before admission returns.
    // The captured model request is the contract under test, not residency.
    const worker = await seen.promise;
    expect(worker.sessionId).toBe(receipt.workerId);
    const instructions = JSON.stringify(worker.messages);
    expect(instructions).toContain("without modifying any file");
    expect(instructions).toContain("Only contribute knowledge when");
    expect(instructions).toContain("no new reusable finding");
    expect(instructions).toContain("assignment's write constraints");
  } finally {
    await f.dispose();
  }
});

it("explains role execution capabilities and explicit reply syntax in native tool schemas", async () => {
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("guidance-role-tools"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    agent.followup(prompt("Assign an independent check that can run the required commands."));
    await agent.whenIdle();
    const request = f.adapter.requests.find((entry) => entry.sessionId === agent.id)!;
    for (const name of ["Task", "Fork"]) {
      const schema = JSON.stringify(request.tools!.find((tool) => tool.name === name));
      expect(schema).toContain("glob, grep and read");
      expect(schema).toContain("no Bash");
      expect(schema).toContain("General-purpose");
      expect(schema).toContain("running commands");
    }
    const send = JSON.stringify(request.tools!.find((tool) => tool.name === "SendMessage"));
    expect(send).toContain("mode=notify");
    expect(send).toContain("reply_to");
    expect(send).toContain("not a new request");
  } finally {
    await f.dispose();
  }
});

it("puts coordinator policy in the actual system message and removes it on plugin disposal", async () => {
  const f = await fixture();
  try {
    f.ctx.baseUrl = new URL("./", import.meta.url).href;
    await f.ctx.plugin(Loader);
    await f.ctx.plugin(Presets, { default: "ordinary" });
    await f.ctx.agentPresets.register({ id: "ordinary", plugins: [] });
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("guidance-coordinator"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
      setup: async (ctx) => {
        await f.ctx.agentPresets.mount(ctx);
      },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    agent.followup(prompt("盘点磁盘使用情况，分类给我"));
    await agent.whenIdle();
    const first = f.adapter.requests[0];
    expect(first.tools?.some((tool) => tool.name === "Task")).toBe(
      true,
    );
    const system = systemText(first);
    expect(system).toContain("MoA+ coordinator");
    expect(system).toContain("Task");
    expect(system).toContain(coordinatorPrompt);
    expect(system).toContain("shared index");
    expect(system).toContain("existing worker");
    expect(system).toContain("steer");
    expect(system).toContain("queue");
    expect(policyCopies(first)).toBe(1);
    expect(runtimeText(first)).not.toContain(coordinatorPrompt);
    expect(runtimeText(first)).toContain("Paths:");
    expect(runtimeText(first)).toContain(JSON.stringify(join(f.root, "context", "index.md")));
    expect(runtimeText(first)).toContain("Worker state sampled for this user input");

    agent.followup(prompt("Continue with the latest team state"));
    await agent.whenIdle();
    const continued = f.adapter.requests.at(-1)!;
    expect(policyCopies(continued)).toBe(1);
    expect(runtimeText(continued)).not.toContain(coordinatorPrompt);
    expect(runtimeText(continued)).toContain(JSON.stringify(join(f.root, "context", "index.md")));
    expect(runtimeText(continued)).not.toBe(runtimeText(first));

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
      "MoA+ coordinator",
    );
  } finally {
    await f.dispose();
  }
});

it("keeps one coordinator policy in required context when the native preset owns the complete system prompt", async () => {
  const f = await fixture();
  const completePrompt = "A preset-owned complete SYSTEM prompt.";
  let registerComplete!: () => () => void;
  let removeComplete!: () => void;
  try {
    f.ctx.baseUrl = new URL("./", import.meta.url).href;
    await f.ctx.plugin(Loader);
    f.ctx.loader.builtins["complete-system-prompt"] = {
      inject: ["systemPrompt"],
      apply(ctx) {
        registerComplete = () =>
          ctx.systemPrompt.section({
            name: "preset:complete-system",
            order: 0,
            complete: true,
            text: completePrompt,
          });
        removeComplete = registerComplete();
        ctx.systemPrompt.suppressRuntimeContext();
      },
    };
    await f.ctx.plugin(Presets, { default: "complete" });
    await f.ctx.agentPresets.register({
      id: "complete",
      plugins: [{ name: "cordis:complete-system-prompt" }],
    });
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("guidance-complete-preset"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
      setup: async (ctx) => {
        await f.ctx.agentPresets.mount(ctx);
      },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    agent.followup(prompt("Coordinate the project"));
    await agent.whenIdle();
    const request = f.adapter.requests[0];
    const fallbackSnapshot = request.messages.find(
      (message) => message.source.kind === "runtime-context",
    )!;
    expect(systemText(request)).toBe(completePrompt);
    expect(policyCopies(request)).toBe(1);
    expect(runtimeText(request)).toContain(coordinatorPrompt);
    expect(runtimeText(request)).toContain("Paths:");
    expect(runtimeText(request)).toContain(JSON.stringify(join(f.root, "context", "index.md")));
    expect(runtimeText(request)).toContain("Worker state sampled for this user input");

    // Native history retains previous runtime snapshots. Check the current
    // system and latest runtime contributions as ownership changes live.
    removeComplete();
    agent.followup(prompt("Continue after removing complete ownership"));
    await agent.whenIdle();
    const ordinary = f.adapter.requests.at(-1)!;
    expect(systemText(ordinary)).toContain(coordinatorPrompt);
    expect(runtimeText(ordinary)).not.toContain(coordinatorPrompt);
    expect(runtimeText(ordinary)).toContain(JSON.stringify(join(f.root, "context", "index.md")));
    expect(ordinary.messages).toContainEqual(fallbackSnapshot);
    expect(
      `${systemText(ordinary)}\n${runtimeText(ordinary)}`.split(coordinatorPrompt),
    ).toHaveLength(2);

    removeComplete = registerComplete();
    agent.followup(prompt("Continue with complete ownership restored"));
    await agent.whenIdle();
    const restored = f.adapter.requests.at(-1)!;
    expect(systemText(restored)).toBe(completePrompt);
    expect(runtimeText(restored)).toContain(coordinatorPrompt);
    expect(runtimeText(restored)).toContain(JSON.stringify(join(f.root, "context", "index.md")));
    expect(
      `${systemText(restored)}\n${runtimeText(restored)}`.split(coordinatorPrompt),
    ).toHaveLength(2);

    await f.plugin.dispose();
    agent.followup(prompt("Continue after plugin disposal"));
    await agent.whenIdle();
    expect(systemText(f.adapter.requests.at(-1)!)).toBe(completePrompt);
    expect(runtimeText(f.adapter.requests.at(-1)!)).not.toContain(coordinatorPrompt);
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
    expect(systemText(workerRequest)).not.toContain("MoA+ coordinator");
    expect(JSON.stringify(workerRequest)).toContain("MoA+ worker");
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
      "MoA+ coordinator",
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
    expect(systemText(await workerRequest.promise)).not.toContain(workflowGuidance);
    await coordinator.whenIdle();
    await f.plugin.dispose();
    coordinator.followup(prompt("Continue after plugin disposal"));
    await coordinator.whenIdle();
    expect(systemText(f.adapter.requests.at(-1)!)).toContain(workflowGuidance);
  } finally {
    await f.dispose();
  }
});
