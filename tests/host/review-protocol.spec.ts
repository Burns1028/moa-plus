import { expect, it } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { assembleContextFor } from "@deepseek-ai/dsh-agent";
import { createUserMessage, ReasoningEffortId, type GenerateOptions, type StreamChunk } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture, response } from "./fixture.ts";

function batch(...calls: [string, object?][]): StreamChunk[] {
  return [...calls.flatMap(([name, args = {}], index): StreamChunk[] => [
    { type: "block-start", index, blockType: "tool-call" },
    { type: "block-end", index, block: { type: "tool-call", id: `protocol-${index}`, name, arguments: JSON.stringify(args) } },
  ]), { type: "finish", reason: { kind: "tool-calls" } }];
}
const pass: [string, object] = ["moa_submit_review", { status: "Pass", issues: [] }];
const reads: [string][] = [["moa_read_checklist"], ["moa_read_delivery"]];
function facts(request: GenerateOptions) {
  const section = request.messages.filter(message => message.source.kind === "runtime-context").at(-1)?.source;
  const body = section?.kind === "runtime-context" ? section.sections?.find(row => row.name === "project-mode:review-evidence")?.text : undefined;
  expect(body).toContain("not a verdict or proof that the rubric is satisfied");
  return JSON.parse(body!.split("\n").at(-1)!);
}
const requestText = (request: GenerateOptions) => request.messages.flatMap(message => message.content).filter(block => block.type === "text").map(block => block.text).join("\n");
async function setup(nativeExit = true) {
  const f = await fixture(undefined, { completionVerification: true });
  f.adapter.resolveModel = async (provider, model) => ({ provider, id: model, name: model,
    reasoning: { efforts: ["off", "high"].map(id => ({ id: ReasoningEffortId(id), name: id })), defaultEffort: ReasoningEffortId("high") } });
  f.ctx.tools.register(defineTool({ name: "pwsh", description: "Scripted native persistent shell projection", parameters: {},
    output: { schema: { type: "string" }, render: (_, value: string) => [{ type: "text", text: value }],
      ...(nativeExit ? { presentationMeta: () => ({ nativeShell: { kind: "pwsh", completed: true, exitCode: 0, signal: null, timedOut: false, aborted: false } }) } : {}) },
    execute: async () => "All tests passed [exit code: 0]" }));
  const { agent } = await f.ctx.agents.create({ sessionId: SessionId("review-protocol"), meta: { cwd: f.root },
    agentOptions: { provider: "test", model: "test", reasoningEffort: ReasoningEffortId("high") } });
  await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
  return { ...f, agent, send: () => agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Deliver the answer and run its required tests." }] })) };
}

it("checks the completed native batch, accepting submit-before-read-and-shell without an extra model step", async () => {
  const f = await setup();
  try {
    let roots = 0, reviews = 0;
    f.adapter.handler = request => {
      const id = String(request.sessionId);
      if (id.startsWith("moa-builder-")) {
        expect(requestText(request)).not.toContain("Host prerequisites recorded");
        return batch(["moa_publish_checklist", { rubric: "- Answer and required tests [human 1]", tests_required: true }]);
      }
      if (id.startsWith("moa-verifier-")) {
        expect(++reviews).toBe(1);
        expect(request.reasoningEffort).toBe("high");
        expect(facts(request)).toEqual({ rubricRead: false, inspectionRecorded: false, testsRequired: true, successfulNativeExecution: false, capabilityUnavailable: false });
        return batch(pass, ...reads, ["pwsh"]);
      }
      expect(requestText(request)).not.toContain("Host prerequisites recorded");
      roots++;
      return response("The frozen answer.");
    };
    f.send(); await f.agent.whenIdle();
    expect(roots).toBe(1); expect(reviews).toBe(1);
    expect(f.agent.session.snapshotEvents().findLast(event => event.type === "turn/end")).toMatchObject({ data: { reason: { kind: "completed" } } });
  } finally { await f.dispose(); }
});

it("repairs missing evidence and a missing verdict in the same candidate and native turn, without author rework", async () => {
  const f = await setup();
  try {
    let roots = 0, reviews = 0;
    f.adapter.handler = request => {
      const id = String(request.sessionId);
      if (id.startsWith("moa-builder-")) return batch(["moa_publish_checklist", { rubric: "- Answer and required tests [human 1]", tests_required: true }]);
      if (id.startsWith("moa-verifier-")) {
        const current = facts(request);
        switch (++reviews) {
          case 1: return batch(pass);
          case 2:
            expect(requestText(request)).toContain("Missing Host prerequisites");
            expect(current.rubricRead).toBe(false);
            return batch(...reads, ["pwsh"]);
          case 3:
            expect(current).toMatchObject({ rubricRead: true, inspectionRecorded: true, successfulNativeExecution: true });
            expect(requestText(request)).toContain("candidate 1");
            return response("Inspection is complete, but this is not a verdict.");
          case 4:
            expect(requestText(request)).toContain("valid JSON verdict");
            return response('Review complete.\n```json\n{"status":"Pass","issues":[]}\n```');
          default: throw new Error("Review should have closed after its fresh verdict");
        }
      }
      return response(`candidate ${++roots}`);
    };
    f.send(); await f.agent.whenIdle();
    expect(roots).toBe(1); expect(reviews).toBe(4);
    const verifier = f.ctx.agents.list().find(agent => String(agent.id).startsWith("moa-verifier-"))!;
    expect(verifier.session.snapshotEvents().filter(event => event.type === "turn/start")).toHaveLength(1);
    expect(verifier.session.snapshotEvents().filter(event => event.type === "turn/end")).toMatchObject([{ data: { reason: { kind: "completed" } } }]);
    expect(f.agent.session.snapshotEvents().some(event => event.type === "user/message" && event.data.source.kind === "moa-completion")).toBe(false);
  } finally { await f.dispose(); }
});

it("never accepts console-only execution, and Stop cancels protocol repair without author rework", async () => {
  const f = await setup(false);
  try {
    let roots = 0, reviews = 0;
    f.adapter.handler = request => {
      const id = String(request.sessionId);
      if (id.startsWith("moa-builder-")) return batch(["moa_publish_checklist", { rubric: "- Required tests [human 1]", tests_required: true }]);
      if (id.startsWith("moa-verifier-")) {
        if (++reviews === 1) return batch(...reads, ["pwsh"], pass);
        expect(facts(request)).toMatchObject({ rubricRead: true, inspectionRecorded: true, testsRequired: true, successfulNativeExecution: false });
        expect(requestText(request)).toContain("confirmed successful exit");
        f.agent.cancel({ kind: "user" });
        return batch(pass);
      }
      roots++; return response("candidate");
    };
    f.send(); await f.agent.whenIdle();
    expect(roots).toBe(1); expect(reviews).toBe(2);
    expect(f.agent.session.snapshotEvents().findLast(event => event.type === "turn/end")).toMatchObject({ data: { reason: { kind: "aborted" } } });
    const verifier = f.ctx.agents.list().find(agent => String(agent.id).startsWith("moa-verifier-"))!;
    const assembled = await verifier.ctx.systemPrompt.assemble(assembleContextFor(verifier));
    expect(assembled.contexts.find(row => row.name === "project-mode:review-evidence")?.text).toBe("");
  } finally { await f.dispose(); }
});

it.each(["Partial", "Block"] as const)("returns a concrete %s to the author even after native prerequisites are recorded", async status => {
  const f = await setup();
  try {
    let roots = 0;
    f.adapter.handler = request => {
      const id = String(request.sessionId);
      if (id.startsWith("moa-builder-")) return batch(["moa_publish_checklist", { rubric: "- Answer must contain conclusion [human 1]", tests_required: true }]);
      if (id.startsWith("moa-verifier-")) return batch(...reads, ["pwsh"], ["moa_submit_review", { status, issues: ["Human 1: required conclusion is missing from the candidate."] }]);
      if (++roots === 2) { expect(requestText(request)).toContain("required conclusion is missing"); f.agent.cancel({ kind: "user" }); }
      return response("candidate without conclusion");
    };
    f.send(); await f.agent.whenIdle(); expect(roots).toBe(2);
  } finally { await f.dispose(); }
});

it("resets facts for a changed candidate on the same Verifier rather than inheriting prior native success", async () => {
  const f = await setup();
  try {
    let roots = 0, reviews = 0;
    f.adapter.handler = request => {
      const id = String(request.sessionId);
      if (id.startsWith("moa-builder-")) return batch(["moa_publish_checklist", { rubric: "- Answer and tests [human 1]", tests_required: true }]);
      if (id.startsWith("moa-verifier-")) {
        if (++reviews === 1) return batch(...reads, ["pwsh"], ["moa_submit_review", { status: "Partial", issues: ["Missing conclusion"] }]);
        if (reviews === 2) {
          expect(facts(request)).toMatchObject({ rubricRead: false, inspectionRecorded: false, successfulNativeExecution: false });
          return batch(pass);
        }
        expect(reviews).toBe(3);
        expect(requestText(request)).toContain("Missing Host prerequisites");
        return batch(...reads, ["pwsh"], pass);
      }
      return response(`candidate ${++roots}`);
    };
    f.send(); await f.agent.whenIdle(); expect(roots).toBe(2); expect(reviews).toBe(3);
  } finally { await f.dispose(); }
});

it.each([
  { status: "Partial", issues: [], legacy: false },
  { status: "Block", issues: ["  ", "\n"], legacy: false },
  { status: "Partial", issues: [" "], legacy: true },
  { status: "Block", issues: [], legacy: true },
])("repairs a $status verdict without concrete issues within the Verifier (legacy=$legacy)", async ({ status, issues, legacy }) => {
  const f = await setup();
  try {
    let roots = 0, reviews = 0;
    f.adapter.handler = request => {
      const id = String(request.sessionId);
      if (id.startsWith("moa-builder-")) return batch(["moa_publish_checklist", { rubric: "- Answer and tests [human 1]", tests_required: true }]);
      if (id.startsWith("moa-verifier-")) {
        if (++reviews === 1) return legacy ? batch(...reads, ["pwsh"]) : batch(...reads, ["pwsh"], ["moa_submit_review", { status, issues }]);
        if (legacy && reviews === 2) return response(JSON.stringify({ status, issues }));
        expect(requestText(request)).toContain("needs a concrete anchored");
        expect(requestText(request)).toContain("Do not invent a defect");
        return batch(pass);
      }
      return response(`candidate ${++roots}`);
    };
    f.send(); await f.agent.whenIdle();
    expect(roots).toBe(1); expect(reviews).toBe(legacy ? 3 : 2);
    expect(f.agent.session.snapshotEvents().findLast(event => event.type === "turn/end")).toMatchObject({ data: { reason: { kind: "completed" } } });
  } finally { await f.dispose(); }
});

it.each(["superseded", "unavailable"])("keeps a failed %s rubric read on the parent republish path rather than trapping protocol repair", async reason => {
  const f = await setup();
  try {
    let roots = 0, builders = 0, reviews = 0;
    const verifierIds = new Set<string>();
    const rubricPath = join(f.root, "rubrics.md");
    f.adapter.handler = async request => {
      const id = String(request.sessionId);
      if (id.startsWith("moa-builder-")) { builders++; return batch(["moa_publish_checklist", { rubric: "- Original answer and tests [human 1]", tests_required: true }]); }
      if (id.startsWith("moa-verifier-")) {
        verifierIds.add(id);
        if (++reviews === 1) {
          if (reason === "superseded") await writeFile(rubricPath, "Another task's unrelated rubric");
          else await rm(rubricPath);
          return batch(["moa_read_checklist"], pass);
        }
        expect(reviews).toBe(2);
        expect(await readFile(rubricPath, "utf8")).toContain("Original answer and tests");
        expect(facts(request)).toMatchObject({ rubricRead: false, inspectionRecorded: false, successfulNativeExecution: false });
        return batch(...reads, ["pwsh"], pass);
      }
      if (++roots === 2) {
        expect(requestText(request)).toContain("Outcome verification blocked");
        if (reason === "superseded") expect(requestText(request)).toContain("Rubric superseded");
      }
      return response(`candidate ${roots}`);
    };
    f.send(); await f.agent.whenIdle();
    expect(roots).toBe(2); expect(builders).toBe(2); expect(reviews).toBe(2); expect(verifierIds.size).toBe(2);
    expect(f.agent.session.snapshotEvents().findLast(event => event.type === "turn/end")).toMatchObject({ data: { reason: { kind: "completed" } } });
  } finally { await f.dispose(); }
});
