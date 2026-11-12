import { expect, it, vi } from "vitest";
import { FsError } from "@deepseek-ai/dsh-fs";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage, type StreamChunk } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture, response } from "./fixture.ts";

const user = (body: string) => createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: body }] });
const call = (name: string): StreamChunk[] => [
  { type: "block-start", index: 0, blockType: "tool-call" },
  { type: "block-end", index: 0, block: { type: "tool-call", id: "mutate", name, arguments: "{}" } },
  { type: "finish", reason: { kind: "tool-calls" } },
];

it("freezes punctuated input lists and unique sibling references before edits, excluding declared deliveries", async () => {
  const f = await fixture(undefined, { completionVerification: "on-demand" });
  try {
    await mkdir(join(f.root, "inputs"));
    await mkdir(join(f.root, "outputs"));
    const originals = {
      "inputs/orders.csv": "id,amount\n1,20\n",
      "inputs/decision-rules.md": "ORIGINAL RULES",
      "inputs/policies.json": '{"retention":30}',
      "inputs/exceptions.json": "[]",
      "inputs/requests.json": '[{"id":"q1"}]',
      "source with spaces.md": "ORIGINAL LINKED SPEC",
    };
    for (const [path, content] of Object.entries(originals)) await writeFile(join(f.root, path), content);
    await writeFile(join(f.root, "outputs/result.json"), "OLD OUTPUT IS NOT AN INPUT SPEC");
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("source-reference-lists"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    f.ctx.tools.register(defineTool({
      name: "edit_source_after_admission", description: "Fixture implementation edit", parameters: {},
      output: { schema: { type: "string" }, render: (_, value: string) => [{ type: "text", text: value }] },
      async execute() {
        await writeFile(join(f.root, "inputs/decision-rules.md"), "IMPLEMENTATION MUST NOT REPLACE ORIGINAL");
        return "edited";
      },
    }));
    let step = 0;
    f.adapter.handler = () => ++step === 1 ? call("edit_source_after_admission") : response("done");
    agent.followup(user("请根据 inputs/orders.csv、inputs/decision-rules.md、policies.json、exceptions.json，为 requests.json 中的请求形成决策。交付 outputs/result.json、outputs/report.md。另参照 [规格](source with spaces.md)。缺失输入 missing.csv。"));
    await agent.whenIdle();
    const record = (f.ctx.projectMode as any).access.record(agent.id);
    const input = record.operations["moa:completion-input"];
    const sources = Object.fromEntries(Object.entries(input.sources).map(([path, content]) => [path.replaceAll("\\", "/"), content]));
    expect(sources).toEqual({ ...originals, "missing.csv": null });
    expect(input.sourceVersions).toHaveLength(7);
    expect(input.sourceVersions.every((source: { requirement: number }) => source.requirement === 1)).toBe(true);
    expect(JSON.stringify(input)).not.toContain("IMPLEMENTATION MUST NOT REPLACE");
    expect(JSON.stringify(input.sources)).not.toContain("outputs");
    expect(f.adapter.requests.some(request => String(request.sessionId).startsWith("moa-"))).toBe(false);
  } finally { await f.dispose(); }
});

it("keeps ambiguous bare source names unresolved and excludes quoted or linked write targets", async () => {
  const f = await fixture(undefined, { completionVerification: "on-demand" });
  try {
    await mkdir(join(f.root, "a"));
    await mkdir(join(f.root, "b"));
    for (const [path, content] of Object.entries({ "a/spec.md": "A", "b/spec.md": "B", "a/shared.json": "LEFT", "b/shared.json": "RIGHT" })) await writeFile(join(f.root, path), content);
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("source-reference-ambiguity"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    agent.followup(user('Use a/spec.md and b/spec.md with shared.json. Write "result.json" and "report.md". Save [summary](summary.md).'));
    await agent.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    const input = (f.ctx.projectMode as any).access.record(agent.id).operations["moa:completion-input"];
    expect(input.sources).toEqual({ "a/spec.md": "A", "b/spec.md": "B", "shared.json": null });
    expect(input.finished).toBe(true);
  } finally { await f.dispose(); }
});

it.each([
  "请生成 `inputs/policy.md` 的中文摘要，输出 `outputs/summary.md`。",
  "Create `inputs/policy.md`'s summary. Write `outputs/summary.md`.",
])("freezes the document being summarized before implementation (%s)", async request => {
  const f = await fixture(undefined, { completionVerification: "on-demand" });
  try {
    await mkdir(join(f.root, "inputs"));
    await mkdir(join(f.root, "outputs"));
    await writeFile(join(f.root, "inputs/policy.md"), "ORIGINAL POLICY TO SUMMARIZE");
    await writeFile(join(f.root, "outputs/summary.md"), "EXISTING OUTPUT MUST NOT BECOME A SPEC");
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("source-document-subject"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    f.ctx.tools.register(defineTool({
      name: "change_policy_after_admission", description: "Fixture implementation edit", parameters: {},
      output: { schema: { type: "string" }, render: (_, value: string) => [{ type: "text", text: value }] },
      async execute() {
        await writeFile(join(f.root, "inputs/policy.md"), "IMPLEMENTATION CHANGE");
        return "edited";
      },
    }));
    let step = 0;
    f.adapter.handler = () => ++step === 1 ? call("change_policy_after_admission") : response("done");
    agent.followup(user(request));
    await agent.whenIdle();
    const input = (f.ctx.projectMode as any).access.record(agent.id).operations["moa:completion-input"];
    expect(input.sources).toEqual({ "inputs/policy.md": "ORIGINAL POLICY TO SUMMARIZE" });
    expect(input.sourceVersions).toEqual([{ path: "inputs/policy.md", requirement: 1, content: "ORIGINAL POLICY TO SUMMARIZE" }]);
  } finally { await f.dispose(); }
});

it.each(["EACCES", "FS_PERMISSION_DENIED", "FS_IO_ERROR"])("does not replace an unreadable named source with an accessible sibling (%s)", async code => {
  const f = await fixture(undefined, { completionVerification: "on-demand" });
  try {
    await mkdir(join(f.root, "a"));
    await writeFile(join(f.root, "policy.json"), "ORIGINAL ROOT POLICY");
    await writeFile(join(f.root, "a/spec.md"), "RELATED SPEC");
    await writeFile(join(f.root, "a/policy.json"), "DIFFERENT SIBLING POLICY");
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("source-read-denied"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    const fs = f.ctx.get("agentPresets")?.serviceFor(agent, "fs") ?? agent.ctx.get("fs")!;
    const originalRead = fs.readText.bind(fs);
    const reads: string[] = [];
    vi.spyOn(fs, "readText").mockImplementation((target, signal) => {
      const path = fs.processPath(target);
      reads.push(path);
      if (path === join(f.root, "policy.json")) {
        if (code === "EACCES") throw Object.assign(new Error("permission denied"), { code });
        throw new FsError("source is unavailable", code as "FS_PERMISSION_DENIED" | "FS_IO_ERROR");
      }
      return originalRead(target, signal);
    });
    agent.followup(user("Read a/spec.md and policy.json."));
    await agent.whenIdle();
    const input = (f.ctx.projectMode as any).access.record(agent.id).operations["moa:completion-input"];
    expect(input.sources).toEqual({ "a/spec.md": "RELATED SPEC", "policy.json": null });
    expect(reads).not.toContain(join(f.root, "a/policy.json"));
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});
