import { it, expect, vi } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { ToolCallId } from "@deepseek-ai/dsh-llm";
import { fixture, response } from "./fixture.ts";

it("removes coordinator workflow delegation, preserves worker tools, and restores on plugin disposal", async () => {
  const f = await fixture();
  const gate = Promise.withResolvers<void>();
  try {
    const workflow = {
      name: "workflow",
      description: "native workflow delegation",
      parameters: { type: "object", properties: {} },
      output: {
        schema: { type: "string" },
        render: (_args: unknown, value: unknown) => [
          { type: "text" as const, text: String(value) },
        ],
      },
      execute: async () => "native",
    };
    f.ctx.tools.register(workflow);
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("workflow-parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    const { agent: ordinary } = await f.ctx.agents.create({
      sessionId: SessionId("workflow-ordinary"),
      meta: { cwd: f.root },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    expect(f.ctx.tools.get("workflow", agent)).toBeUndefined();
    expect(f.ctx.tools.get("workflow", ordinary)).toBe(workflow);
    expect(
      (
        await f.ctx.tools.execute({
          callId: ToolCallId("workflow-blocked"),
          name: "workflow",
          arguments: {},
          agent,
          signal: new AbortController().signal,
        })
      ).isError,
    ).toBe(true);
    f.adapter.handler = async (request) => {
      if (request.sessionId !== agent.id) await gate.promise;
      return response("done");
    };
    const receipt = await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "spawn", name: "worker", task: "work" },
      "spawn",
      new AbortController().signal,
    );
    const worker = f.ctx.agents.get(
      (receipt as { workerId: ReturnType<typeof SessionId> }).workerId,
    )!;
    expect(f.ctx.tools.get("workflow", worker)).toBeUndefined();
    expect(f.ctx.tools.get("moa_dispatch", worker)).toBeUndefined();
    gate.resolve();
    await worker.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    await vi.waitFor(() =>
      expect(
        f.adapter.requests.some((request) => request.sessionId === agent.id),
      ).toBe(true),
    );
    await agent.whenIdle();
    await expect(
      f.ctx.projectMode.setEnabled(
        agent.id,
        false,
        f.ctx.projectMode.mode(agent.id).revision,
        "disable",
      ),
    ).rejects.toThrow("project-mode/session-mode-locked");
    await f.plugin.dispose();
    expect(f.ctx.tools.get("workflow", agent)).toBe(workflow);
  } finally {
    gate.resolve();
    await f.dispose();
  }
});
