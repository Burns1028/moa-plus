import { expect, it } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage, ReasoningEffortId, type StreamChunk } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { fixture, response } from "./fixture.ts";

const hasBash = spawnSync("bash", ["-c", "exit 0"], { stdio: "ignore", timeout: 2000 }).status === 0;
const hasNativePwsh = !!process.env.MOA_COMPAT_MODULES && spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-Command", "exit 0"], { stdio: "ignore", timeout: 3000 }).status === 0;

function call(name: string, args: object): StreamChunk[] {
  const argumentsValue = JSON.stringify(args);
  return [
    { type: "block-start", index: 0, blockType: "tool-call" },
    { type: "tool-call-delta", index: 0, id: "call", name, argumentsDelta: argumentsValue },
    { type: "block-end", index: 0, block: { type: "tool-call", id: "call", name, arguments: argumentsValue } },
    { type: "finish", reason: { kind: "tool-calls" } },
  ];
}

it.each([
  { efforts: ["off", "low", "high"], expected: "off" },
  { efforts: ["low", "high"], expected: "low" },
  { efforts: ["high"], expected: "high" },
  { efforts: undefined, expected: undefined },
])("uses the model's supported lightweight Builder effort without changing execution or verification ($expected)", async ({ efforts, expected }) => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    f.adapter.resolveModel = async (provider, model) => ({
      provider, id: model, name: model,
      ...(efforts ? { reasoning: { efforts: efforts.map(id => ({ id: ReasoningEffortId(id), name: id })), defaultEffort: ReasoningEffortId("high") } } : {}),
    });
    // The real Session Controller installs selection after setup. Exercise that
    // native request override, rather than only checking Agent creation options.
    f.ctx.on("agent/created", ({ agent }) => {
      installModelSelection(agent.ctx, {
        current: { provider: "test", model: "selected", ...(efforts ? { reasoningEffort: ReasoningEffortId("high") } : {}) },
        assembled: undefined,
      });
    });
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-builder-effort"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "initial" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let verifier = 0;
    f.adapter.handler = options => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) return call("moa_publish_checklist", { rubric: "- Deliver the report [human requirement]", tests_required: false });
      if (id.startsWith("moa-verifier-")) {
        if (++verifier === 1) return call("moa_read_checklist", {});
        if (verifier === 2) return call("moa_read_delivery", {});
        return response('{"status":"Pass","issues":[]}');
      }
      return response("The completed report");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Deliver the report" }] }));
    await agent.whenIdle();
    const builder = f.adapter.requests.filter(options => String(options.sessionId).startsWith("moa-builder-"));
    const execution = f.adapter.requests.filter(options => !String(options.sessionId).startsWith("moa-builder-"));
    expect(builder).toHaveLength(1);
    expect(builder[0]).toMatchObject({ provider: "test", model: "selected" });
    expect(builder[0].reasoningEffort).toBe(expected);
    expect(builder[0].maxTokens).toBeUndefined();
    expect(builder[0].tools?.map(tool => tool.name)).toEqual(["moa_publish_checklist"]);
    expect(execution).toHaveLength(4);
    for (const request of execution) {
      expect(request).toMatchObject({ provider: "test", model: "selected" });
      expect(request.reasoningEffort).toBe(efforts ? "high" : undefined);
    }
    expect(agent.session.snapshotEvents().filter(event => event.type === "turn/end")).toMatchObject([{ data: { reason: { kind: "completed" } } }]);
  } finally { await f.dispose(); }
});

it.skipIf(!hasBash).each(["native", "ptc"])("inherits preset execution tools for the Verifier while limiting the Builder to rubric submission (parent=%s)", async (mode) => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    await f.ctx.plugin((await import("@deepseek-ai/dsh-subprocess-local")).default);
    await f.ctx.plugin((await import("@deepseek-ai/dsh-sandbox-local")).default);
    await f.ctx.plugin((await import("@deepseek-ai/dsh-bash-sandbox")).default, { timeoutMs: 2000 });
    await f.ctx.plugin(await import("@deepseek-ai/dsh-shell-env"));
    if (mode === "ptc") {
      await f.ctx.plugin((await import("@deepseek-ai/dsh-ptc-runtime-node")).default);
    }
    f.ctx.baseUrl = new URL("./", import.meta.url).href;
    await f.ctx.plugin((await import("@deepseek-ai/cordis-plugin-loader")).default);
    await f.ctx.plugin((await import("@deepseek-ai/dsh-tool-subagent/model-selection-settings")).default, { enabled: false, allowedModels: [] });
    await f.ctx.plugin((await import("@deepseek-ai/dsh-agent-preset-registry")).default, { default: "standard" });
    await f.ctx.agentPresets.register({ id: "standard", plugins: [
      { name: "@deepseek-ai/dsh-tool-bash", config: { promoteOnTimeout: false } },
      // Standard registers this variant in each Agent's own scope after setup.
      { name: "@deepseek-ai/dsh-tool-subagent", config: { provider: "spawn", modelSelectionSettings: true } },
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
        return call("moa_publish_checklist", { rubric: "- Run the requested command [human]", tests_required: true });
      }
      if (id.startsWith("moa-verifier-")) {
        verifierTools = (options.tools ?? []).map(tool => tool.name);
        if (++verifier === 1) return call("moa_read_checklist", {});
        if (verifier === 2) return call("bash", { description: "Verify artifact", command: "printf 'preset verifier works\\n'", timeoutMs: 2000 });
        return response('{"status":"Pass","issues":[]}');
      }
      if (++main > 1) { agent.cancel({ kind: "user" }); throw new Error("Preset verification failed"); }
      return response("Completed requested command");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Run the requested command" }] }));
    await agent.whenIdle();
    expect(builderTools).toEqual(["moa_publish_checklist"]);
    expect(verifierTools).toEqual(expect.arrayContaining(["bash", "moa_read_checklist"]));
    expect(verifierTools).not.toContain("moa_dispatch");
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
        return call("moa_publish_checklist", { rubric: "- Original requirement: deliver report [spec.md: ORIGINAL SPECIFICATION]", tests_required: false });
      }
      if (id.startsWith("moa-verifier-")) {
        if (++verifier === 1) return call("moa_read_checklist", {});
        if (verifier === 2) return call("inspect_artifact", {});
        return response('{"status":"Pass","issues":[],"tests_required":false}');
      }
      if (++main === 1) return call("moa_review", { criteria: "deliver report", promise: "EXACT PROMISE" });
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

it.each(["legacy", "structured"])("reworks a Partial verdict in the same native turn before a tool-backed Pass (format=%s)", async format => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    f.ctx.tools.register(defineTool({ name: "inspect_artifact", description: "Inspect artifact", parameters: {}, output: { schema: { type: "string" }, render: (_, value: string) => [{ type: "text", text: value }] }, execute: async () => "inspected" }));
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-rework"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let main = 0, verify = 0, built = 0;
    f.adapter.handler = (options) => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) { built++; expect(JSON.stringify(options.messages)).not.toContain("Missing conclusion"); return call("moa_publish_checklist", { rubric: "- Deliver a report [human request]", tests_required: false }); }
      if (id.startsWith("moa-verifier-")) {
        verify++;
        if (verify % 3 === 1) return call("moa_read_checklist", {});
        if (verify % 3 === 2) return call("inspect_artifact", {});
        const verdict = { status: verify === 3 ? "Partial" : "Pass", issues: verify === 3 ? ["Missing conclusion"] : [] };
        return format === "structured" ? call("moa_submit_review", verdict) : response(JSON.stringify(verdict));
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

it("accepts a private structured verdict alongside prose without another model step or task rework", async () => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-structured-verdict"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let main = 0, verifier = 0;
    f.adapter.handler = options => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) return call("moa_publish_checklist", { rubric: "- Deliver the report [human]", tests_required: false });
      if (id.startsWith("moa-verifier-")) {
        if (++verifier === 1) {
          expect(options.tools?.find(tool => tool.name === "moa_submit_review")?.parameters).toMatchObject({ properties: { status: { enum: ["Pass", "Partial", "Block"] }, issues: { type: "array", items: { type: "string" } } } });
          return call("moa_read_checklist", {});
        }
        if (verifier === 2) return call("moa_read_delivery", {});
        if (verifier === 3) return [
          ...response('I inspected the complete report.\n{"status":"Block","issues":["Text is not the submitted verdict"]}').slice(0, -1),
          ...call("moa_submit_review", { status: "Pass", issues: [] }).map(chunk => "index" in chunk ? { ...chunk, index: 1 } : chunk),
        ];
        return response("Legacy fallback cannot parse this prose.");
      }
      expect(options.tools?.map(tool => tool.name)).not.toContain("moa_submit_review");
      if (++main > 1) agent.cancel({ kind: "user" });
      return response("The completed report");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Deliver the report" }] }));
    await agent.whenIdle();
    expect(main).toBe(1);
    expect(verifier).toBe(3);
    expect(agent.session.snapshotEvents().filter(event => event.type === "turn/end")).toMatchObject([{ data: { reason: { kind: "completed" } } }]);
  } finally { await f.dispose(); }
});

it.each([false, true])("still requires actual inspection and required tests after structured submission (tests=%s)", async testsRequired => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-structured-evidence"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let main = 0, verifier = 0;
    f.adapter.handler = options => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) return call("moa_publish_checklist", { rubric: "- Deliver and verify report [human]", tests_required: testsRequired });
      if (id.startsWith("moa-verifier-")) {
        if (++verifier === 1) return call("moa_read_checklist", {});
        if (testsRequired && verifier === 2) return call("moa_read_delivery", {});
        if (verifier === (testsRequired ? 3 : 2)) return call("moa_submit_review", { status: "Pass", issues: [] });
        expect(JSON.stringify(options.messages)).toContain("Missing Host prerequisites");
        agent.cancel({ kind: "user" });
        return response('{"status":"Pass","issues":[]}');
      }
      if (++main === 2) {
        expect(JSON.stringify(options.messages)).toContain("Verifier must read the rubric, inspect actual results using tools, and perform required tests");
        agent.cancel({ kind: "user" });
      }
      return response("candidate");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Deliver and verify report" }] }));
    await agent.whenIdle();
    expect(main).toBe(1);
    expect(agent.session.snapshotEvents().some(event => event.type === "turn/end" && event.data.reason.kind === "completed")).toBe(false);
  } finally { await f.dispose(); }
});

it("discards an unsupported structured Pass and requires a fresh verdict within the same review", async () => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-structured-attempts"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let main = 0, verifier = 0;
    f.adapter.handler = options => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) return call("moa_publish_checklist", { rubric: "- Deliver report [human]", tests_required: false });
      if (id.startsWith("moa-verifier-")) {
        verifier++;
        if (verifier === 3) expect(JSON.stringify(options.messages)).toContain("Missing Host prerequisites");
        if (verifier === 6) expect(JSON.stringify(options.messages)).toContain("valid JSON verdict");
        if ([1, 3, 6].includes(verifier)) return call("moa_read_checklist", {});
        if ([4, 7].includes(verifier)) return call("moa_read_delivery", {});
        if ([2, 8].includes(verifier)) return call("moa_submit_review", { status: "Pass", issues: [] });
        return response("This review ended without a submitted or JSON verdict.");
      }
      main++;
      if (main > 3) agent.cancel({ kind: "user" });
      return response(`candidate ${main}`);
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Deliver report" }] }));
    await agent.whenIdle();
    expect(main).toBe(1);
    expect(verifier).toBe(8);
    expect(agent.session.snapshotEvents().filter(event => event.type === "turn/end")).toMatchObject([{ data: { reason: { kind: "completed" } } }]);
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
      if (id.startsWith("moa-builder-")) return call("moa_publish_checklist", { rubric: "- Original request [human]", tests_required: false });
      if (id.startsWith("moa-verifier-")) {
        if (++verifier === 1) { entered.resolve(); await release.promise; }
        const count = (counts.get(id) ?? 0) + 1; counts.set(id, count);
        if (count === 1) return call("moa_read_checklist", {});
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

it.each(["plain", "fenced"])("rejects a self-declared Pass without actual tool work (verdict=%s)", async (format) => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-unsupported-pass"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let main = 0, verifier = 0;
    f.adapter.handler = (options) => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) return call("moa_publish_checklist", { rubric: "- Deliver report [human]", tests_required: false });
      if (id.startsWith("moa-verifier-")) {
        if (++verifier === 2) { expect(JSON.stringify(options.messages)).toContain("Missing Host prerequisites"); agent.cancel({ kind: "user" }); }
        return response(format === "plain" ? '{"status":"Pass","issues":[],"tests_required":false}' : 'Review complete.\n\n```json\n{"status":"Pass","issues":[]}\n```');
      }
      if (++main === 2) {
        expect(JSON.stringify(options.messages)).toContain("Outcome verification did not pass");
        agent.cancel({ kind: "user" });
      }
      return response("candidate");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Deliver report" }] }));
    await agent.whenIdle();
    expect(main).toBe(1);
    expect(agent.session.snapshotEvents().filter((e) => e.type === "turn/end").some((e) => e.type === "turn/end" && e.data.reason.kind === "completed")).toBe(false);
  } finally { await f.dispose(); }
});

it.each([
  ["malformed", 'Review complete.\n```json\n{"status":"Pass","issues":[]} trailing\n```', "valid JSON verdict"],
  ["ambiguous", '```json\n{"status":"Pass","issues":[]}\n```\nDifferent result:\n```json\n{"status":"Block","issues":["Not complete"]}\n```', "valid JSON verdict"],
  ["whole-fence JSON with code markers in an issue", '```json\n{"status":"Block","issues":["Fix ```bash npm test``` example"]}\n```', "Fix ```bash npm test``` example"],
])("preserves the specific failure reason for a %s verdict after actual inspection", async (format, body, reason) => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-verdict-format"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let main = 0, verifier = 0, notice = "";
    f.adapter.handler = options => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) return call("moa_publish_checklist", { rubric: "- Deliver the report [human requirement]", tests_required: false });
      if (id.startsWith("moa-verifier-")) {
        if (++verifier === 1) return call("moa_read_checklist", {});
        if (verifier === 2) return call("moa_read_delivery", {});
        if (verifier === 4) { notice = JSON.stringify(options.messages); agent.cancel({ kind: "user" }); }
        return response(body);
      }
      if (++main === 2) {
        notice = JSON.stringify(options.messages);
        agent.cancel({ kind: "user" });
      }
      return response("The completed report");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Deliver the report" }] }));
    await agent.whenIdle();
    expect(main).toBe(format.startsWith("whole-fence") ? 2 : 1);
    expect(verifier).toBe(format.startsWith("whole-fence") ? 3 : 4);
    expect(notice).toContain(reason);
    expect(notice).not.toContain("Verifier must read the rubric, inspect actual results using tools");
    expect(agent.session.snapshotEvents().some(event => event.type === "turn/end" && event.data.reason.kind === "completed")).toBe(false);
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
      if (id.startsWith("moa-builder-")) return call("moa_publish_checklist", { rubric: "- Deliver report [human]", tests_required: false });
      if (id.startsWith("moa-verifier-")) { entered.resolve(); await release.promise; return call("moa_submit_review", { status: "Pass", issues: [] }); }
      return response("candidate");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Deliver report" }] }));
    await entered.promise;
    agent.cancel({ kind: "user" });
    await Promise.race([agent.whenIdle(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Stop stalled")), 1000))]);
    expect(agent.session.snapshotEvents().filter((e) => e.type === "turn/end").some((e) => e.type === "turn/end" && e.data.reason.kind === "completed")).toBe(false);
  } finally { release.resolve(); await f.dispose(); }
});

it.each(["Bash", "pwsh"])("uses the independent rubric to reject a claimed Pass after console-only %s test output", async (name) => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    f.ctx.tools.register(defineTool({ name, description: "Run a test", parameters: {}, output: { schema: { type: "string" }, render: (_, value: string) => [{ type: "text", text: value }] }, execute: async () => "All tests passed\n[exit code: 0]" }));
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-failed-test"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let main = 0, verifier = 0;
    f.adapter.handler = (options) => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) return call("moa_publish_checklist", { rubric: "- Run the test [human request]", tests_required: true });
      if (id.startsWith("moa-verifier-")) {
        if (++verifier === 1) return call("moa_read_checklist", {});
        if (verifier === 2) return call(name, {});
        if (verifier === 4) { expect(JSON.stringify(options.messages)).toContain("confirmed successful exit"); agent.cancel({ kind: "user" }); }
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
    expect(main).toBe(1);
  } finally { await f.dispose(); }
});

const nativePwshExit = { kind: "pwsh", completed: true, exitCode: 0, signal: null, timedOut: false, aborted: false };
it.each([
  { label: "persistent native exit zero", nativeShell: nativePwshExit, pass: true },
  { label: "persistent unconfirmed completion", nativeShell: { ...nativePwshExit, completed: false }, pass: false },
  { label: "persistent nonzero exit", nativeShell: { ...nativePwshExit, exitCode: 7 }, pass: false },
  { label: "persistent timed-out command", nativeShell: { ...nativePwshExit, timedOut: true }, pass: false },
  { label: "persistent aborted command", nativeShell: { ...nativePwshExit, aborted: true }, pass: false },
  { label: "persistent killed shell", nativeShell: { ...nativePwshExit, signal: "SIGTERM" }, pass: false },
  { label: "exit metadata for a different shell kind", nativeShell: { ...nativePwshExit, kind: "bash" }, pass: false },
])("uses exact native PowerShell completion facts for $label", async ({ nativeShell, pass }) => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    f.ctx.tools.register(defineTool({
      name: "pwsh", description: "Native persistent PowerShell result projection", parameters: {},
      output: {
        schema: { type: "string" },
        render: (_args, value: string) => [{ type: "text", text: value }],
        presentationMeta: () => ({ nativeShell }),
      },
      // Identical console output proves nothing; only this dispatch's native
      // metadata may grant successful test evidence.
      execute: async () => "All tests passed\n[exit code: 0]",
    }));
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-pwsh-evidence"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let main = 0, verifier = 0;
    f.adapter.handler = options => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) return call("moa_publish_checklist", { rubric: "- Run required tests [human]", tests_required: true });
      if (id.startsWith("moa-verifier-")) {
        if (++verifier === 1) return call("moa_read_checklist", {});
        if (verifier === 2) return call("pwsh", {});
        if (!pass && verifier === 4) { expect(JSON.stringify(options.messages)).toContain("confirmed successful exit"); agent.cancel({ kind: "user" }); }
        return response('{"status":"Pass","issues":[]}');
      }
      if (++main > 1) {
        expect(JSON.stringify(options.messages)).toContain("Outcome verification did not pass");
        agent.cancel({ kind: "user" });
      }
      return response("candidate");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Run the required tests" }] }));
    await agent.whenIdle();
    expect(main).toBe(1);
    expect(agent.session.snapshotEvents().some(event => event.type === "turn/end" && event.data.reason.kind === "completed")).toBe(pass);
  } finally { await f.dispose(); }
});

it.skipIf(!hasNativePwsh).each([0, 7])("verifies foreground evidence produced by the native rc2 PowerShell tool (exit=%s)", async exitCode => {
  const modules = process.env.MOA_COMPAT_MODULES!;
  const nativeRequire = createRequire(pathToFileURL(join(modules, "../package.json")));
  const native = async (name: string) => import(/* @vite-ignore */ pathToFileURL(nativeRequire.resolve(name)).href);
  const [{ Context }, kit, { default: Subprocess }, { default: Pwsh }, shellEnv, pwshTool] = await Promise.all([
    native("@deepseek-ai/cordis"), native("@deepseek-ai/dsh-agent-loop-testkit"),
    native("@deepseek-ai/dsh-subprocess-local"), native("@deepseek-ai/dsh-pwsh-local"),
    native("@deepseek-ai/dsh-shell-env"), native("@deepseek-ai/dsh-tool-pwsh"),
  ]);
  // Generate the evidence through an ordinary native runtime with no personal
  // profile. The host fixture then exercises completion gating on that exact
  // canonical DTO; record-ownership enforcement has its own native tests.
  const proof = new Context();
  const f = await fixture(undefined, { completionVerification: true });
  let nativeResult: unknown;
  try {
    await kit.mountAgentLoopTestDependencies(proof, { workingDirectory: true });
    await proof.plugin(Subprocess);
    await proof.plugin(Pwsh);
    await proof.plugin(shellEnv);
    await proof.plugin(pwshTool, { enableRunInBackground: false });
    f.ctx.tools.register(defineTool({
      name: "pwsh", description: "Run the required test with the native PowerShell tool", parameters: {},
      output: { schema: { type: "json" }, render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }] },
      execute: async () => {
        const batch = await proof.tools.execute({ calls: [{ id: "native-pwsh-proof", name: "pwsh", arguments: JSON.stringify({ command: `[Console]::WriteLine('All tests passed [exit code: 0]'); exit ${exitCode}`, description: "Check native exit evidence", workdir: f.root, timeoutMs: 5000 }) }], signal: new AbortController().signal });
        const result = batch.results[0].result;
        nativeResult = result;
        expect(result.isError, JSON.stringify(result)).toBe(false);
        expect(result.value).toMatchObject({ kind: "foreground", exitCode, signal: null, timedOut: false, aborted: false });
        return result.value;
      },
    }));
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-native-pwsh-proof"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let main = 0, verifier = 0;
    f.adapter.handler = options => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) return call("moa_publish_checklist", { rubric: "- Run required tests [human]", tests_required: true });
      if (id.startsWith("moa-verifier-")) {
        if (++verifier === 1) return call("moa_read_checklist", {});
        if (verifier === 2) return call("pwsh", {});
        return response('{"status":"Pass","issues":[]}');
      }
      if (++main > 1) agent.cancel({ kind: "user" });
      return response("candidate");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Run the required tests" }] }));
    await agent.whenIdle();
    expect(main, JSON.stringify(nativeResult)).toBe(exitCode === 0 ? 1 : 2);
  } finally { await proof.fiber.dispose(); await f.dispose(); }
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
      if (id.startsWith("moa-builder-")) return call("moa_publish_checklist", { rubric: "- Requested deliverable [human]", tests_required: false });
      if (id.startsWith("moa-verifier-")) {
        const count = (counts.get(id) ?? 0) + 1; counts.set(id, count);
        if (count === 1) { verifications++; expect(agent.session.snapshotEvents().filter((e) => e.type === "turn/end")).toHaveLength(verifications - 1); return call("moa_read_checklist", {}); }
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
      if (String(options.sessionId).startsWith("moa-builder-")) return call("moa_publish_checklist", { rubric: "- Original requirement [source]", tests_required: false });
      if (++main === 1) return call("moa_review", { criteria: "meet original requirement", promise: "PERSISTED PROMISE" });
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
        return call("moa_publish_checklist", { rubric: "- Original requirement [source]", tests_required: false });
      }
      if (id.startsWith("moa-verifier-")) {
        if (++verified === 1) return call("moa_read_checklist", {});
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
      if (id.startsWith("moa-builder-")) return call("moa_publish_checklist", { rubric: "- Deliver task [human]", tests_required: false });
      if (id.startsWith("moa-verifier-")) {
        const count = (counts.get(id) ?? 0) + 1; counts.set(id, count);
        if (count === 1) return call("moa_read_checklist", {});
        if (count === 2) return call("inspect_artifact", {});
        return response('{"status":"Pass","issues":[]}');
      }
      if (++main === 1) {
        expect(options.tools.map(tool => tool.name)).toContain("moa_review");
        return call("moa_review", { criteria: "finish first", promise: "FIRST TASK PROMISE" });
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
        expect(options.tools.map(tool => tool.name)).toContain("moa_review");
        return call("moa_review", { criteria: "deliver assigned result", promise: "WORKER PROMISE" });
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

it.skipIf(!hasBash).each([
  { promote: false, format: "plain" },
  { promote: true, format: "plain" },
  { promote: true, format: "fenced" },
  { promote: false, format: "structured" },
  { promote: true, format: "structured" },
])("accepts actual native Bash success from canonical exit facts (promotion=$promote, verdict=$format)", async ({ promote, format }) => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    await f.ctx.plugin((await import("@deepseek-ai/dsh-subprocess-local")).default);
    await f.ctx.plugin((await import("@deepseek-ai/dsh-sandbox-local")).default);
    await f.ctx.plugin((await import("@deepseek-ai/dsh-bash-sandbox")).default, { timeoutMs: promote ? 20 : 2000, maxTimeoutMs: 3000 });
    await f.ctx.plugin(await import("@deepseek-ai/dsh-shell-env"));
    await f.ctx.plugin(await import("@deepseek-ai/dsh-tool-bash"), { promoteOnTimeout: promote });
    await f.ctx.plugin(await import("@deepseek-ai/dsh-tool-jobs"));
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-real-bash"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let main = 0, verifier = 0;
    f.adapter.handler = (options) => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) return call("moa_publish_checklist", { rubric: "- Run the specified command [human]", tests_required: true });
      if (id.startsWith("moa-verifier-")) {
        if (++verifier === 1) return call("moa_read_checklist", {});
        if (verifier === 2) return call("bash", { command: `${promote ? "sleep 0.12; " : ""}printf 'background capability is tested\\n'`, description: "Run verification", timeoutMs: promote ? 20 : 2000 });
        if (promote && verifier === 3) return call("job_output", { job_id: f.ctx.jobs.list(SessionId(id))[0].id, wait: true, timeout_ms: 2000 });
        if (format === "structured") return call("moa_submit_review", { status: "Pass", issues: [] });
        return response(format === "plain" ? '{"status":"Pass","issues":[]}' : 'I verified the candidate and ran the required command successfully.\n\n```json\n{"status":"Pass","issues":[]}\n```\nReady for delivery.');
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
        return call("moa_publish_checklist", { rubric: "- Implement attached original spec [attachment]", tests_required: false });
      }
      if (id.startsWith("moa-verifier-")) {
        if (++verifier === 1) return call("moa_read_checklist", {});
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
        return ++built === 1 ? response("invalid JSON") : call("moa_publish_checklist", { rubric: "- Deliver original requirement [human]", tests_required: false });
      }
      if (id.startsWith("moa-verifier-")) {
        if (++verifier === 1) return call("moa_read_checklist", {});
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
      if (id.startsWith("moa-builder-")) return call("moa_publish_checklist", { rubric: "- Original task requirement [human]", tests_required: false });
      if (id.startsWith("moa-verifier-")) {
        const count = (counts.get(id) ?? 0) + 1; counts.set(id, count);
        if (count === 1) return call("moa_read_checklist", {});
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

it("accepts a rubric through the Builder's sole native submission capability", async () => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    f.ctx.tools.register(defineTool({ name: "inspect_artifact", description: "Inspect", parameters: {}, output: { schema: { type: "string" }, render: (_, value: string) => [{ type: "text", text: value }] }, execute: async () => "inspected" }));
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-submission"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let builder = 0, main = 0, verifier = 0;
    let builderTools: string[] = [];
    f.adapter.handler = options => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) {
        builderTools = (options.tools ?? []).map(tool => tool.name);
        return ++builder === 1 ? call("moa_publish_checklist", { rubric: "- Deliver report [human: Deliver a report]", tests_required: false }) : response("No submission capability");
      }
      if (id.startsWith("moa-verifier-")) {
        if (++verifier === 1) return call("moa_read_checklist", {});
        if (verifier === 2) return call("inspect_artifact", {});
        return response('{"status":"Pass","issues":[]}');
      }
      if (++main > 1) agent.cancel({ kind: "user" });
      return response("Completed report");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Deliver a report" }] }));
    await agent.whenIdle();
    expect(builderTools).toEqual(["moa_publish_checklist"]);
    expect(builder).toBe(1);
    expect(main).toBe(1);
    expect(verifier).toBe(3);
  } finally { await f.dispose(); }
});

it.each([
  ["DSML tool-looking text", "\n\n<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name=\"bash\">python3 -c 'import json'</｜｜DSML｜｜ invoke>\n</｜｜DSML｜｜ calls>"],
  ["unsubmitted JSON", '{"rubric":"unvalidated text","tests_required":false}'],
])("does not accept %s as an authoritative rubric", async (_label, body) => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-no-submission"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let main = 0, verifier = 0;
    f.adapter.handler = options => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) return response(body);
      if (id.startsWith("moa-verifier-")) { verifier++; return response('{"status":"Pass","issues":[]}'); }
      if (++main === 2) {
        expect(JSON.stringify(options.messages)).toContain("without a validated moa_publish_checklist call");
        agent.cancel({ kind: "user" });
      }
      return response("candidate");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Deliver report" }] }));
    await agent.whenIdle();
    expect(main).toBe(2);
    expect(verifier).toBe(0);
    expect(agent.session.snapshotEvents().some(event => event.type === "turn/end" && event.data.reason.kind === "completed")).toBe(false);
  } finally { await f.dispose(); }
});

it("returns invalid rubric arguments as a native tool error before accepting a corrected submission", async () => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    f.ctx.tools.register(defineTool({ name: "inspect_artifact", description: "Inspect", parameters: {}, output: { schema: { type: "string" }, render: (_, value: string) => [{ type: "text", text: value }] }, execute: async () => "inspected" }));
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("completion-validated-submission"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let builder = 0, main = 0, verifier = 0;
    f.adapter.handler = options => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) {
        if (++builder === 1) return call("moa_publish_checklist", { rubric: "", tests_required: "false" });
        const result = options.messages.findLast(message => message.role === "tool");
        expect(result?.role === "tool" && result.isError).toBe(true);
        return call("moa_publish_checklist", { rubric: "- Deliver report [human: Deliver report]", tests_required: false });
      }
      if (id.startsWith("moa-verifier-")) {
        if (++verifier === 1) return call("moa_read_checklist", {});
        if (verifier === 2) return call("inspect_artifact", {});
        return response('{"status":"Pass","issues":[]}');
      }
      if (++main > 1) agent.cancel({ kind: "user" });
      return response("delivered");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Deliver report" }] }));
    await agent.whenIdle();
    expect(builder).toBe(2);
    expect(main).toBe(1);
    expect(verifier).toBe(3);
  } finally { await f.dispose(); }
});
