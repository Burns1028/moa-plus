import { it, expect } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import {
  createUserMessage,
  type GenerateOptions,
  type StreamChunk,
} from "@deepseek-ai/dsh-llm";
import { fixture, response } from "./fixture.ts";

function toolCalls(id: string, actions: object[]): StreamChunk[] {
  return [
    ...actions.flatMap((action, index): StreamChunk[] => {
      const callId = `${id}-${index}`;
      const input = action as { action: string; name?: string; task?: string; worker_id?: string; message?: string; delivery?: string };
      const name = input.action === "spawn" ? "Task" : "SendMessage";
      const args = JSON.stringify(input.action === "spawn"
        ? { tasks: [{ name: input.name, task: input.task, role: "General-purpose", workspace: "shared" }] }
        : { target: input.worker_id, message: input.message, delivery: input.delivery });
      return [
        { type: "block-start", index, blockType: "tool-call" },
        {
          type: "tool-call-delta",
          index,
          id: callId,
          name,
          argumentsDelta: args,
        },
        {
          type: "block-end",
          index,
          block: {
            type: "tool-call",
            id: callId,
            name,
            arguments: args,
          },
        },
      ];
    }),
    { type: "finish", reason: { kind: "tool-calls" } },
  ];
}

function textOf(message: GenerateOptions["messages"][number]) {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

it("continues real native tool results with no new inbox messages, then queues and spawns within the same guarded turn", async () => {
  const f = await fixture();
  const gate = Promise.withResolvers<void>();
  const waiting = Promise.withResolvers<void>();
  let parentCalls = 0;
  let workerCalls = 0;
  const fullFinal = "Full worker evidence. ".repeat(3000) + "FINAL TAIL";
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("native-tool-continuation"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    f.adapter.handler = async (options) => {
      if (options.sessionId !== agent.id) {
        await gate.promise;
        return response(`${++workerCalls}: ${fullFinal}`);
      }
      if (++parentCalls === 1)
        return toolCalls("spawn", [
          { action: "spawn", name: "first", task: "first assignment" },
        ]);
      if (parentCalls === 2) {
        // The native loop persisted the tool result; the model learns the
        // actual worker identity from it instead of driving the service itself.
        const receipt = options.messages.find(
          (message) =>
            message.role === "tool" && message.source.callId === "spawn-0",
        );
        expect(receipt).toBeDefined();
        const [{ accepted, workerId }] = JSON.parse(textOf(receipt!));
        expect(accepted).toBe(true);
        expect(workerId).toBeTruthy();
        return toolCalls("continue", [
          {
            action: "send",
            worker_id: workerId,
            delivery: "queue",
            message: "queued assignment",
          },
          { action: "spawn", name: "second", task: "parallel assignment" },
        ]);
      }
      const results = options.messages.filter(
        (message) => message.source.kind === "project-mode-result",
      );
      for (const result of results) expect(textOf(result)).toContain(fullFinal);
      waiting.resolve();
      return response(`Reviewed ${results.length} complete worker results`);
    };
    agent.followup(
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "delegate, queue, and review" }],
      }),
    );
    // A rejection after the first tool result must fail promptly rather than
    // being hidden by releasing the worker before the empty native pre-step.
    await Promise.race([
      waiting.promise,
      agent.whenIdle().then(() => {
        const reasons = agent.session
          .snapshotEvents()
          .filter((event) => event.type === "turn/end")
          .map((event) => event.data.reason.kind);
        throw new Error(
          `Coordinator ended before tool continuation: ${JSON.stringify(reasons)}`,
        );
      }),
    ]);
    const pending = await f.ctx.projectMode.snapshot(agent.id);
    expect(pending?.workers).toHaveLength(2);
    expect(pending?.coordinatorTurn?.pendingAssignmentIds).toHaveLength(3);
    expect(pending?.coordinatorTurn?.runningWorkerIds).toHaveLength(2);
    expect(pending?.coordinatorTurn?.queuedWorkerIds).toHaveLength(1);
    expect(
      agent.session
        .snapshotEvents()
        .filter((event) => event.type === "tool/result"),
    ).toHaveLength(3);
    expect(workerCalls).toBe(0);
    expect(
      agent.session
        .snapshotEvents()
        .filter((event) => event.type === "turn/end"),
    ).toHaveLength(0);
    gate.resolve();
    await agent.whenIdle();
    const events = agent.session.snapshotEvents();
    expect(events.filter((event) => event.type === "turn/start")).toHaveLength(
      1,
    );
    expect(events.filter((event) => event.type === "turn/end")).toMatchObject([
      { data: { reason: { kind: "completed" } } },
    ]);
    expect(events.filter((event) => event.type === "tool/result")).toHaveLength(
      3,
    );
    expect(
      events.filter(
        (event) =>
          event.type === "user/message" &&
          event.data.source.kind === "project-mode-result",
      ),
    ).toHaveLength(3);
    expect(workerCalls).toBe(3);
    expect(JSON.stringify(events)).toContain(
      "Reviewed 3 complete worker results",
    );
  } finally {
    gate.resolve();
    await f.dispose();
  }
});
