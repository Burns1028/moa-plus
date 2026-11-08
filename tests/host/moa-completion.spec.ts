import { expect, it } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage, type StreamChunk } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture, response } from "./fixture.ts";

function call(name: string, args: object): StreamChunk[] {
  const argumentsValue = JSON.stringify(args);
  return [
    { type: "block-start", index: 0, blockType: "tool-call" },
    { type: "tool-call-delta", index: 0, id: "call", name, argumentsDelta: argumentsValue },
    { type: "block-end", index: 0, block: { type: "tool-call", id: "call", name, arguments: argumentsValue } },
    { type: "finish", reason: { kind: "tool-calls" } },
  ];
}

it.each(["native", "ptc"])("inherits preset execution tools for the Verifier while keeping the Builder tool-free (parent=%s)", async (mode) => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    await f.ctx.plugin((await import("@deepseek-ai/dsh-subprocess-local")).default);
    await f.ctx.plugin((await import("@deepseek-ai/dsh-bash-local")).default, { timeoutMs: 2000 });
    await f.ctx.plugin(await import("@deepseek-ai/dsh-shell-env"));
    if (mode === "ptc") {
      await f.ctx.plugin((await import("@deepseek-ai/dsh-sandbox-policy")).default, { mode: "danger-full-access" });
      await f.ctx.plugin((await import("@deepseek-ai/dsh-sandbox-local")).default);
      await f.ctx.plugin((await import("@deepseek-ai/dsh-ptc-runtime-node")).default);
    }
    f.ctx.baseUrl = new URL("./", import.meta.url).href;
    await f.ctx.plugin((await import("@deepseek-ai/cordis-plugin-loader")).default);
    await f.ctx.plugin((await import("@deepseek-ai/dsh-agent-preset-registry")).default, { default: "standard" });
    await f.ctx.agentPresets.register({ id: "standard", plugins: [
      { name: "@deepseek-ai/dsh-tool-bash", config: { promoteOnTimeout: false } },
      { name: new URL("./fixtures/tool-presentation.mjs", import.meta.url).href, config: { mode } },
    ] });
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("completion-preset"), meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
      setup: async ctx => { await f.ctx.agentPresets.mount(ctx); },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    expect(f.ctx.tools.get("bash")).toBeUndefined();
    expect(f.ctx.tools.get("bash", agent)).toBeDefined();
    let main = 0, verifier = 0;
    let builderTools: string[] | undefined, verifierTools: string[] | undefined;
    f.adapter.handler = options => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) {
        builderTools = (options.tools ?? []).map(tool => tool.name);
        return response(JSON.stringify({ rubric: "- Run the requested command [human]", tests_required: true }));
      }
      if (id.startsWith("moa-verifier-")) {
        verifierTools = (options.tools ?? []).map(tool => tool.name);
        if (++verifier === 1) return call("read_rubric", {});
        if (verifier === 2) return call("bash", { description: "Verify artifact", command: "printf 'preset verifier works\\n'", timeoutMs: 2000 });
        return response('{"status":"Pass","issues":[]}');
      }
      if (++main > 1) { agent.cancel({ kind: "user" }); throw new Error("Preset verification failed"); }
      return response("Completed requested command");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Run the requested command" }] }));
    await agent.whenIdle();
    expect(builderTools).toEqual([]);
    expect(verifierTools).toEqual(expect.arrayContaining(["bash", "read_rubric"]));
    expect(verifierTools).not.toContain("Task");
    expect(main).toBe(1);
    expect(verifier).toBe(3);
    expect(agent.session.snapshotEvents().filter(event => event.type === "turn/end")).toMatchObject([{ data: { reason: { kind: "completed" } } }]);
  } finally { await f.dispose(); }
});

it("withdraws an answer missing its bound promise and verifies with an independent tool-backed helper", async () => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    f.ctx.tools.register(defineTool({ name: "inspect_artifact", description: "Inspect artifact", parameters: {}, output: { schema: { type: "string" }, render: (_, value: string) => [{ type: "text", text: value }] }, execute: async () => "inspected" }));
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-main"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    await writeFile(join(f.root, "spec.md"), "ORIGINAL SPECIFICATION");
    let main = 0, verifier = 0;
    f.adapter.handler = (options) => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) {
        const source = JSON.stringify(options.messages);
        expect(source).toContain("ORIGINAL SPECIFICATION");
        expect(source).not.toContain("MAIN OUTPUT SECRET");
        return response(JSON.stringify({ rubric: "- Original requirement: deliver report [spec.md: ORIGINAL SPECIFICATION]", tests_required: false }));
      }
      if (id.startsWith("moa-verifier-")) {
        if (++verifier === 1) return call("read_rubric", {});
        if (verifier === 2) return call("inspect_artifact", {});
        return response('{"status":"Pass","issues":[],"tests_required":false}');
      }
      if (++main === 1) return call("set_completion_criteria", { criteria: "deliver report", promise: "EXACT PROMISE" });
      if (main === 2) return response("MAIN OUTPUT SECRET");
      expect(JSON.stringify(options.messages)).toContain("exact completion promise is missing");
      return response("EXACT PROMISE");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Deliver report per spec.md" }] }));
    await agent.whenIdle();
    expect(main).toBe(3);
    expect(verifier).toBe(3);
    expect(agent.session.snapshotEvents().filter((e) => e.type === "turn/end")).toHaveLength(1);
  } finally { await f.dispose(); }
});

it("reworks a Partial verdict in the same native turn before a tool-backed Pass", async () => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    f.ctx.tools.register(defineTool({ name: "inspect_artifact", description: "Inspect artifact", parameters: {}, output: { schema: { type: "string" }, render: (_, value: string) => [{ type: "text", text: value }] }, execute: async () => "inspected" }));
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-rework"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let main = 0, verify = 0, built = 0;
    f.adapter.handler = (options) => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) { built++; expect(JSON.stringify(options.messages)).not.toContain("Missing conclusion"); return response(JSON.stringify({ rubric: "- Deliver a report [human request]", tests_required: false })); }
      if (id.startsWith("moa-verifier-")) {
        verify++;
        if (verify % 3 === 1) return call("read_rubric", {});
        if (verify % 3 === 2) return call("inspect_artifact", {});
        return response(verify === 3 ? '{"status":"Partial","issues":["Missing conclusion"],"tests_required":false}' : '{"status":"Pass","issues":[],"tests_required":false}');
      }
      main++;
      if (main === 2) expect(JSON.stringify(options.messages)).toContain("Missing conclusion");
      return response(main === 1 ? "First draft" : "Completed report");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Deliver a report" }] }));
    await agent.whenIdle();
    expect(main).toBe(2);
    expect(verify).toBe(6);
    expect(built).toBe(1);
    expect(agent.session.snapshotEvents().filter((e) => e.type === "turn/end")).toHaveLength(1);
  } finally { await f.dispose(); }
});

it("lets incoming human steering escape a waiting verifier before any final turn end", async () => {
  const f = await fixture(undefined, { completionVerification: true });
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const resumed = Promise.withResolvers<void>();
  try {
    f.ctx.tools.register(defineTool({ name: "inspect_artifact", description: "Inspect", parameters: {}, output: { schema: { type: "string" }, render: (_, value: string) => [{ type: "text", text: value }] }, execute: async () => "inspected" }));
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-interrupt"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let main = 0, verifier = 0;
    const counts = new Map<string, number>();
    f.adapter.handler = async (options) => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) return response(JSON.stringify({ rubric: "- Original request [human]", tests_required: false }));
      if (id.startsWith("moa-verifier-")) {
        if (++verifier === 1) { entered.resolve(); await release.promise; }
        const count = (counts.get(id) ?? 0) + 1; counts.set(id, count);
        if (count === 1) return call("read_rubric", {});
        if (count === 2) return call("inspect_artifact", {});
        return response('{"status":"Pass","issues":[],"tests_required":false}');
      }
      if (++main === 2) {
        expect(JSON.stringify(options.messages)).toContain("New direction");
        expect(agent.session.snapshotEvents().some((event) => event.type === "turn/end")).toBe(false);
        resumed.resolve();
      }
      return response("candidate");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Original request" }] }));
    await entered.promise;
    agent.steer(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "New direction" }] }));
    await Promise.race([resumed.promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("human input stalled")), 1000))]);
    release.resolve();
    await agent.whenIdle();
    expect(main).toBe(2);
  } finally { release.resolve(); await f.dispose(); }
});

it("rejects a self-declared Pass without actual tool work", async () => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-unsupported-pass"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let main = 0;
    f.adapter.handler = (options) => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) return response(JSON.stringify({ rubric: "- Deliver report [human]", tests_required: false }));
      if (id.startsWith("moa-verifier-")) return response('{"status":"Pass","issues":[],"tests_required":false}');
      if (++main === 2) {
        expect(JSON.stringify(options.messages)).toContain("Outcome verification did not pass");
        agent.cancel({ kind: "user" });
      }
      return response("candidate");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Deliver report" }] }));
    await agent.whenIdle();
    expect(main).toBe(2);
    expect(agent.session.snapshotEvents().filter((e) => e.type === "turn/end").some((e) => e.type === "turn/end" && e.data.reason.kind === "completed")).toBe(false);
  } finally { await f.dispose(); }
});

it("allows Stop while the verifier is waiting without committing completion", async () => {
  const f = await fixture(undefined, { completionVerification: true });
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  try {
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-stop"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    f.adapter.handler = async (options) => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) return response(JSON.stringify({ rubric: "- Deliver report [human]", tests_required: false }));
      if (id.startsWith("moa-verifier-")) { entered.resolve(); await release.promise; return response("late"); }
      return response("candidate");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Deliver report" }] }));
    await entered.promise;
    agent.cancel({ kind: "user" });
    await Promise.race([agent.whenIdle(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Stop stalled")), 1000))]);
    expect(agent.session.snapshotEvents().filter((e) => e.type === "turn/end").some((e) => e.type === "turn/end" && e.data.reason.kind === "completed")).toBe(false);
  } finally { release.resolve(); await f.dispose(); }
});

it("uses the independent rubric to reject a claimed Pass after a failed Bash test", async () => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    f.ctx.tools.register(defineTool({ name: "Bash", description: "Run a test", parameters: {}, output: { schema: { type: "string" }, render: (_, value: string) => [{ type: "text", text: value }] }, execute: async () => "failed\n[exit code: 1]" }));
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-failed-test"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let main = 0, verifier = 0;
    f.adapter.handler = (options) => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) return response(JSON.stringify({ rubric: "- Run the test [human request]", tests_required: true }));
      if (id.startsWith("moa-verifier-")) {
        if (++verifier === 1) return call("read_rubric", {});
        if (verifier === 2) return call("Bash", {});
        return response('{"status":"Pass","issues":[],"tests_required":false}');
      }
      if (++main === 2) {
        expect(JSON.stringify(options.messages)).toContain("Outcome verification did not pass");
        agent.cancel({ kind: "user" });
      }
      return response("candidate");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Run the test" }] }));
    await agent.whenIdle();
    expect(main).toBe(2);
  } finally { await f.dispose(); }
});

it("verifies the current task while explicit next-turn input stays queued", async () => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    f.ctx.tools.register(defineTool({ name: "inspect_artifact", description: "Inspect", parameters: {}, output: { schema: { type: "string" }, render: (_, value: string) => [{ type: "text", text: value }] }, execute: async () => "inspected" }));
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-queue"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let main = 0, verifications = 0;
    const counts = new Map<string, number>();
    f.adapter.handler = (options) => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) return response(JSON.stringify({ rubric: "- Requested deliverable [human]", tests_required: false }));
      if (id.startsWith("moa-verifier-")) {
        const count = (counts.get(id) ?? 0) + 1; counts.set(id, count);
        if (count === 1) { verifications++; expect(agent.session.snapshotEvents().filter((e) => e.type === "turn/end")).toHaveLength(verifications - 1); return call("read_rubric", {}); }
        if (count === 2) return call("inspect_artifact", {});
        return response('{"status":"Pass","issues":[]}');
      }
      if (++main === 1) agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Do a second task next" }] }));
      return response("delivered");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Do the first task" }] }));
    await agent.whenIdle();
    expect(main).toBe(2);
    expect(verifications).toBe(2);
    expect(agent.session.snapshotEvents().filter((e) => e.type === "turn/end")).toHaveLength(2);
  } finally { await f.dispose(); }
});

it("keeps original source snapshots and the bound promise across a stopped runtime restart", async () => {
  let f = await fixture(undefined, { completionVerification: true, keepFiles: true });
  try {
    let { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-restart"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    await writeFile(join(f.root, "original spec.md"), "ORIGINAL REQUIREMENT SNAPSHOT");
    let main = 0;
    f.adapter.handler = (options) => {
      if (String(options.sessionId).startsWith("moa-builder-")) return response(JSON.stringify({ rubric: "- Original requirement [source]", tests_required: false }));
      if (++main === 1) return call("set_completion_criteria", { criteria: "meet original requirement", promise: "PERSISTED PROMISE" });
      agent.cancel({ kind: "user" });
      return response("unfinished");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Complete the requirement in `original spec.md`" }] }));
    await agent.whenIdle();
    const root = f.root;
    await f.dispose();
    await writeFile(join(root, "original spec.md"), "REPLACED ARTIFACT MUST NOT BECOME ORIGINAL REQUIREMENT");
    f = await fixture(undefined, { root, completionVerification: true });
    f.ctx.tools.register(defineTool({ name: "inspect_artifact", description: "Inspect", parameters: {}, output: { schema: { type: "string" }, render: (_, value: string) => [{ type: "text", text: value }] }, execute: async () => "inspected" }));
    ({ agent } = await f.ctx.agents.resume({ resumeSessionId: agent.id, agentOptions: { provider: "test", model: "test" } }));
    let resumed = 0, verified = 0;
    f.adapter.handler = (options) => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) {
        const input = JSON.stringify(options.messages);
        expect(input).toContain("ORIGINAL REQUIREMENT SNAPSHOT");
        expect(input).not.toContain("REPLACED ARTIFACT MUST NOT");
        return response(JSON.stringify({ rubric: "- Original requirement [source]", tests_required: false }));
      }
      if (id.startsWith("moa-verifier-")) {
        if (++verified === 1) return call("read_rubric", {});
        if (verified === 2) return call("inspect_artifact", {});
        return response('{"status":"Pass","issues":[]}');
      }
      if (++resumed === 1) return response("candidate without promise");
      expect(JSON.stringify(options.messages)).toContain("PERSISTED PROMISE");
      return response("PERSISTED PROMISE");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Continue the stopped task" }] }));
    await agent.whenIdle();
    expect(resumed).toBe(2);
    expect(verified).toBe(3);
  } finally { await f.dispose(); }
});

it("clears a delivered task's promise before the next unrelated user task", async () => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    f.ctx.tools.register(defineTool({ name: "inspect_artifact", description: "Inspect", parameters: {}, output: { schema: { type: "string" }, render: (_, value: string) => [{ type: "text", text: value }] }, execute: async () => "inspected" }));
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-next-task"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let main = 0;
    const counts = new Map<string, number>();
    f.adapter.handler = (options) => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) return response(JSON.stringify({ rubric: "- Deliver task [human]", tests_required: false }));
      if (id.startsWith("moa-verifier-")) {
        const count = (counts.get(id) ?? 0) + 1; counts.set(id, count);
        if (count === 1) return call("read_rubric", {});
        if (count === 2) return call("inspect_artifact", {});
        return response('{"status":"Pass","issues":[]}');
      }
      if (++main === 1) {
        expect(options.tools.map(tool => tool.name)).toContain("set_completion_criteria");
        return call("set_completion_criteria", { criteria: "finish first", promise: "FIRST TASK PROMISE" });
      }
      return response(main === 2 ? "FIRST TASK PROMISE" : "SECOND TASK COMPLETE");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Do the first task" }] }));
    await agent.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Do an unrelated second task" }] }));
    await agent.whenIdle();
    expect(main).toBe(3);
  } finally { await f.dispose(); }
});

it("applies the bound promise to a Worker without spawning recursive outcome helpers", async () => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-worker-owner"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let work = 0;
    f.adapter.handler = (options) => {
      expect(String(options.sessionId)).not.toMatch(/^moa-(builder|verifier)-/);
      if (options.sessionId === agent.id) return response("Worker result reviewed");
      if (++work === 1) {
        expect(options.tools.map(tool => tool.name)).toContain("set_completion_criteria");
        return call("set_completion_criteria", { criteria: "deliver assigned result", promise: "WORKER PROMISE" });
      }
      if (work === 2) return response("candidate without promise");
      expect(JSON.stringify(options.messages)).toContain("exact completion promise is missing");
      return response("WORKER PROMISE");
    };
    const result = await f.ctx.projectMode.controlForAgent(agent, { action: "spawn", name: "promised-worker", task: "Deliver assigned result" }, "spawn-promised-worker", new AbortController().signal) as { workerId: ReturnType<typeof SessionId> };
    await f.ctx.agents.get(result.workerId)?.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    await agent.whenIdle();
    expect(work).toBe(3);
  } finally { await f.dispose(); }
});

it.each([false, true])("accepts actual native Bash success from canonical exit facts (promotion=%s)", async (promote) => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    await f.ctx.plugin((await import("@deepseek-ai/dsh-subprocess-local")).default);
    await f.ctx.plugin((await import("@deepseek-ai/dsh-bash-local")).default, { timeoutMs: promote ? 20 : 2000, maxTimeoutMs: 3000 });
    await f.ctx.plugin(await import("@deepseek-ai/dsh-shell-env"));
    await f.ctx.plugin(await import("@deepseek-ai/dsh-tool-bash"), { promoteOnTimeout: promote });
    await f.ctx.plugin(await import("@deepseek-ai/dsh-tool-jobs"));
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-real-bash"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let main = 0, verifier = 0;
    f.adapter.handler = (options) => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) return response(JSON.stringify({ rubric: "- Run the specified command [human]", tests_required: true }));
      if (id.startsWith("moa-verifier-")) {
        if (++verifier === 1) return call("read_rubric", {});
        if (verifier === 2) return call("bash", { command: `${promote ? "sleep 0.12; " : ""}printf 'background capability is tested\\n'`, description: "Run verification", timeoutMs: promote ? 20 : 2000 });
        if (promote && verifier === 3) return call("job_output", { job_id: f.ctx.jobs.list(SessionId(id))[0].id, wait: true, timeout_ms: 2000 });
        return response('{"status":"Pass","issues":[]}');
      }
      if (++main > 1) { agent.cancel({ kind: "user" }); throw new Error("Native exit zero was rejected"); }
      return response("delivered");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Run the specified command" }] }));
    await agent.whenIdle();
    expect(main).toBe(1);
    expect(verifier).toBe(promote ? 4 : 3);
    expect(agent.session.snapshotEvents().filter(event => event.type === "turn/end")).toMatchObject([{ data: { reason: { kind: "completed" } } }]);
  } finally { await f.dispose(); }
});

it("preserves original file-attachment specifications through native file projection and decoding", async () => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    const path = join(f.root, "uploaded original.md");
    const source = "ATTACHED ORIGINAL SPECIFICATION";
    await writeFile(path, source);
    // This fixture's admitted attachment maps to its immutable stored file;
    // native LLM request projection and the acting FS perform the real reads.
    f.ctx.provide("attachments", { fileHostPath: () => path } as any);
    const { AttachmentId } = await import("@deepseek-ai/dsh-attachment");
    f.ctx.tools.register(defineTool({ name: "inspect_artifact", description: "Inspect", parameters: {}, output: { schema: { type: "string" }, render: (_, value: string) => [{ type: "text", text: value }] }, execute: async () => "inspected" }));
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-attachment"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let built = 0, verifier = 0;
    f.adapter.handler = (options) => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) {
        built++;
        expect(JSON.stringify(options.messages)).toContain(source);
        expect(JSON.stringify(options.messages)).toContain("uploaded original.md");
        return response(JSON.stringify({ rubric: "- Implement attached original spec [attachment]", tests_required: false }));
      }
      if (id.startsWith("moa-verifier-")) {
        if (++verifier === 1) return call("read_rubric", {});
        if (verifier === 2) return call("inspect_artifact", {});
        return response('{"status":"Pass","issues":[]}');
      }
      return response("delivered");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Implement the attached specification" }, { type: "file", attachment: { attachmentId: AttachmentId("f".repeat(64)), name: "uploaded original.md", bytes: Buffer.byteLength(source) } }] }));
    await agent.whenIdle();
    expect(built).toBe(1);
    expect(verifier).toBe(3);
  } finally { await f.dispose(); }
});

it("rebuilds invalid Builder output from saved original requirements on the next completion attempt", async () => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    f.ctx.tools.register(defineTool({ name: "inspect_artifact", description: "Inspect", parameters: {}, output: { schema: { type: "string" }, render: (_, value: string) => [{ type: "text", text: value }] }, execute: async () => "inspected" }));
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-builder-recovery"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let built = 0, main = 0, verifier = 0;
    f.adapter.handler = (options) => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) {
        expect(JSON.stringify(options.messages)).toContain("ORIGINAL HUMAN REQUIREMENT");
        return response(++built === 1 ? "invalid JSON" : JSON.stringify({ rubric: "- Deliver original requirement [human]", tests_required: false }));
      }
      if (id.startsWith("moa-verifier-")) {
        if (++verifier === 1) return call("read_rubric", {});
        if (verifier === 2) return call("inspect_artifact", {});
        return response('{"status":"Pass","issues":[]}');
      }
      if (++main === 2) expect(JSON.stringify(options.messages)).toContain("Outcome verification blocked");
      if (main > 2) { agent.cancel({ kind: "user" }); throw new Error("verification did not recover"); }
      return response("delivered");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "ORIGINAL HUMAN REQUIREMENT" }] }));
    await agent.whenIdle();
    expect(built).toBe(2);
    expect(main).toBe(2);
    expect(verifier).toBe(3);
  } finally { await f.dispose(); }
});

it("does not accept another task's rubric after inspection and republishes its own on re-verification", async () => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    let inspected = 0;
    f.ctx.tools.register(defineTool({ name: "inspect_artifact", description: "Inspect", parameters: {}, output: { schema: { type: "string" }, render: (_, value: string) => [{ type: "text", text: value }] }, execute: async () => { if (++inspected === 1) await writeFile(join(f.root, "rubrics.md"), "UNRELATED PROJECT RUBRIC"); return "inspected"; } }));
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-rubric-generation"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let main = 0;
    const counts = new Map<string, number>();
    f.adapter.handler = (options) => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) return response(JSON.stringify({ rubric: "- Original task requirement [human]", tests_required: false }));
      if (id.startsWith("moa-verifier-")) {
        const count = (counts.get(id) ?? 0) + 1; counts.set(id, count);
        if (count === 1) return call("read_rubric", {});
        if (count === 2) return call("inspect_artifact", {});
        return response('{"status":"Pass","issues":[]}');
      }
      if (++main === 2) expect(JSON.stringify(options.messages)).toContain("Rubric superseded");
      if (main > 2) { agent.cancel({ kind: "user" }); throw new Error("own rubric not restored"); }
      return response("delivered");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Original task requirement" }] }));
    await agent.whenIdle();
    expect(main).toBe(2);
    expect(inspected).toBe(2);
  } finally { await f.dispose(); }
});
