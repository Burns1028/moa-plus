import { expect, it } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage, type StreamChunk } from "@deepseek-ai/dsh-llm";
import { fixture, response } from "./fixture.ts";

function query(args: object): StreamChunk[] {
  const value = JSON.stringify(args);
  return [
    { type: "block-start", index: 0, blockType: "tool-call" },
    { type: "tool-call-delta", index: 0, id: "query-wait", name: "QueryAgent", argumentsDelta: value },
    { type: "block-end", index: 0, block: { type: "tool-call", id: "query-wait", name: "QueryAgent", arguments: value } },
    { type: "finish", reason: { kind: "tool-calls" } },
  ];
}
const user = (text: string) => createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text }] });

it.each(["all", "selected"] as const)("keeps QueryAgent wait=%s foreground until its child completes beyond the background threshold", async wait => {
  const f = await fixture(undefined, { backgroundStrategy: "after-seconds", backgroundAfterSeconds: 0.01 });
  const childStarted = Promise.withResolvers<void>();
  const releaseChild = Promise.withResolvers<void>();
  const queryStarted = Promise.withResolvers<void>();
  const parentContinued = Promise.withResolvers<void>();
  try {
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("query-wait-parent"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    const childId = SessionId("query-wait-child");
    let parentCalls = 0;
    f.ctx.on("agent/tool-activity-started", activity => {
      if (activity.execution.agent === agent && activity.execution.name === "QueryAgent") queryStarted.resolve();
    });
    f.adapter.handler = async options => {
      if (options.sessionId === childId) { childStarted.resolve(); await releaseChild.promise; return response("child finished"); }
      if (++parentCalls === 1) return query({ wait, ...(wait === "selected" ? { ids: [childId] } : {}), timeout_ms: 5000 });
      parentContinued.resolve();
      return response("parent continued");
    };
    await (f.ctx.projectMode as any).workers.spawnMoA(agent, { name: "worker", task: "work", childId, cwd: f.root, identity: "worker", provider: "spawn" }, "query-wait-spawn", new AbortController().signal);
    await childStarted.promise;
    agent.followup(user("Wait for the worker"));
    await queryStarted.promise;
    // Cross the configured 10ms threshold while the controlled child stays open.
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(parentCalls).toBe(1);
    expect((f.ctx.projectMode as any).moa.lifecycle(agent)).toBe("Waiting");
    expect(agent.session.snapshotEvents().filter(event => event.type === "tool/result")).toHaveLength(0);
    releaseChild.resolve();
    await parentContinued.promise;
    await agent.whenIdle();
    const result = agent.session.snapshotEvents().find(event => event.type === "tool/result" && event.data.message.toolCallId === "query-wait");
    expect(result?.type === "tool/result" && result.data.message.isError).toBeFalsy();
    expect(JSON.stringify(result)).not.toContain("moaBackground");
    if (result?.type !== "tool/result") throw new Error("Missing QueryAgent result");
    expect(["done", "interrupted"]).toContain(JSON.parse(result.data.message.content.filter(block => block.type === "text").map(block => block.text).join("\n")).reason);
    expect((f.ctx.projectMode as any).moa.lifecycle(agent)).not.toBe("Waiting");
  } finally { releaseChild.resolve(); await f.dispose(); }
});

it.each(["timeout", "input"] as const)("lets QueryAgent's own %s end its foreground wait with the native result", async end => {
  const f = await fixture(undefined, { backgroundStrategy: "after-seconds", backgroundAfterSeconds: 0.01 });
  const childStarted = Promise.withResolvers<void>();
  const releaseChild = Promise.withResolvers<void>();
  const queryStarted = Promise.withResolvers<void>();
  const parentContinued = Promise.withResolvers<void>();
  try {
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("query-interrupt-parent"), meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    const childId = SessionId("query-interrupt-child");
    let parentCalls = 0;
    let lifecycleAtContinuation: string | undefined;
    f.ctx.on("agent/tool-activity-started", activity => {
      if (activity.execution.agent === agent && activity.execution.name === "QueryAgent") queryStarted.resolve();
    });
    f.adapter.handler = async options => {
      if (options.sessionId === childId) { childStarted.resolve(); await releaseChild.promise; return response("child finished"); }
      if (++parentCalls === 1) return query({ wait: "all", timeout_ms: end === "timeout" ? 60 : 5000 });
      lifecycleAtContinuation = (f.ctx.projectMode as any).moa.lifecycle(agent);
      parentContinued.resolve();
      return response("handled wait result");
    };
    await (f.ctx.projectMode as any).workers.spawnMoA(agent, { name: "worker", task: "work", childId, cwd: f.root, identity: "worker", provider: "spawn" }, "query-interrupt-spawn", new AbortController().signal);
    await childStarted.promise;
    agent.followup(user("Wait for the worker"));
    await queryStarted.promise;
    if (end === "input") {
      await new Promise(resolve => setTimeout(resolve, 40));
      expect(parentCalls).toBe(1);
      agent.steer(user("Handle this incoming instruction"));
    }
    await parentContinued.promise;
    const result = agent.session.snapshotEvents().find(event => event.type === "tool/result" && event.data.message.toolCallId === "query-wait");
    expect(result?.type).toBe("tool/result");
    if (result?.type !== "tool/result") throw new Error("Missing QueryAgent result");
    expect(result.data.message.isError).toBeFalsy();
    expect(JSON.stringify(result)).not.toContain("moaBackground");
    expect(JSON.parse(result.data.message.content.filter(block => block.type === "text").map(block => block.text).join("\n")).reason).toBe(end === "timeout" ? "timeout" : "interrupted");
    expect(lifecycleAtContinuation).not.toBe("Waiting");
    expect(agent.session.snapshotEvents().filter(event => event.type === "turn/start")).toHaveLength(1);
  } finally { releaseChild.resolve(); await f.dispose(); }
});
