import { expect, it } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage, type StreamChunk } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture, response } from "./fixture.ts";

const user = (body: string) => createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: body }] });
function call(name: string, args: object = {}): StreamChunk[] {
  const value = JSON.stringify(args);
  return [
    { type: "block-start", index: 0, blockType: "tool-call" },
    { type: "tool-call-delta", index: 0, id: "call", name, argumentsDelta: value },
    { type: "block-end", index: 0, block: { type: "tool-call", id: "call", name, arguments: value } },
    { type: "finish", reason: { kind: "tool-calls" } },
  ];
}
const rubric = () => call("submit_rubric", { rubric: "- Deliver the report in the final answer [human requirement]", tests_required: false });

it.each(["DELIVERABLE-ONLY-SECRET: the complete requested report", ""])("lets the Verifier inspect a frozen final-answer deliverable without Bash (%j)", async candidate => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-chat-deliverable"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let main = 0, verifier = 0;
    let inspected = false;
    let builderInput = "";
    let candidateResult: string | undefined;
    f.adapter.handler = options => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) { builderInput = JSON.stringify(options.messages); return rubric(); }
      if (id.startsWith("moa-verifier-")) {
        if (++verifier === 1) return call("read_rubric");
        if (verifier === 2) return call("read_candidate");
        const result = options.messages.findLast(message => message.role === "tool");
        inspected = result?.role === "tool" && !result.isError;
        candidateResult = result?.content.filter(block => block.type === "text").map(block => block.text).join("\n");
        return response(JSON.stringify({ status: inspected ? "Pass" : "Block", issues: inspected ? [] : ["Candidate unavailable"] }));
      }
      if (++main > 1) agent.cancel({ kind: "user" });
      return response(candidate);
    };
    agent.followup(user("Write the report directly in your final answer"));
    await agent.whenIdle();
    expect(inspected).toBe(true);
    expect(candidateResult).toBe(candidate);
    expect(main).toBe(1);
    expect(builderInput).not.toContain("DELIVERABLE-ONLY-SECRET");
    expect(agent.session.snapshotEvents().filter(event => event.type === "turn/end")).toMatchObject([{ data: { reason: { kind: "completed" } } }]);
  } finally { await f.dispose(); }
});

it("gives each rework attempt its own frozen candidate and requires new inspection", async () => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-chat-rework"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let main = 0, verifier = 0;
    const inspected: string[] = [];
    f.adapter.handler = options => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) return rubric();
      if (id.startsWith("moa-verifier-")) {
        if (++verifier % 3 === 1) return call("read_rubric");
        if (verifier % 3 === 2) return call("read_candidate");
        const result = options.messages.findLast(message => message.role === "tool");
        if (result?.role === "tool" && !result.isError) inspected.push(result.content.filter(block => block.type === "text").map(block => block.text).join("\n"));
        return response(JSON.stringify({ status: verifier === 3 ? "Partial" : "Pass", issues: verifier === 3 ? ["Add the conclusion"] : [] }));
      }
      if (++main > 2) agent.cancel({ kind: "user" });
      return response(main === 1 ? "FIRST CANDIDATE" : "REVISED CANDIDATE WITH CONCLUSION");
    };
    agent.followup(user("Write a complete report in the final answer"));
    await agent.whenIdle();
    expect(inspected).toEqual(["FIRST CANDIDATE", "REVISED CANDIDATE WITH CONCLUSION"]);
    expect(main).toBe(2);
  } finally { await f.dispose(); }
});

it.each([false, true])("versions an explicitly revised specification while preserving its original snapshot (legacy=%s)", async legacy => {
  const f = await fixture(undefined, { completionVerification: true });
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  try {
    await writeFile(join(f.root, "spec.md"), "INITIAL REQUIREMENT: RED");
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-spec-update"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    f.ctx.tools.register(defineTool({ name: "inspect_artifact", description: "Inspect", parameters: {}, output: { schema: { type: "string" }, render: (_, value: string) => [{ type: "text", text: value }] }, execute: async () => "inspected" }));
    const builders: string[] = [];
    const counts = new Map<string, number>();
    let first = true;
    f.adapter.handler = async options => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) { builders.push(JSON.stringify(options.messages)); return rubric(); }
      if (id.startsWith("moa-verifier-")) {
        if (first) { first = false; entered.resolve(); await release.promise; }
        const count = (counts.get(id) ?? 0) + 1; counts.set(id, count);
        if (count === 1) return call("read_rubric");
        if (count === 2) return call("inspect_artifact");
        return response('{"status":"Pass","issues":[]}');
      }
      return response("candidate");
    };
    agent.followup(user("Implement `spec.md`"));
    await entered.promise;
    if (legacy) {
      await (f.ctx.projectMode as any).access.update(agent.id, (record: any) => {
        const { sourceVersions: _versions, ...input } = record.operations["moa:completion-input"];
        return { ...record, operations: { ...record.operations, "moa:completion-input": input } };
      });
    }
    await writeFile(join(f.root, "spec.md"), "UPDATED REQUIREMENT: BLUE");
    agent.steer(user("I updated `spec.md`; use the revised specification for this task."));
    release.resolve();
    await agent.whenIdle();
    expect(builders).toHaveLength(2);
    expect(builders[1]).toContain("INITIAL REQUIREMENT: RED");
    expect(builders[1]).toContain("UPDATED REQUIREMENT: BLUE");
    const inputText = f.adapter.requests.filter(options => String(options.sessionId).startsWith("moa-builder-")).at(-1)!.messages.flatMap(message => message.content.filter(block => block.type === "text").map(block => block.text)).find(body => body.startsWith("Independently derive"))!;
    const input = JSON.parse(inputText.slice(inputText.lastIndexOf("\n") + 1));
    expect(input.sourceVersions).toEqual([
      { path: "spec.md", requirement: legacy ? null : 1, content: "INITIAL REQUIREMENT: RED" },
      { path: "spec.md", requirement: 2, content: "UPDATED REQUIREMENT: BLUE" },
    ]);
  } finally { release.resolve(); await f.dispose(); }
});

it("retains captured specifications across file changes and excludes internal notices from requirements", async () => {
  const f = await fixture(undefined, { completionVerification: true });
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  try {
    await writeFile(join(f.root, "spec.md"), "ORIGINAL HUMAN SPECIFICATION");
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-source-isolation"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    const builders: string[] = [];
    const counts = new Map<string, number>();
    let first = true;
    f.adapter.handler = async options => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) { builders.push(JSON.stringify(options.messages)); return rubric(); }
      if (id.startsWith("moa-verifier-")) {
        if (first) { first = false; entered.resolve(); await release.promise; }
        const count = (counts.get(id) ?? 0) + 1; counts.set(id, count);
        if (count === 1) return call("read_rubric");
        if (count === 2) return call("read_candidate");
        return response('{"status":"Pass","issues":[]}');
      }
      return response("candidate");
    };
    agent.followup(user("Implement `spec.md`"));
    await entered.promise;
    await writeFile(join(f.root, "spec.md"), "WORKER EDIT MUST NOT BECOME A REQUIREMENT");
    agent.steer(createUserMessage({ source: { kind: "moa-completion", form: "notice", summary: "Internal review" }, content: [{ type: "text", text: "INTERNAL NOTICE: use updated `spec.md`" }] }));
    agent.steer(user("Continue the current task"));
    release.resolve();
    await agent.whenIdle();
    expect(builders).toHaveLength(2);
    expect(builders[1]).toContain("ORIGINAL HUMAN SPECIFICATION");
    expect(builders[1]).not.toContain("WORKER EDIT MUST NOT");
    expect(builders[1]).not.toContain("INTERNAL NOTICE");
  } finally { release.resolve(); await f.dispose(); }
});

it("requires actual build or test evidence even after inspecting the candidate answer", async () => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-candidate-test-evidence"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let main = 0, verifier = 0;
    f.adapter.handler = options => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) return call("submit_rubric", { rubric: "- Run required tests [human requirement]", tests_required: true });
      if (id.startsWith("moa-verifier-")) {
        if (++verifier === 1) return call("read_rubric");
        if (verifier === 2) return call("read_candidate");
        return response('{"status":"Pass","issues":[]}');
      }
      if (++main === 2) agent.cancel({ kind: "user" });
      return response("All required tests passed, according to the author");
    };
    agent.followup(user("Run the required tests and report the result"));
    await agent.whenIdle();
    expect(main).toBe(2);
    expect(agent.session.snapshotEvents().some(event => event.type === "turn/end" && event.data.reason.kind === "completed")).toBe(false);
  } finally { await f.dispose(); }
});

it("protects Coordinator records from the hidden Verifier while retaining native inspection and artifact tools", async () => {
  const f = await fixture(undefined, { completionVerification: true });
  const entered = Promise.withResolvers<Agent>();
  const release = Promise.withResolvers<void>();
  try {
    await f.ctx.plugin(await import("@deepseek-ai/dsh-tool-fs"));
    if (["darwin", "linux"].includes(process.platform)) {
      await f.ctx.plugin((await import("@deepseek-ai/dsh-sandbox-local")).default);
      await f.ctx.plugin((await import("@deepseek-ai/dsh-subprocess-local")).default);
      await f.ctx.plugin((await import("@deepseek-ai/dsh-bash-sandbox")).default);
      await f.ctx.plugin(await import("@deepseek-ai/dsh-shell-env"));
      await f.ctx.plugin(await import("@deepseek-ai/dsh-tool-bash"), { promoteOnTimeout: false });
    }
    const { agent: parent } = await f.ctx.agents.create({ sessionId: SessionId("completion-memory-owner"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    const mode = await f.ctx.projectMode.setEnabled(parent.id, true, 0, "enable");
    const paths = mode.paths!;
    f.adapter.handler = async options => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) return rubric();
      if (id.startsWith("moa-verifier-")) {
        entered.resolve(f.ctx.agents.get(options.sessionId)!);
        await release.promise;
        return response('{"status":"Pass","issues":[]}');
      }
      return response("candidate");
    };
    parent.followup(user("Review the result"));
    const verifier = await entered.promise;
    let n = 0;
    const execute = (agent: Agent, name: string, args: object) => f.ctx.tools.execute({ agent, name, arguments: args, callId: `verifier-memory-${n++}` as any, signal: new AbortController().signal });
    for (const path of [paths.notes, paths.archived]) {
      expect(await execute(verifier, "write", { file_path: path, content: "VERIFIER MUST NOT OVERWRITE" })).toMatchObject({ isError: true, error: { info: { code: "FS_READ_ONLY_PATH" } } });
    }
    expect((await execute(verifier, "read", { file_path: paths.notes })).isError).toBe(false);
    const artifact = join(f.root, "verifier-artifact.txt");
    expect((await execute(verifier, "write", { file_path: artifact, content: "inspection artifact" })).isError).toBe(false);
    expect(await readFile(artifact, "utf8")).toBe("inspection artifact");
    if (["darwin", "linux"].includes(process.platform)) {
      const ordinary = await execute(verifier, "bash", { command: "printf 'verification works\\n'", description: "Check verifier execution", timeoutMs: 2000 });
      expect((ordinary.value as { exitCode: number }).exitCode, JSON.stringify(ordinary)).toBe(0);
      const denied = await execute(verifier, "bash", { command: `printf bad > '${paths.notes}'`, description: "Check record protection", timeoutMs: 2000 });
      expect((denied.value as { exitCode: number }).exitCode, JSON.stringify(denied)).not.toBe(0);
    }
    expect((await execute(parent, "write", { file_path: paths.notes, content: "Coordinator update" })).isError).toBe(false);
    expect(await readFile(paths.notes, "utf8")).toBe("Coordinator update");
    parent.cancel({ kind: "user" });
    release.resolve();
    await parent.whenIdle();
    expect(f.ctx.sandboxPolicy.resolve({ session: verifier.session }).readOnlyPaths).toContain(paths.notes);
    await f.plugin.dispose();
    expect(f.ctx.sandboxPolicy.resolve({ session: verifier.session }).readOnlyPaths).toBeUndefined();
  } finally { release.resolve(); await f.dispose(); }
});

it("keeps the Verifier's record protection until its native cancellation cleanup joins", async () => {
  const f = await fixture(undefined, { completionVerification: true });
  const started = Promise.withResolvers<Agent>();
  const aborted = Promise.withResolvers<void>();
  const cleanup = Promise.withResolvers<void>();
  try {
    const { agent: parent } = await f.ctx.agents.create({ sessionId: SessionId("completion-memory-drain-owner"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    const mode = await f.ctx.projectMode.setEnabled(parent.id, true, 0, "enable");
    f.ctx.tools.register(defineTool({
      name: "held_verifier_cleanup", description: "Hold the native resource cleanup", parameters: {},
      output: { schema: { type: "string" }, render: (_, value: string) => [{ type: "text", text: value }] },
      async execute(_args, exec) {
        started.resolve(exec.agent!);
        if (!exec.signal.aborted) await new Promise<void>(resolve => exec.signal.addEventListener("abort", () => resolve(), { once: true }));
        aborted.resolve();
        await cleanup.promise;
        expect(f.ctx.sandboxPolicy.resolve({ session: exec.agent!.session }).readOnlyPaths).toContain(mode.paths!.notes);
        return "joined";
      },
    }));
    f.adapter.handler = options => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) return rubric();
      if (id.startsWith("moa-verifier-")) return call("held_verifier_cleanup");
      return response("candidate");
    };
    parent.followup(user("Review the result"));
    const verifier = await started.promise;
    let disposed = false;
    const unloading = f.plugin.dispose().then(() => { disposed = true; });
    await aborted.promise;
    expect(disposed).toBe(false);
    expect(f.ctx.sandboxPolicy.resolve({ session: verifier.session }).readOnlyPaths).toContain(mode.paths!.notes);
    cleanup.resolve();
    await unloading;
    expect(f.ctx.sandboxPolicy.resolve({ session: verifier.session }).readOnlyPaths).toBeUndefined();
  } finally { cleanup.resolve(); await f.dispose(); }
});
