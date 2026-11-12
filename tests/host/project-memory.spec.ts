import { expect, it, vi } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SessionId, isAppendSurfaceEvent } from "@deepseek-ai/dsh-session";
import { createUserMessage, type StreamChunk } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { fixture, response } from "./fixture.ts";

function callTool(name: string): StreamChunk[] {
  return [
    { type: "block-start", index: 0, blockType: "tool-call" },
    { type: "tool-call-delta", index: 0, id: name, name, argumentsDelta: "{}" },
    {
      type: "block-end",
      index: 0,
      block: { type: "tool-call", id: name, name, arguments: "{}" },
    },
    { type: "finish", reason: { kind: "tool-calls" } },
  ];
}

const messageText = (message: {
  content: readonly { type: string; text?: string }[];
}) =>
  message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");

it("bootstraps an index for new projects and legacy context before either role's first request without loading document bodies", async () => {
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("memory-parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await mkdir(join(f.root, "context"));
    await writeFile(
      join(f.root, "context", "existing.md"),
      "Existing reusable fact",
    );
    const mode = await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
    expect(mode.paths!.notes).toBe(join(f.root, "notes.md"));
    const index = join(mode.paths!.context, "index.md");
    expect(await readFile(index, "utf8")).toContain("# Project context");
    expect(await readFile(index, "utf8")).toContain("existing.md");
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
      const prompt = request.messages
        .flatMap((message) => message.content)
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      expect(prompt).toContain(JSON.stringify(index));
      expect(prompt).toContain("Read");
      expect(prompt).not.toContain("DEFERRED_CONTEXT_BODY");
      if (request.sessionId !== agent.id) {
        expect(prompt).toContain("shared index");
        expect(
          request.messages.some(
            (message) => message.source.kind === "moa-notes",
          ),
        ).toBe(false);
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

it("keeps one full notes snapshot at every inference, even unchanged, and keeps ordinary sessions separate", async () => {
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
    f.ctx.tools.register(
      defineTool({
        name: "memory_probe",
        description: "Advance one native step",
        parameters: {},
        output: {
          schema: { type: "string" },
          render: (_: unknown, value: string) => [
            { type: "text", text: value },
          ],
        },
        execute: async () => "Observed",
      }),
    );
    f.adapter.handler = (request) => {
      if (request.sessionId !== agent.id) return response("ordinary");
      calls++;
      const snapshots = request.messages.filter(
        (m) => m.source.kind === "moa-notes",
      );
      expect(snapshots).toHaveLength(1);
      const text = snapshots
        .at(-1)!
        .content.filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
      expect(text).toContain(notes);
      expect(text).toContain("archiv");
      if (calls === 1) {
        return callTool("memory_probe");
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

it("refreshes changed notes through native surface replacements while preserving user, tool and audit history", async () => {
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("notes-updated"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    const mode = await f.ctx.projectMode.setEnabled(
      agent.id,
      true,
      0,
      "enable",
    );
    await writeFile(mode.paths!.notes, "INITIAL_NOTE_VALUE");
    let actions = 0;
    f.ctx.tools.register(
      defineTool({
        name: "memory_probe",
        description: "Update the current task record",
        parameters: {},
        output: {
          schema: { type: "string" },
          render: (_: unknown, value: string) => [
            { type: "text", text: value },
          ],
        },
        execute: async () => {
          actions++;
          await writeFile(mode.paths!.notes, "UPDATED_NOTE_VALUE");
          return `PROBE_RESULT_${actions}`;
        },
      }),
    );
    let calls = 0;
    f.adapter.handler = (request) => {
      calls++;
      const snapshots = request.messages.filter(
        (message) => message.source.kind === "moa-notes",
      );
      expect(snapshots).toHaveLength(1);
      expect(messageText(snapshots[0])).toContain(
        calls === 1 ? "INITIAL_NOTE_VALUE" : "UPDATED_NOTE_VALUE",
      );
      if (calls > 1) {
        expect(request.messages.map(messageText).join("\n")).not.toContain(
          "INITIAL_NOTE_VALUE",
        );
        expect(
          request.messages.some(
            (message) =>
              message.role === "tool" &&
              messageText(message) === "PROBE_RESULT_1",
          ),
        ).toBe(true);
      }
      expect(
        request.messages.some(
          (message) =>
            message.source.kind === "user" &&
            messageText(message).includes("HUMAN_LITERAL_NOTES"),
        ),
      ).toBe(true);
      return calls < 3 ? callTool("memory_probe") : response("Completed");
    };
    agent.followup(
      createUserMessage({
        source: { kind: "user" },
        content: [
          {
            type: "text",
            text: "Current notes.md (complete):\nHUMAN_LITERAL_NOTES",
          },
        ],
      }),
    );
    await agent.whenIdle();
    expect(calls).toBe(3);
    const raw = await f.ctx.sessionQuery.readSession(agent.id);
    const notes = raw.events.filter(
      (event) =>
        event.type === "user/message" && event.data.source.kind === "moa-notes",
    );
    expect(notes).toHaveLength(2); // One original admission and one changed snapshot; unchanged reads add nothing.
    expect(
      notes[0].type === "user/message" && messageText(notes[0].data),
    ).toContain("INITIAL_NOTE_VALUE");
    expect(
      notes[1].type === "user/message" && messageText(notes[1].data),
    ).toContain("UPDATED_NOTE_VALUE");
    expect(isAppendSurfaceEvent(notes[0])).toBe(true);
    expect(isAppendSurfaceEvent(notes[1])).toBe(false);
    expect(
      agent.session
        .deriveMessages()
        .filter((message) => message.source.kind === "moa-notes"),
    ).toHaveLength(1);
    // The authoritative native history can be replayed without an LLM middleware rewrite.
    expect(
      (await f.ctx.sessionQuery.readSurface(agent.id)).events.filter(
        (event) =>
          event.type === "user/message" &&
          event.data.source.kind === "moa-notes",
      ),
    ).toHaveLength(1);
  } finally {
    await f.dispose();
  }
});

it("cleans legacy saved snapshots on resume without editing their original events", async () => {
  let f = await fixture(undefined, { keepFiles: true });
  try {
    let { agent } = await f.ctx.agents.create({
      sessionId: SessionId("notes-legacy"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    const mode = await f.ctx.projectMode.setEnabled(
      agent.id,
      true,
      0,
      "enable",
    );
    agent.followup(
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "ORIGINAL_USER_REQUEST" }],
      }),
    );
    await agent.whenIdle();
    for (const value of ["LEGACY_NOTES_FIRST", "LEGACY_NOTES_SECOND"]) {
      agent.session.append(
        "user/message",
        createUserMessage({
          source: { kind: "moa-notes", coordinatorSessionId: agent.id },
          content: [{ type: "text", text: value }],
        }),
        { surfaceOp: "append" },
      );
    }
    const before = await f.ctx.sessionQuery.readSession(agent.id);
    const originals = before.events.filter(
      (event) =>
        event.type === "user/message" && event.data.source.kind === "moa-notes",
    );
    expect(originals).toHaveLength(3);
    await f.ctx.sessions.flush(agent.session);
    const root = f.root,
      id = agent.id;
    await f.dispose();
    f = await fixture(undefined, { root });
    await writeFile(mode.paths!.notes, "RESUMED_CURRENT_NOTES");
    ({ agent } = await f.ctx.agents.resume({
      resumeSessionId: id,
      agentOptions: { provider: "test", model: "test" },
    }));
    f.adapter.handler = (request) => {
      const snapshots = request.messages.filter(
        (message) => message.source.kind === "moa-notes",
      );
      expect(snapshots).toHaveLength(1);
      expect(messageText(snapshots[0])).toContain("RESUMED_CURRENT_NOTES");
      expect(request.messages.map(messageText).join("\n")).not.toContain(
        "LEGACY_NOTES_",
      );
      expect(request.messages.map(messageText).join("\n")).toContain(
        "ORIGINAL_USER_REQUEST",
      );
      return response("Continued");
    };
    agent.followup(
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "Resume" }],
      }),
    );
    await agent.whenIdle();
    expect(f.adapter.requests).toHaveLength(1);
    const after = await f.ctx.sessionQuery.readSession(id);
    for (const event of originals)
      expect(after.events[event.seq]).toEqual(event);
    expect(
      agent.session
        .deriveMessages()
        .filter((message) => message.source.kind === "moa-notes"),
    ).toHaveLength(1);
  } finally {
    await f.dispose();
  }
});

it("leaves the prior snapshot intact when Stop interrupts the fresh read and refreshes on the next turn", async () => {
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("notes-stopped"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    const mode = await f.ctx.projectMode.setEnabled(
      agent.id,
      true,
      0,
      "enable",
    );
    await writeFile(mode.paths!.notes, "BEFORE_STOP_NOTES");
    const user = (text: string) =>
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text }],
      });
    agent.followup(user("Start"));
    await agent.whenIdle();
    const before = await f.ctx.sessionQuery.readSession(agent.id);
    const fs =
      f.ctx.get("agentPresets")?.serviceFor(agent, "fs") ??
      agent.ctx.get("fs")!;
    const originalRead = fs.readText.bind(fs);
    const entered = Promise.withResolvers<void>();
    const read = vi
      .spyOn(fs, "readText")
      .mockImplementation(async (target, signal) => {
        if (fs.processPath(target) === mode.paths!.notes) {
          entered.resolve();
          await new Promise<void>((resolve) => {
            if (signal?.aborted) resolve();
            else
              signal?.addEventListener("abort", () => resolve(), {
                once: true,
              });
          });
          signal?.throwIfAborted();
        }
        return originalRead(target, signal);
      });
    await writeFile(mode.paths!.notes, "AFTER_STOP_NOTES");
    agent.followup(user("Interrupted update"));
    await entered.promise;
    agent.cancel({ kind: "user" });
    await agent.whenIdle();
    read.mockRestore();
    const afterStop = await f.ctx.sessionQuery.readSession(agent.id);
    expect(
      afterStop.events.filter(
        (event) =>
          event.type === "user/message" &&
          event.data.source.kind === "moa-notes",
      ),
    ).toEqual(
      before.events.filter(
        (event) =>
          event.type === "user/message" &&
          event.data.source.kind === "moa-notes",
      ),
    );
    expect(f.adapter.requests).toHaveLength(1);
    agent.followup(user("Continue after Stop"));
    await agent.whenIdle();
    const current = f.adapter.requests
      .at(-1)!
      .messages.filter((message) => message.source.kind === "moa-notes");
    expect(current).toHaveLength(1);
    expect(messageText(current[0])).toContain("AFTER_STOP_NOTES");
    expect(
      f.adapter.requests.at(-1)!.messages.map(messageText).join("\n"),
    ).not.toContain("BEFORE_STOP_NOTES");
  } finally {
    vi.restoreAllMocks();
    await f.dispose();
  }
});

it("deduplicates inherited Worker snapshots without injecting the Coordinator's live notes", async () => {
  const f = await fixture();
  const release = Promise.withResolvers<void>();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("notes-worker-parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    const mode = await f.ctx.projectMode.setEnabled(
      agent.id,
      true,
      0,
      "enable",
    );
    const entered = Promise.withResolvers<void>();
    f.adapter.handler = async (request) => {
      if (request.sessionId !== agent.id) {
        entered.resolve();
        await release.promise;
      }
      return response("First response");
    };
    const receipt = (await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "spawn", name: "memory-worker", task: "Inspect one file" },
      "spawn",
      new AbortController().signal,
    )) as { workerId: SessionId };
    const worker = f.ctx.agents.get(receipt.workerId)!;
    await entered.promise;
    for (const value of ["INHERITED_NOTE_OLD", "INHERITED_NOTE_LATEST"]) {
      worker.session.append(
        "user/message",
        createUserMessage({
          source: { kind: "moa-notes", coordinatorSessionId: agent.id },
          content: [{ type: "text", text: value }],
        }),
        { surfaceOp: "append" },
      );
    }
    await writeFile(mode.paths!.notes, "LIVE_COORDINATOR_NOTES");
    let inspected = false;
    f.adapter.handler = (request) => {
      if (request.sessionId === worker.id) {
        inspected = true;
        const snapshots = request.messages.filter(
          (message) => message.source.kind === "moa-notes",
        );
        expect(snapshots).toHaveLength(1);
        expect(messageText(snapshots[0])).toBe("INHERITED_NOTE_LATEST");
        expect(request.messages.map(messageText).join("\n")).not.toContain(
          "LIVE_COORDINATOR_NOTES",
        );
        expect(request.messages.map(messageText).join("\n")).not.toContain(
          "INHERITED_NOTE_OLD",
        );
      }
      return response("Checked");
    };
    worker.steer(
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "Continue your responsibility" }],
      }),
    );
    release.resolve();
    await worker.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    await agent.whenIdle();
    expect(inspected).toBe(true);
    expect(
      (await f.ctx.sessionQuery.readSession(worker.id)).events.filter(
        (event) =>
          event.type === "user/message" &&
          event.data.source.kind === "moa-notes",
      ),
    ).toHaveLength(2);
  } finally {
    release.resolve();
    await f.dispose();
  }
});

it("does not present stale notes as current when a later read is denied", async () => {
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("notes-read-denied"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    const mode = await f.ctx.projectMode.setEnabled(
      agent.id,
      true,
      0,
      "enable",
    );
    await writeFile(mode.paths!.notes, "STALE_NOTE_VALUE");
    const user = (text: string) =>
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text }],
      });
    agent.followup(user("Initial task"));
    await agent.whenIdle();
    const fs =
      f.ctx.get("agentPresets")?.serviceFor(agent, "fs") ??
      agent.ctx.get("fs")!;
    const originalRead = fs.readText.bind(fs);
    vi.spyOn(fs, "readText").mockImplementation((target, signal) => {
      if (fs.processPath(target) === mode.paths!.notes)
        throw new Error("READ_DENIED_FOR_TEST");
      return originalRead(target, signal);
    });
    agent.followup(user("Continue with available evidence"));
    await agent.whenIdle();
    expect(f.adapter.requests).toHaveLength(2);
    const latest = f.adapter.requests.at(-1)!.messages;
    const snapshots = latest.filter(
      (message) => message.source.kind === "moa-notes",
    );
    expect(snapshots).toHaveLength(1);
    expect(messageText(snapshots[0])).toContain("unavailable");
    expect(latest.map(messageText).join("\n")).not.toContain(
      "STALE_NOTE_VALUE",
    );
  } finally {
    vi.restoreAllMocks();
    await f.dispose();
  }
});
