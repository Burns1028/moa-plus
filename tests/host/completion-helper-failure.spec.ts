import { expect, it } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage, type StreamChunk } from "@deepseek-ai/dsh-llm";
import { fixture, response } from "./fixture.ts";

function rubric(): StreamChunk[] {
  return [
    { type: "block-start", index: 0, blockType: "tool-call" },
    { type: "block-end", index: 0, block: { type: "tool-call", id: "rubric", name: "submit_rubric", arguments: JSON.stringify({ rubric: "- Reply to the user's message", tests_required: false }) } },
    { type: "finish", reason: { kind: "tool-calls" } },
  ];
}

it.each(["builder", "verifier"])("reports a native %s failure without instructing the Coordinator to repair the plugin", async role => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId(`helper-failure-${role}`), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let parentRequests = 0;
    f.adapter.handler = request => {
      const id = String(request.sessionId);
      if (id.startsWith(`moa-${role}-`)) throw new Error("Native helper model setup failed");
      if (id.startsWith("moa-builder-")) return rubric();
      parentRequests++;
      if (parentRequests > 1) agent.cancel({ kind: "user" });
      return response("123");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "123" }] }));
    await agent.whenIdle();
    const events = agent.session.snapshotEvents();
    const end = events.findLast(event => event.type === "turn/end");
    expect(parentRequests).toBe(1);
    expect(end).toMatchObject({ data: { reason: { kind: "error", error: { message: expect.stringContaining("Native helper model setup failed") } } } });
    expect(events.some(event => event.type === "user/message" && event.data.source.kind === "moa-completion")).toBe(false);
  } finally { await f.dispose(); }
});
