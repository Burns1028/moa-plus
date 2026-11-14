import { expect, it } from "vitest";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { createUserMessage, ReasoningEffortId, type StreamChunk } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { fixture, response } from "./fixture.ts";

function calls(...items: { name: string; args?: object }[]): StreamChunk[] {
  return [
    ...items.flatMap(({ name, args = {} }, index): StreamChunk[] => [
      { type: "block-start", index, blockType: "tool-call" },
      { type: "block-end", index, block: { type: "tool-call", id: `workflow-${index}`, name, arguments: JSON.stringify(args) } },
    ]),
    { type: "finish", reason: { kind: "tool-calls" } },
  ];
}

// Scripted responses test native assembly and submission boundaries. They do
// not choose a verdict from prompt strings or claim a model follows the policy.
it("assembles the ordered review workflow at high effort and concludes after a current tool-backed verdict", async () => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    f.adapter.resolveModel = async (provider, model) => ({ provider, id: model, name: model,
      reasoning: { efforts: ["off", "high"].map(id => ({ id: ReasoningEffortId(id), name: id })), defaultEffort: ReasoningEffortId("high") },
    });
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("verifier-workflow"), meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test", reasoningEffort: ReasoningEffortId("high") } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    const candidate = "The requested answer for this exact attempt.";
    let rootRequests = 0, verifierRequests = 0, verifier: Agent | undefined;
    f.ctx.on("agent/created", ({ agent: created }) => {
      if (String(created.id).startsWith("moa-verifier-")) verifier = created;
    });
    f.adapter.handler = request => {
      const id = String(request.sessionId);
      if (id.startsWith("moa-builder-")) return calls({ name: "moa_publish_checklist", args: {
        rubric: "- [human requirement 1] Deliver the requested answer in chat.", tests_required: false,
      } });
      if (id.startsWith("moa-verifier-")) {
        verifierRequests++;
        expect(request.reasoningEffort).toBe("high");
        if (verifierRequests === 1) {
          const instructions = request.messages.filter(message => message.source.kind === "moa-completion")
            .flatMap(message => message.content).filter(block => block.type === "text").map(block => block.text).join("\n");
          expect(instructions).toContain("Initial necessary checks need no prior failure");
          expect(instructions.indexOf("1. Read the authoritative rubric")).toBeGreaterThan(-1);
          expect(instructions.indexOf("3. Use each result")).toBeGreaterThan(instructions.indexOf("2. Turn each rubric obligation"));
          expect(instructions.indexOf("4. Once every rubric obligation")).toBeGreaterThan(instructions.indexOf("3. Use each result"));
          const names = request.tools?.map(tool => tool.name);
          expect(names).toEqual(expect.arrayContaining(["moa_read_checklist", "moa_read_delivery", "moa_submit_review"]));
          expect(names).not.toContain("moa_dispatch");
          return calls({ name: "moa_read_checklist" }, { name: "moa_read_delivery" });
        }
        expect(verifierRequests).toBe(2);
        const inspected = request.messages.filter(message => message.role === "tool")
          .flatMap(message => message.content).filter(block => block.type === "text").map(block => block.text);
        expect(inspected).toContain(candidate);
        expect(inspected.some(body => body.includes("[human requirement 1]"))).toBe(true);
        return calls({ name: "moa_submit_review", args: { status: "Pass", issues: [] } });
      }
      rootRequests++;
      return response(candidate);
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Give the requested answer in chat." }] }));
    await agent.whenIdle();
    expect(rootRequests).toBe(1);
    expect(verifierRequests).toBe(2);
    const events = verifier!.session.snapshotEvents();
    expect(events.filter(event => event.type === "tool/call").map(event => event.data.name))
      .toEqual(["moa_read_checklist", "moa_read_delivery", "moa_submit_review"]);
    expect(events.findLast(event => event.type === "turn/end")).toMatchObject({ data: { reason: { kind: "completed" } } });
    expect(agent.session.snapshotEvents().findLast(event => event.type === "turn/end"))
      .toMatchObject({ data: { reason: { kind: "completed" } } });
  } finally { await f.dispose(); }
});
