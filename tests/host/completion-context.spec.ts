import { expect, it } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage, type GenerateOptions, type StreamChunk } from "@deepseek-ai/dsh-llm";
import Loader from "@deepseek-ai/cordis-plugin-loader";
import Presets from "@deepseek-ai/dsh-agent-preset-registry";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { recordSchema } from "../../packages/project-mode/src/host/state.ts";
import { fixture, response } from "./fixture.ts";

const prompt = (text: string) => createUserMessage({
  source: { kind: "user" }, content: [{ type: "text", text }],
});
function call(name: string, args: object = {}): StreamChunk[] {
  return [
    { type: "block-start", index: 0, blockType: "tool-call" },
    { type: "block-end", index: 0, block: { type: "tool-call", id: name, name, arguments: JSON.stringify(args) } },
    { type: "finish", reason: { kind: "tool-calls" } },
  ];
}
function readSavedTaskContext(request: GenerateOptions) {
  const source = request.messages.filter(message => message.source.kind === "runtime-context").at(-1)?.source;
  const section = source?.kind === "runtime-context"
    ? source.sections?.find(section => section.name === "project-mode:task")
    : undefined;
  expect(section, "the admitted native runtime context must carry the saved task").toBeDefined();
  expect(section!.text).toContain("Existing unfinished task");
  expect(section!.text).toContain("not a new human message");
  expect(section!.text).toContain("Progress notes");
  return JSON.parse(section!.text.slice(section!.text.lastIndexOf("\n") + 1));
}
function builderInput(request: GenerateOptions) {
  const body = request.messages.filter(message => message.source.kind === "user").at(-1)!.content
    .filter(block => block.type === "text").map(block => block.text).join("\n");
  return JSON.parse(body.slice(body.lastIndexOf("\n") + 1));
}

it.each([
  { complete: false, legacy: false },
  { complete: true, legacy: false },
  { complete: false, legacy: true },
])("restores one source body to Coordinator and Builder after native restart (%j)", async ({ complete, legacy }) => {
  let f = await fixture(undefined, { completionVerification: true, keepFiles: true });
  try {
    let { agent } = await f.ctx.agents.create({
      sessionId: SessionId(`completion-context-${complete}`), meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    const original = "Inspect this computer using `original spec.md`";
    await writeFile(join(f.root, "original spec.md"), "ORIGINAL HUMAN SOURCE SNAPSHOT");
    await writeFile(join(f.root, "notes.md"), "Old progress diagnosis: the plugin is broken. This is not a new human task.");
    f.ctx.on("agent/created", ({ agent: helper }) => {
      if (String(helper.id).startsWith("moa-builder-")) throw new Error("First pre-step helper setup failed");
    });
    agent.followup(prompt(original));
    await agent.whenIdle();
    const failed = agent.session.snapshotEvents();
    expect(failed.some(event => event.type === "agent/inbox/spliced" && event.data.inserted.some(message => message.source.kind === "user"))).toBe(true);
    expect(failed.some(event => event.type === "user/message" && event.data.source.kind === "user")).toBe(false);
    expect(failed.findLast(event => event.type === "turn/end")).toMatchObject({ data: { reason: { kind: "error", error: { message: "First pre-step helper setup failed" } } } });
    expect(f.adapter.requests).toHaveLength(0);
    const saved = recordSchema.parse(await f.ctx.storageDomain.get("project_mode")!.table("projects").get(agent.id));
    expect(saved.operations["moa:completion-input"]).toMatchObject({ requirements: [original], finished: false });
    if (legacy) {
      await (f.ctx.projectMode as any).access.update(agent.id, (record: typeof saved) => ({
        ...record,
        operations: { ...record.operations, "moa:completion-input": {
          ...record.operations["moa:completion-input"] as object, sourceVersions: [],
        } },
      }));
    }

    const root = f.root;
    await f.dispose();
    await writeFile(join(root, "original spec.md"), "CHANGED IMPLEMENTATION MUST NOT REPLACE THE SOURCE");
    f = await fixture(undefined, { root, completionVerification: true });
    const completePrompt = "The preset owns this complete system prompt.";
    if (complete) {
      f.ctx.baseUrl = new URL("./", import.meta.url).href;
      await f.ctx.plugin(Loader);
      f.ctx.loader.builtins["task-complete-prompt"] = {
        inject: ["systemPrompt"], apply(ctx) {
          ctx.systemPrompt.section({ name: "preset:complete", order: 0, complete: true, text: completePrompt });
          ctx.systemPrompt.suppressRuntimeContext();
        },
      };
      await f.ctx.plugin(Presets, { default: "complete" });
      await f.ctx.agentPresets.register({ id: "complete", plugins: [{ name: "cordis:task-complete-prompt" }] });
    }
    await f.ctx.projectMode.snapshot(agent.id);
    ({ agent } = await f.ctx.agents.resume({
      resumeSessionId: agent.id, agentOptions: { provider: "test", model: "test" },
      ...(complete ? { setup: async scope => { await f.ctx.agentPresets.mount(scope); } } : {}),
    }));
    const verification = new Map<string, number>();
    let expected = [original, "456"], parentSteps = 0;
    const builtInputs: unknown[] = [], admittedInputs: unknown[] = [];
    f.adapter.handler = request => {
      const id = String(request.sessionId);
      if (id.startsWith("moa-builder-")) {
        const input = builderInput(request);
        expect(input.requirements).toEqual(expected);
        if (expected[0] === original) {
          expect(JSON.stringify(input).split("ORIGINAL HUMAN SOURCE SNAPSHOT")).toHaveLength(2);
          expect(input.sources).toEqual({});
          expect(input.sourceVersions).toEqual([{ path: "original spec.md", requirement: legacy ? null : 1, content: "ORIGINAL HUMAN SOURCE SNAPSHOT" }]);
        }
        builtInputs.push(input);
        return call("moa_publish_checklist", { rubric: "- Satisfy the original human requirements", tests_required: false });
      }
      if (id.startsWith("moa-verifier-")) {
        const count = (verification.get(id) ?? 0) + 1;
        verification.set(id, count);
        if (count === 1) return call("moa_read_checklist");
        if (count === 2) return call("moa_read_delivery");
        return call("moa_submit_review", { status: "Pass", issues: [] });
      }
      const input = readSavedTaskContext(request);
      admittedInputs.push(input);
      expect(input.requirements).toEqual(expected);
      if (expected[0] === original) {
        expect(input.sources).toEqual({});
        expect(JSON.stringify(input).split("ORIGINAL HUMAN SOURCE SNAPSHOT")).toHaveLength(2);
        expect(input.sourceVersions).toEqual([{ path: "original spec.md", requirement: legacy ? null : 1, content: "ORIGINAL HUMAN SOURCE SNAPSHOT" }]);
      } else {
        expect(input.sources).toEqual({});
        expect(input.sourceVersions).toEqual([]);
      }
      if (complete) {
        expect(request.messages.filter(message => message.role === "system").flatMap(message => message.content).filter(block => block.type === "text").map(block => block.text).join("\n")).toBe(completePrompt);
      }
      if (++parentSteps === 1) return call("moa_review", { criteria: "Satisfy the original task", promise: "RESTORED TASK COMPLETE" });
      return response(expected[0] === original ? "RESTORED TASK COMPLETE" : "The next task is complete");
    };
    agent.followup(prompt("456"));
    await agent.whenIdle();
    readSavedTaskContext(f.adapter.requests.find(request => request.sessionId === agent.id)!);
    expect(parentSteps).toBe(2);
    expect(admittedInputs).toEqual([builtInputs[0], builtInputs[0]]);
    expect(agent.session.snapshotEvents().findLast(event => event.type === "turn/end")).toMatchObject({ data: { reason: { kind: "completed" } } });
    expect(agent.session.snapshotEvents().filter(event => event.type === "user/message" && event.data.source.kind === "user")).toHaveLength(1);
    const contexts = agent.session.snapshotEvents().filter(event => event.type === "user/message" && event.data.source.kind === "runtime-context");
    expect(contexts).toHaveLength(1);

    expected = ["Deliver the next independent report"];
    agent.followup(prompt(expected[0]));
    await agent.whenIdle();
    expect(parentSteps).toBe(3);
    expect(admittedInputs.at(-1)).toEqual(builtInputs[1]);
    expect(agent.session.snapshotEvents().findLast(event => event.type === "turn/end")).toMatchObject({ data: { reason: { kind: "completed" } } });
  } finally { await f.dispose(); }
});
