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

function call(name: string, args: object = {}): StreamChunk[] {
  return [
    { type: "block-start", index: 0, blockType: "tool-call" },
    { type: "block-end", index: 0, block: { type: "tool-call", id: name, name, arguments: JSON.stringify(args) } },
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

it("continues with new human input arriving at the failed helper's native turn-end boundary", async () => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("helper-failure-new-input"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let parentRequests = 0, failedVerifier: string | undefined, steered = false;
    const verificationRequests = new Map<string, number>();
    f.ctx.on("session/event", (session, event) => {
      if (!steered && String(session.id) === failedVerifier && event.type === "turn/end" && event.data.reason.kind === "error") {
        steered = true;
        agent.steer(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Continue with the new human direction" }] }));
      }
    });
    f.adapter.handler = request => {
      const id = String(request.sessionId);
      if (id.startsWith("moa-builder-")) return rubric();
      if (id.startsWith("moa-verifier-")) {
        if (failedVerifier === undefined) {
          failedVerifier = id;
          throw new Error("Obsolete verifier failed at the arrival boundary");
        }
        const count = (verificationRequests.get(id) ?? 0) + 1;
        verificationRequests.set(id, count);
        if (count === 1) return call("read_rubric");
        if (count === 2) return call("read_candidate");
        return response('{"status":"Pass","issues":[]}');
      }
      parentRequests++;
      if (parentRequests > 2) agent.cancel({ kind: "user" });
      return response(parentRequests === 1 ? "123" : "The updated answer");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "123" }] }));
    await agent.whenIdle();
    const events = agent.session.snapshotEvents();
    expect(steered).toBe(true);
    expect(parentRequests).toBe(2);
    expect(events.some(event => event.type === "user/message" && event.data.source.kind === "user" && event.data.content.some(block => block.type === "text" && block.text === "Continue with the new human direction"))).toBe(true);
    expect(events.filter(event => event.type === "turn/end")).toMatchObject([{ data: { reason: { kind: "completed" } } }]);
    expect(events.some(event => event.type === "user/message" && event.data.source.kind === "moa-completion")).toBe(false);
    expect(agent.inbox.nextStep).toHaveLength(0);
  } finally { await f.dispose(); }
});
