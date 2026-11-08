import { Context } from "@deepseek-ai/cordis";
import AgentLoop from "@deepseek-ai/dsh-agent-loop";
import { mountAgentLoopTestDependencies } from "@deepseek-ai/dsh-agent-loop-testkit";
import { createUserMessage, type StreamChunk } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { expect, it } from "vitest";
import { Adapter, response } from "../host/fixture.ts";

const output = { schema: { type: "string" as const }, render: (_args: unknown, value: string) => [{ type: "text" as const, text: value }] };
const user = () => createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Use the available capability" }] });
function call(name: string, args: object): StreamChunk[] {
  return [{ type: "block-start", index: 0, blockType: "tool-call" }, { type: "block-end", index: 0, block: { type: "tool-call", id: "protocol-call", name, arguments: JSON.stringify(args) } }, { type: "finish", reason: { kind: "tool-calls" } }];
}
async function setup(mode: "native" | "ptc") {
  const ctx = new Context();
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true, systemPrompt: { toolOrder: ["SendMessage", "<unlisted-tools>"] } });
  await ctx.plugin(AgentLoop, { agents: [] });
  await ctx.plugin((await import("@deepseek-ai/dsh-subprocess-local")).default);
  await ctx.plugin((await import("@deepseek-ai/dsh-sandbox-policy")).default, { mode: "danger-full-access" });
  await ctx.plugin((await import("@deepseek-ai/dsh-sandbox-local")).default);
  await ctx.plugin((await import("@deepseek-ai/dsh-ptc-runtime-node")).default);
  const adapter = new Adapter(); ctx.llm.registerAdapter(["test"], adapter);
  let protocolCalls = 0, ordinaryCalls = 0;
  const protocol = defineTool({ name: "SendMessage", nativeOnly: true, description: "Native protocol operation", parameters: {}, output, execute: async () => { protocolCalls++; return "protocol answer"; } });
  ctx.tools.register(protocol);
  ctx.tools.register(defineTool({ name: "ordinary", description: "Ordinary program capability", parameters: {}, output, execute: async () => { ordinaryCalls++; return "ordinary value"; } }));
  const { agent } = await ctx.agents.create({ sessionId: SessionId(`protocol-${mode}`), agentOptions: { provider: "test", model: "test" }, setup: agentCtx => { agentCtx.tools.presentAs(mode); } });
  return { ctx, agent, adapter, protocol, counts: () => ({ protocolCalls, ordinaryCalls }), dispose: () => ctx.fiber.dispose() };
}

it("retains only exact true native-only metadata", () => {
  for (const value of [true, false, "true", undefined]) {
    const definition = defineTool({ name: "protocol", nativeOnly: value, description: "protocol", parameters: {}, output, execute: async () => "done" } as any);
    expect(definition.nativeOnly).toBe(value === true ? true : undefined);
  }
});

it.each(["native", "ptc"] as const)("publishes and executes a native-only protocol through %s function calling", async mode => {
  const f = await setup(mode);
  try {
    expect(f.protocol.nativeOnly).toBe(true);
    const wire = f.ctx.tools.wireSchemas(f.agent);
    expect(wire.schemas.map(schema => schema.name)).toContain("SendMessage");
    expect(wire.schemas.find(schema => schema.name === "SendMessage")).not.toHaveProperty("nativeOnly");
    expect(wire.knownNames).toContain("SendMessage");
    expect(f.ctx.tools.sdkSchemas(f.agent).map(schema => schema.name)).not.toContain("SendMessage");
    f.adapter.handler = () => f.adapter.requests.length === 1 ? call("SendMessage", {}) : response("done");
    f.agent.followup(user()); await f.agent.whenIdle();
    expect(f.counts().protocolCalls).toBe(1);
    expect(f.adapter.requests[0].tools?.map(schema => schema.name)).toContain("SendMessage");
    expect(f.agent.session.snapshotEvents().filter(event => event.type === "turn/start")).toHaveLength(1);
  } finally { await f.dispose(); }
});

it("omits native-only capabilities from actual PTC bindings and rejects forged nested dispatch", async () => {
  const f = await setup("ptc");
  try {
    f.adapter.handler = () => f.adapter.requests.length === 1 ? call("run_code", { code: "return { protocol: typeof tools.SendMessage, ordinary: await tools.ordinary({}) };", description: "Use the ordinary program SDK" }) : response("done");
    f.agent.followup(user()); await f.agent.whenIdle();
    expect(f.counts()).toEqual({ protocolCalls: 0, ordinaryCalls: 1 });
    const result = f.agent.session.snapshotEvents().find(event => event.type === "tool/result" && event.data.message.toolCallId === "protocol-call");
    expect(JSON.stringify(result)).toContain("undefined");
    const nested = await f.ctx.tools.execute({ agent: f.agent, name: "SendMessage", callId: "forged-nested" as any, parent: Symbol("old-binding") as any, signal: new AbortController().signal, arguments: {} });
    expect(nested.isError).toBe(true);
    expect(nested.error?.info.code).toBe("UNKNOWN_TOOL");
    expect(JSON.stringify(nested)).toContain("directly");
    expect(f.counts().protocolCalls).toBe(0);
  } finally { await f.dispose(); }
});

it("keeps known native-only ordering valid when hidden and respects an ordinary scoped shadow", async () => {
  const f = await setup("ptc");
  try {
    const unrestrict = f.agent.ctx.tools.restrict({ allow: [] });
    expect((await f.ctx.systemPrompt.assemble({ scope: f.agent })).tools.map(tool => tool.name)).toEqual(["run_code"]);
    expect(f.ctx.tools.wireSchemas(f.agent).knownNames).toContain("SendMessage");
    unrestrict();
    const unsuppress = f.agent.ctx.tools.suppress({ deny: ["SendMessage"] });
    expect((await f.ctx.systemPrompt.assemble({ scope: f.agent })).tools.map(tool => tool.name)).not.toContain("SendMessage");
    expect(f.ctx.tools.wireSchemas(f.agent).knownNames).toContain("SendMessage");
    unsuppress();
    const shadow = f.agent.ctx.tools.register({ ...f.protocol, nativeOnly: false } as any);
    expect(f.ctx.tools.wireSchemas(f.agent).knownNames).not.toContain("SendMessage");
    await expect(f.ctx.systemPrompt.assemble({ scope: f.agent })).rejects.toThrow(/toolOrder lists unregistered tool.*SendMessage/);
    shadow();
    expect((await f.ctx.systemPrompt.assemble({ scope: f.agent })).tools.map(tool => tool.name)).toContain("SendMessage");
  } finally { await f.dispose(); }
});
