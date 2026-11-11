import { expect, it } from "vitest";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { SessionId } from "@deepseek-ai/dsh-session";
import { ReadOnlyPathUnsupportedError } from "@deepseek-ai/dsh-sandbox";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { createUserMessage, type StreamChunk } from "@deepseek-ai/dsh-llm";
import { fixture, response } from "./fixture.ts";

function rubric(testsRequired = false): StreamChunk[] {
  return [
    { type: "block-start", index: 0, blockType: "tool-call" },
    { type: "block-end", index: 0, block: { type: "tool-call", id: "rubric", name: "submit_rubric", arguments: JSON.stringify({ rubric: "- Reply to the user's message", tests_required: testsRequired }) } },
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

it.each([false, true])("ends review and releases native helper resources when record protection is unsupported (tests required=%s)", async testsRequired => {
  const f = await fixture(undefined, { completionVerification: true });
  let verifierAgent: Agent | undefined, released = false;
  try {
    f.ctx.tools.register(defineTool({
      name: "pwsh", description: "Native shell capability boundary", parameters: {},
      output: { schema: { type: "string" }, render: (_args, value: string) => [{ type: "text", text: value }] },
      execute: async () => { throw new ReadOnlyPathUnsupportedError("fixture backend cannot protect Coordinator records"); },
    }));
    f.ctx.on("agent/created", ({ agent }) => {
      if (!String(agent.id).startsWith("moa-verifier-")) return;
      verifierAgent = agent;
      agent.ctx.effect(() => () => { released = true; }, "fixture verifier resource");
    });
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId(`unsupported-shell-${testsRequired}`), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let parentRequests = 0, verifierRequests = 0;
    f.adapter.handler = request => {
      const id = String(request.sessionId);
      if (id.startsWith("moa-builder-")) return rubric(testsRequired);
      if (id.startsWith("moa-verifier-")) {
        if (++verifierRequests === 1) return call("read_rubric");
        if (verifierRequests === 2) return call("pwsh");
        return call("submit_verdict", { status: "Pass", issues: [] });
      }
      if (++parentRequests > 1) agent.cancel({ kind: "user" });
      return response("123");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "123" }] }));
    await agent.whenIdle();
    expect(parentRequests).toBe(1);
    expect(verifierRequests).toBe(2);
    const events = agent.session.snapshotEvents();
    expect(events.findLast(event => event.type === "turn/end")).toMatchObject({ data: { reason: { kind: "error", error: { message: expect.stringContaining("fixture backend cannot protect Coordinator records") } } } });
    expect(events.some(event => event.type === "user/message" && event.data.source.kind === "moa-completion")).toBe(false);
    expect(verifierAgent?.session.snapshotEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "tool/result", data: expect.objectContaining({ error: { name: "ReadOnlyPathUnsupportedError", code: "READ_ONLY_PATH_UNSUPPORTED" }, message: expect.objectContaining({ isError: true }) }) }),
    ]));
    await expect.poll(() => ({
      released,
      agentRetained: f.ctx.agents.get(verifierAgent!.id) !== undefined,
      sessionRetained: f.ctx.sessions.get(verifierAgent!.id) !== undefined,
      readOnlyPaths: f.ctx.sandboxPolicy.resolve({ session: verifierAgent!.session }).readOnlyPaths ?? [],
    })).toEqual({ released: true, agentRetained: false, sessionRetained: false, readOnlyPaths: [] });
  } finally { await f.dispose(); }
});

it.each(["nonzero exit", "code in console text"])("keeps ordinary shell outcomes recoverable: %s", async outcome => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    let shellCalls = 0;
    f.ctx.tools.register(defineTool({
      name: "pwsh", description: "Native persistent shell result", parameters: {},
      output: {
        schema: { type: "string" },
        render: (_args, value: string) => [{ type: "text", text: value }],
        presentationMeta: () => ({ nativeShell: { kind: "pwsh", completed: true, exitCode: outcome === "nonzero exit" && shellCalls === 1 ? 7 : 0, signal: null, timedOut: false, aborted: false } }),
      },
      execute: async () => { shellCalls++; return outcome === "code in console text" ? "READ_ONLY_PATH_UNSUPPORTED is sample command output" : "The first test failed; a later test passes"; },
    }));
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId(`ordinary-shell-${outcome}`), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let parentRequests = 0, verifierRequests = 0;
    f.adapter.handler = request => {
      const id = String(request.sessionId);
      if (id.startsWith("moa-builder-")) return rubric(true);
      if (id.startsWith("moa-verifier-")) {
        if (++verifierRequests === 1) return call("read_rubric");
        if (verifierRequests <= 3) return call("pwsh");
        return call("submit_verdict", { status: "Pass", issues: [] });
      }
      if (++parentRequests > 1) agent.cancel({ kind: "user" });
      return response("123");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "123" }] }));
    await agent.whenIdle();
    expect(parentRequests).toBe(1);
    expect(verifierRequests).toBe(4);
    expect(shellCalls).toBe(2);
    expect(agent.session.snapshotEvents().findLast(event => event.type === "turn/end")).toMatchObject({ data: { reason: { kind: "completed" } } });
  } finally { await f.dispose(); }
});

it.each(["stop", "new human input"])("preserves %s at an unsupported-tool helper's native turn-end boundary", async action => {
  const f = await fixture(undefined, { completionVerification: true });
  try {
    let failedVerifier: Agent | undefined, acted = false;
    const releasedVerifiers = new Set<string>();
    f.ctx.on("agent/created", ({ agent }) => {
      if (String(agent.id).startsWith("moa-verifier-"))
        agent.ctx.effect(() => () => { releasedVerifiers.add(String(agent.id)); }, "fixture verifier resource");
    });
    f.ctx.tools.register(defineTool({
      name: "pwsh", description: "Native shell capability boundary", parameters: {},
      output: { schema: { type: "string" }, render: (_args, value: string) => [{ type: "text", text: value }] },
      execute: async (_args, exec) => { failedVerifier = exec.agent; throw new ReadOnlyPathUnsupportedError("fixture backend cannot protect Coordinator records"); },
    }));
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId(`unsupported-shell-${action}`), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    f.ctx.on("session/event", (session, event) => {
      if (acted || session !== failedVerifier?.session || event.type !== "turn/end") return;
      acted = true;
      if (action === "stop") agent.cancel({ kind: "user" });
      else agent.steer(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Use the new human direction" }] }));
    });
    let parentRequests = 0;
    const verifierRequests = new Map<string, number>();
    f.adapter.handler = request => {
      const id = String(request.sessionId);
      if (id.startsWith("moa-builder-")) return rubric();
      if (id.startsWith("moa-verifier-")) {
        const count = (verifierRequests.get(id) ?? 0) + 1;
        verifierRequests.set(id, count);
        if (count === 1) return call("read_rubric");
        if (count === 2) return call(failedVerifier === undefined ? "pwsh" : "read_candidate");
        return call("submit_verdict", { status: "Pass", issues: [] });
      }
      if (++parentRequests > 2) agent.cancel({ kind: "user" });
      return response(parentRequests === 1 ? "123" : "The updated answer");
    };
    agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "123" }] }));
    await agent.whenIdle();
    expect(acted).toBe(true);
    expect(parentRequests).toBe(action === "stop" ? 1 : 2);
    expect(verifierRequests.get(String(failedVerifier!.id))).toBe(2);
    const events = agent.session.snapshotEvents();
    expect(events.findLast(event => event.type === "turn/end")).toMatchObject({ data: { reason: action === "stop" ? { kind: "aborted", reason: { kind: "user" } } : { kind: "completed" } } });
    expect(events.some(event => event.type === "user/message" && event.data.source.kind === "moa-completion")).toBe(false);
    if (action === "new human input") {
      expect(events.some(event => event.type === "user/message" && event.data.source.kind === "user" && event.data.content.some(block => block.type === "text" && block.text === "Use the new human direction"))).toBe(true);
      expect(agent.inbox.nextStep).toHaveLength(0);
    } else {
      // A later human prompt must replace the stopped helper, whose native
      // cancel-and-join admission boundary remains closed after capability loss.
      agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Continue after Stop" }] }));
      await agent.whenIdle();
      expect(parentRequests).toBe(2);
      expect(agent.session.snapshotEvents().findLast(event => event.type === "turn/end")).toMatchObject({ data: { reason: { kind: "completed" } } });
    }
    await expect.poll(() => ({
      released: releasedVerifiers.has(String(failedVerifier!.id)),
      retained: f.ctx.agents.get(failedVerifier!.id) !== undefined,
    })).toEqual({ released: true, retained: false });
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
