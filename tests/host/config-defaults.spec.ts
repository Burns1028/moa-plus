import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import ProjectMode from "../../packages/project-mode/src/host/index.ts";
import { Config } from "../../packages/project-mode/src/host/config.ts";
import { fixture, response } from "./fixture.ts";

it("offers on-demand verification but completes default-config 123 without activating it", async () => {
  expect(Config({}).completionVerification).toBe("on-demand");
  expect(Config({ completionVerification: true }).completionVerification).toBe(
    true,
  );
  expect(Config({ completionVerification: false }).completionVerification).toBe(
    false,
  );
  const f = await fixture();
  try {
    // The shared fixture explicitly disables verification. Remount with empty
    // input so Cordis applies the production Config schema's actual defaults.
    await f.plugin.dispose();
    await f.ctx.plugin(ProjectMode, {});
    const created: SessionId[] = [];
    f.ctx.on("agent/created", ({ agent }) => {
      created.push(agent.id);
    });
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("default-config-123"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    f.adapter.handler = (request) => {
      expect(request.sessionId).toBe(agent.id);
      expect(f.adapter.requests).toHaveLength(1);
      return response("收到。");
    };
    agent.followup(
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "123" }],
      }),
    );
    await agent.whenIdle();

    expect(created).toEqual([agent.id]);
    expect(f.adapter.requests).toHaveLength(1);
    const request = f.adapter.requests[0];
    expect(request.tools?.map((tool) => tool.name)).toContain(
      "moa_review",
    );
    const facts = request.messages
      .filter((message) => message.source.kind === "runtime-context")
      .flatMap((message) => message.content)
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    expect(facts).toMatch(/on[- ]demand/i);
    expect(facts).toContain("moa_review");
    expect(facts).not.toContain(
      "Automatic outcome verification is not enabled",
    );
    expect(facts).not.toContain(
      "automatically runs an independent tool-backed Outcome Verifier",
    );
    const events = agent.session.snapshotEvents();
    expect(
      events.filter(
        (event) =>
          event.type === "user/message" && event.data.source.kind === "user",
      ),
    ).toMatchObject([
      {
        data: {
          source: { kind: "user" },
          content: [{ type: "text", text: "123" }],
        },
      },
    ]);
    expect(
      events.some(
        (event) =>
          event.type === "user/message" &&
          event.data.source.kind === "moa-completion",
      ),
    ).toBe(false);
    expect(
      events.filter((event) => event.type === "assistant/message"),
    ).toMatchObject([
      { data: { message: { content: [{ type: "text", text: "收到。" }] } } },
    ]);
    expect(events.filter((event) => event.type === "step/start")).toHaveLength(
      1,
    );
    expect(events.filter((event) => event.type === "turn/end")).toMatchObject([
      { data: { reason: { kind: "completed" } } },
    ]);
    await expect(
      readFile(join(f.root, "rubrics.md"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await f.dispose();
  }
});
