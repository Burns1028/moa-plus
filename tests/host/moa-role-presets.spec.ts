import { expect, it } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { applyRoleRestrictions } from "../../packages/project-mode/src/host/moa/roles.ts";
import { fixture, response } from "./fixture.ts";

it.each([
  ["Explorer", ["glob", "grep", "read"]],
  ["Planner", ["glob", "grep", "read"]],
  ["Deep Research", ["web_search", "web_fetch"]],
] as const)("keeps %s tools from the Agent's preset visible to native model inference", async (role, expected) => {
  const f = await fixture();
  try {
    f.ctx.baseUrl = new URL("./", import.meta.url).href;
    await f.ctx.plugin((await import("@deepseek-ai/cordis-plugin-loader")).default);
    await f.ctx.plugin((await import("@deepseek-ai/dsh-agent-preset-registry")).default, { default: "standard" });
    await f.ctx.agentPresets.register({ id: "standard", plugins: [{ name: new URL("./fixtures/specialist-tools.mjs", import.meta.url).href }] });
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId(`preset-${role}`), meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
      setup: async ctx => { await f.ctx.agentPresets.mount(ctx); },
    });
    expect(f.ctx.tools.get(expected[0])).toBeUndefined();
    const dispose = applyRoleRestrictions(f.ctx, agent, role);
    let names: string[] | undefined;
    f.adapter.handler = options => {
      names = (options.tools ?? []).map(tool => tool.name);
      return response("inspected");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Inspect the assigned sources" }] }));
    await agent.whenIdle();
    expect(names).toEqual(expect.arrayContaining([...expected]));
    expect(names).not.toContain("write");
    expect(names).not.toContain("bash");
    expect(f.adapter.requests).toHaveLength(1);
    dispose();
    expect(f.ctx.tools.get("write", agent)).toBeDefined();
  } finally { await f.dispose(); }
});
