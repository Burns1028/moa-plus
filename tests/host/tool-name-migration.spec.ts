import { expect, it } from "vitest";
import { createAssistantMessage, createToolResultMessage, createUserMessage, ToolCallId } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { fixture, response } from "./fixture.ts";
import { moaToolNames } from "../../packages/project-mode/src/shared/tool-names.ts";
import { createNativeMessageBroker } from "../../packages/project-mode/src/host/moa/messages.ts";

const legacyNames = ["Task", "Fork", "SendMessage", "QueryAgent", "KillAgent", "ProjectContext",
  "set_completion_criteria", "query_background_tool", "cancel_background_tool"];
const currentNames = [moaToolNames.dispatch, moaToolNames.branch, moaToolNames.message,
  moaToolNames.observe, moaToolNames.stop, moaToolNames.context, moaToolNames.jobStatus, moaToolNames.jobStop];

it.each(["completed", "interrupted"] as const)(
  "resumes %s legacy calls through native history repair without redispatch or schema aliases",
  async (state) => {
    const first = await fixture(undefined, { keepFiles: true });
    let second: Awaited<ReturnType<typeof fixture>> | undefined;
    const id = SessionId(`old-tool-${state}`), callId = ToolCallId("old-dispatch");
    try {
      const { agent } = await first.ctx.agents.create({ sessionId: id, meta: { cwd: first.root },
        agentOptions: { provider: "test", model: "test" } });
      await first.ctx.projectMode.setEnabled(id, true, 0, "enable");
      agent.session.append("turn/start", { turn: 1 });
      agent.session.append("step/start", { turn: 1, step: 1 });
      const args = JSON.stringify({ tasks: [{ name: "must-not-start-again", task: "old work",
        role: "General-purpose", workspace: "shared" }] });
      agent.session.append("assistant/message", { turn: 1, step: 1, stream: [],
        message: createAssistantMessage({ source: { provider: "test", model: "test" }, content: [
          { type: "tool-call", id: callId, name: "Task", arguments: args },
        ] }) }, { surfaceOp: "append" });
      const oldCall = agent.session.append("tool/call", { turn: 1, step: 1, callId, name: "Task", arguments: args });
      if (state === "completed") {
        agent.session.append("tool/result", { turn: 1, step: 1, message: createToolResultMessage({
          callId, isError: false, content: [{ type: "text", text: "Previously completed work" }],
        }) }, { surfaceOp: "append" });
        agent.session.append("step/end", { turn: 1, step: 1 });
        agent.session.append("turn/end", { turn: 1, reason: { kind: "completed" } });
      }
      await first.ctx.sessions.flush(agent.session);
      await first.dispose();
      second = await fixture(undefined, { root: first.root });
      const { agent: restored } = await second.ctx.agents.resume({ resumeSessionId: id,
        agentOptions: { provider: "test", model: "test" } });
      await restored.whenIdle();
      expect(second.adapter.requests).toHaveLength(0);
      const history = restored.session.snapshotEvents();
      expect(history.find(event => event.seq === oldCall.seq)).toEqual(oldCall);
      const outcomes = history.filter(event => event.type === "tool/result" && event.data.message.toolCallId === callId);
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].type === "tool/result" && outcomes[0].data.message.isError === true).toBe(state === "interrupted");
      expect((await second.ctx.projectMode.snapshot(id))?.workers).toHaveLength(0);
      second.adapter.handler = () => response("continued with current tools");
      restored.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Continue" }] }));
      await restored.whenIdle();
      expect(second.adapter.requests).toHaveLength(1);
      const schemas = second.adapter.requests[0].tools?.map(tool => tool.name) ?? [];
      for (const name of currentNames) expect(schemas).toContain(name);
      for (const name of legacyNames) expect(schemas).not.toContain(name);
      expect(second.adapter.requests[0].messages.some(message => message.role === "assistant" &&
        message.content.some(block => block.type === "tool-call" && block.name === "Task"))).toBe(true);
      expect((await second.ctx.projectMode.snapshot(id))?.workers).toHaveLength(0);
    } finally {
      if (second) await second.dispose();
      else {
        await first.dispose();
        const { rm } = await import("node:fs/promises");
        await rm(first.root, { recursive: true, force: true });
      }
    }
  },
);

it.each(["SendMessage", moaToolNames.message])("recognizes a committed %s answer after broker recovery", async (name) => {
  const f = await fixture();
  let broker: ReturnType<typeof createNativeMessageBroker> | undefined;
  try {
    const { agent } = await f.ctx.agents.create({ sessionId: SessionId("answered-legacy-request"),
      meta: { cwd: f.root }, agentOptions: { provider: "test", model: "test" } });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    const host = f.ctx.projectMode as any;
    const callId = ToolCallId("old-question");
    agent.session.append("turn/start", { turn: 1 });
    agent.session.append("step/start", { turn: 1, step: 1 });
    const args = JSON.stringify({ target: "previous-worker", message: "Question", mode: "request", timeout_ms: 1000 });
    agent.session.append("assistant/message", { turn: 1, step: 1, stream: [],
      message: createAssistantMessage({ source: { provider: "test", model: "test" },
        content: [{ type: "tool-call", id: callId, name, arguments: args }] }) }, { surfaceOp: "append" });
    const call = agent.session.append("tool/call", { turn: 1, step: 1, callId, name, arguments: args });
    const operationId = `tool:${JSON.stringify([agent.id, call.seq, callId])}`;
    const requestId = operationId;
    agent.session.append("tool/result", { turn: 1, step: 1, message: createToolResultMessage({ callId,
      isError: false, content: [{ type: "text", text: JSON.stringify({ status: "answered", requestId, answer: "Already delivered" }) }],
    }) }, { surfaceOp: "append" });
    agent.session.append("step/end", { turn: 1, step: 1 });
    agent.session.append("turn/end", { turn: 1, reason: { kind: "completed" } });
    await host.update(agent.id, (record: any) => ({ ...record, operations: { ...record.operations,
      [`moa:route:${requestId}`]: { rootId: agent.id, senderId: agent.id, targetId: "previous-worker",
        requestId, operationId, state: "answered", answer: "Already delivered" },
    } }));
    await f.ctx.sessions.flush(agent.session);
    broker = createNativeMessageBroker(host.access, async () => false);
    await broker.recover(agent.id);
    await agent.whenIdle();
    expect(f.adapter.requests).toHaveLength(0);
    expect(agent.session.snapshotEvents().filter(event => event.type === "user/message" &&
      event.data.source.kind === "moa-message")).toHaveLength(0);
  } finally { broker?.dispose(); await f.dispose(); }
});
