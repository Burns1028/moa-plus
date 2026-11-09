import { expect, it } from "vitest";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { fixture, response } from "./fixture.ts";

it("bootstraps an index for new projects and legacy context before either role's first request without loading document bodies", async () => {
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("memory-parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    const mode = await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    const index = join(mode.paths!.context, "context.md");
    expect(await readFile(index, "utf8")).toContain("# MoA context");
    await rm(index);
    await writeFile(
      join(mode.paths!.context, "README.md"),
      "LEGACY_DOCUMENT_BODY",
    );
    await writeFile(
      join(mode.paths!.context, "findings.md"),
      "DEFERRED_CONTEXT_BODY",
    );
    f.adapter.handler = async (request) => {
      const text = await readFile(index, "utf8");
      expect(text).toContain("README.md");
      expect(text).toContain("findings.md");
      expect(text).not.toContain("DOCUMENT_BODY");
      const prompt = JSON.stringify(request.messages);
      expect(prompt).toContain(index);
      expect(prompt).toContain("Read");
      expect(prompt).not.toContain("DEFERRED_CONTEXT_BODY");
      if (request.sessionId !== agent.id) {
        expect(prompt).toContain("shared index");
        // A worker's edits are retained when the coordinator resumes.
        await writeFile(
          index,
          text + "\n- [worker.md](worker.md) — Worker findings.\n",
        );
      }
      return response("done");
    };
    agent.followup(
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "Continue the project" }],
      }),
    );
    await agent.whenIdle();
    expect(await readFile(join(mode.paths!.context, "README.md"), "utf8")).toBe(
      "LEGACY_DOCUMENT_BODY",
    );
    // A worker can encounter an older project without an index too.
    await rm(index);
    const receipt = (await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "spawn", name: "writer", task: "Update shared knowledge" },
      "spawn",
      new AbortController().signal,
    )) as { workerId: SessionId };
    await f.ctx.agents.get(receipt.workerId)?.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    await agent.whenIdle();
    expect(await readFile(index, "utf8")).toContain("Worker findings");
    expect(
      f.adapter.requests.some((r) => r.sessionId === receipt.workerId),
    ).toBe(true);
    expect(await readFile(mode.paths!.notes, "utf8")).toContain("Active tasks");
  } finally {
    await f.dispose();
  }
});
