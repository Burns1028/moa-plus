import { expect, it } from "vitest";
import { createUserMessage, ReasoningEffortId } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { Adapter, fixture, response } from "./fixture.ts";
import { judgeInterrupt } from "../../packages/project-mode/src/host/moa/judge.ts";

it("uses the native no-thinking route with all unread input, without tools or consuming inbox", async () => {
  const adapter = new Adapter(() => response("false"));
  adapter.resolveModel = async (provider, model) => ({
    provider,
    id: model,
    name: model,
    reasoning: {
      efforts: [
        { id: ReasoningEffortId("off"), name: "Off" },
        { id: ReasoningEffortId("high"), name: "High" },
      ],
    },
  });
  const f = await fixture(adapter);
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("judge"),
      meta: { cwd: f.root },
      agentOptions: {
        provider: "test",
        model: "test",
        reasoningEffort: ReasoningEffortId("high"),
      },
    });
    const messages = [
      "first progress",
      "second progress",
      "urgent new decision",
    ].map((text) =>
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text }],
      }),
    );
    for (const message of messages) agent.inject(message);
    expect(
      await judgeInterrupt(
        f.ctx,
        agent,
        messages,
        {
          kind: "background",
          description: "test command",
          tool: { name: "bash", arguments: { command: "npm test" } },
          elapsedSeconds: 12,
        },
        new AbortController().signal,
      ),
    ).toBe(false);
    const request = adapter.requests.at(-1)!;
    expect(request.reasoningEffort).toBe("off");
    expect(request.maxTokens).toBeLessThanOrEqual(64);
    expect(request.tools).toBeUndefined();
    const body = JSON.stringify(request.messages);
    for (const message of messages)
      expect(body).toContain(
        message.content[0].type === "text"
          ? message.content[0].text
          : "missing",
      );
    expect(agent.inbox.nextStep.map((m) => m.id)).toEqual(
      messages.map((m) => m.id),
    );
    adapter.handler = () => response("true");
    expect(
      await judgeInterrupt(
        f.ctx,
        agent,
        messages,
        { kind: "request", description: "Waiting for another Agent" },
        new AbortController().signal,
      ),
    ).toBe(true);
  } finally {
    await f.dispose();
  }
});

it("hands back control on invalid/failed verdicts and propagates owner cancellation", async () => {
  const adapter = new Adapter(() => response("not a boolean"));
  const f = await fixture(adapter);
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("judge-failure"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    const messages = [
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "new input" }],
      }),
    ];
    expect(
      await judgeInterrupt(
        f.ctx,
        agent,
        messages,
        { kind: "request", description: "Waiting" },
        new AbortController().signal,
      ),
    ).toBe(true);
    adapter.handler = () => {
      throw new Error("model unavailable");
    };
    expect(
      await judgeInterrupt(
        f.ctx,
        agent,
        messages,
        { kind: "request", description: "Waiting" },
        new AbortController().signal,
      ),
    ).toBe(true);
    const abort = new AbortController();
    abort.abort(new Error("owner cancelled"));
    await expect(
      judgeInterrupt(
        f.ctx,
        agent,
        messages,
        { kind: "request", description: "Waiting" },
        abort.signal,
      ),
    ).rejects.toThrow("owner cancelled");
  } finally {
    await f.dispose();
  }
});
