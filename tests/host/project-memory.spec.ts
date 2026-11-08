import { expect, it } from "vitest";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage, type StreamChunk } from "@deepseek-ai/dsh-llm";
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
    expect(mode.paths!.notes).toBe(join(f.root, "notes.md"));
    const index = join(mode.paths!.context, "index.md");
    expect(await readFile(index, "utf8")).toContain("# Project context");
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

it("injects full notes at every coordinator inference, even unchanged, and keeps ordinary sessions separate", async () => {
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("notes-each-inference"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    const mode = await f.ctx.projectMode.setEnabled(
      agent.id,
      true,
      0,
      "enable",
    );
    const notes = "🚀".repeat(8000) + "\nTAIL_FACT_完整保留";
    await writeFile(mode.paths!.notes, notes);
    const errors: unknown[] = [];
    f.ctx.on("agent/error", ({ error }) => {
      errors.push(error);
    });
    let calls = 0;
    f.adapter.handler = (request) => {
      if (request.sessionId !== agent.id) return response("ordinary");
      calls++;
      const snapshots = request.messages.filter(
        (m) => m.source.kind === "moa-notes",
      );
      expect(snapshots).toHaveLength(calls);
      const text = snapshots
        .at(-1)!
        .content.filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
      expect(text).toContain(notes);
      expect(text).toContain("archiv");
      if (calls === 1) {
        const args = '{"action":"list"}';
        return [
          { type: "block-start", index: 0, blockType: "tool-call" },
          {
            type: "tool-call-delta",
            index: 0,
            id: "list",
            name: "control_workers",
            argumentsDelta: args,
          },
          {
            type: "block-end",
            index: 0,
            block: {
              type: "tool-call",
              id: "list",
              name: "control_workers",
              arguments: args,
            },
          },
          { type: "finish", reason: { kind: "tool-calls" } },
        ] as StreamChunk[];
      }
      return response("Reviewed notes");
    };
    agent.followup(
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "Review progress" }],
      }),
    );
    await agent.whenIdle();
    expect(errors).toEqual([]);
    expect(calls).toBe(2);
    const { agent: ordinary } = await f.ctx.agents.create({
      sessionId: SessionId("notes-ordinary"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    ordinary.followup(
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "Hello" }],
      }),
    );
    await ordinary.whenIdle();
    expect(
      f.adapter.requests
        .at(-1)!
        .messages.some((m) => m.source.kind === "moa-notes"),
    ).toBe(false);
  } finally {
    await f.dispose();
  }
});
