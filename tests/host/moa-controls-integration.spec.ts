import { expect, it, vi } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { execFileSync } from "node:child_process";
import { writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fixture, response } from "./fixture.ts";
import { MoAAgents } from "../../packages/project-mode/src/host/moa/agents.ts";

async function parent(f: Awaited<ReturnType<typeof fixture>>) {
  const { agent } = await f.ctx.agents.create({
    sessionId: SessionId("moa-root"),
    meta: { cwd: f.root },
    agentOptions: { provider: "test", model: "test" },
  });
  await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
  return agent;
}
const signal = () => new AbortController().signal;

it("delivers the full result only to reportTo, waking its cold native conversation", async () => {
  const f = await fixture();
  try {
    const root = await parent(f);
    const host = (f.ctx.projectMode as any).access;
    const controls: MoAAgents = (f.ctx.projectMode as any).moa;
    f.adapter.handler = () => response("leader output");
    const [leader] = await controls.task(
      root,
      [
        {
          name: "leader",
          task: "prepare",
          role: "General-purpose",
          workspace: "shared",
          nested: true,
        },
      ],
      "leader",
      signal(),
    );
    await vi.waitFor(() =>
      expect(f.ctx.agents.get(SessionId(leader.workerId))).toBeUndefined(),
    );
    f.adapter.handler = (options) =>
      response(
        options.sessionId === root.id
          ? "root summary"
          : options.sessionId === leader.workerId
            ? "leader reviewed"
            : "FULL SPECIALIST RESULT",
      );
    const [child] = await controls.task(
      root,
      [
        {
          name: "specialist",
          task: "investigate",
          role: "General-purpose",
          workspace: "shared",
          reportTo: leader.workerId,
        },
      ],
      "specialist",
      signal(),
    );
    await vi.waitFor(() => {
      const record = host.record(root.id);
      const completion = record.completions.find(
        (c: any) => c.workerId === child.workerId,
      );
      expect(completion).toBeDefined();
      expect(
        record.deliveries.find((d: any) => d.completionId === completion.id),
      ).toMatchObject({ targetId: leader.workerId, state: "consumed" });
    });
    const record = host.record(root.id);
    const completion = record.completions.find(
      (c: any) => c.workerId === child.workerId,
    );
    expect(
      root.session
        .snapshotEvents()
        .filter(
          (e) =>
            e.type === "user/message" &&
            e.data.source.kind === "project-mode-result" &&
            e.data.source.completionId === completion.id,
        ),
    ).toHaveLength(0);
    using observed = await f.ctx.sessionQuery.observeSession(
      SessionId(leader.workerId),
    );
    const results = observed.events.filter(
      (e) =>
        e.type === "user/message" &&
        e.data.source.kind === "project-mode-result" &&
        e.data.source.completionId === completion.id,
    );
    expect(results).toHaveLength(1);
    expect(JSON.stringify(results[0])).toContain("FULL SPECIALIST RESULT");
  } finally {
    await f.dispose();
  }
});

it("keeps explicit next-turn messages queued while QueryAgent waits, and interrupts for steer", async () => {
  const f = await fixture();
  const release = Promise.withResolvers<void>();
  try {
    const root = await parent(f);
    f.adapter.handler = async (options) => {
      if (options.sessionId !== root.id) await release.promise;
      return response("done");
    };
    const controls: MoAAgents = (f.ctx.projectMode as any).moa;
    await controls.task(
      root,
      [
        {
          name: "worker",
          task: "work",
          role: "General-purpose",
          workspace: "shared",
        },
      ],
      "worker",
      signal(),
    );
    root.send(
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "next task" }],
      }),
      "next-turn",
      false,
    );
    let settled = false;
    const wait = controls
      .query(root, { wait: "all", timeoutMs: 1000 }, signal())
      .then((result) => {
        settled = true;
        return result;
      });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    root.send(
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "urgent update" }],
      }),
      "next-step",
      false,
    );
    expect(await wait).toMatchObject({ reason: "interrupted" });
    expect(root.inbox.nextTurn).toHaveLength(1);
  } finally {
    release.resolve();
    await f.dispose();
  }
});

it("derives Idle and Zombie from native turn history and preserves Worker control tools under role restrictions", async () => {
  const f = await fixture();
  const release = Promise.withResolvers<void>();
  try {
    const root = await parent(f);
    const controls: MoAAgents = (f.ctx.projectMode as any).moa;
    expect(controls.lifecycle(root)).toBe("Idle");
    f.adapter.handler = async (options) => {
      if (options.sessionId !== root.id) await release.promise;
      return response("done");
    };
    const [receipt] = await controls.task(
      root,
      [
        {
          name: "reader",
          task: "inspect",
          role: "Explorer",
          workspace: "shared",
        },
      ],
      "reader",
      signal(),
    );
    const worker = f.ctx.agents.get(SessionId(receipt.workerId))!;
    expect(controls.lifecycle(worker)).toBe("Running");
    expect(f.ctx.tools.get("SendMessage", worker)).toBeDefined();
    expect(f.ctx.tools.get("ProjectContext", worker)).toBeDefined();
    expect(f.ctx.tools.get("Task", worker)).toBeUndefined();
    expect(f.ctx.tools.get("Fork", worker)).toBeUndefined();
    expect(f.ctx.tools.get("subagent", worker)).toBeUndefined();
    release.resolve();
    await worker.whenIdle();
    expect(controls.lifecycle(worker)).toBe("Zombie");
  } finally {
    release.resolve();
    await f.dispose();
  }
});

it("destroys only the deleted Worker's owned isolated worktree and removes it from QueryAgent", async () => {
  const f = await fixture();
  const release = Promise.withResolvers<void>();
  try {
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: f.root, stdio: "pipe" });
    git("init");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.com");
    await writeFile(join(f.root, "keep.txt"), "source remains");
    git("add", "keep.txt");
    git("commit", "-m", "initial");
    const root = await parent(f);
    f.adapter.handler = async (options) => {
      if (options.sessionId !== root.id) await release.promise;
      return response("done");
    };
    const controls: MoAAgents = (f.ctx.projectMode as any).moa;
    const [receipt] = await controls.task(
      root,
      [{ name: "isolated", task: "work", role: "General-purpose" }],
      "isolated",
      signal(),
    );
    const workspace = controls.descriptor(
      SessionId(receipt.workerId),
    )!.workspace!;
    const request = {
      action: "delete" as const,
      worker_id: SessionId(receipt.workerId),
    };
    const deleting = f.ctx.projectMode.controlForAgent(
      root,
      request,
      "ui-delete-owned",
      signal(),
    );
    release.resolve();
    const removed = await deleting;
    expect(removed).toMatchObject({ lifecycle: "deleted" });
    expect(
      await f.ctx.projectMode.controlForAgent(
        root,
        request,
        "ui-delete-owned",
        signal(),
      ),
    ).toEqual(removed);
    await expect(stat(workspace.directory)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect((await controls.query(root, {}, signal())).children).toHaveLength(0);
    expect((await stat(join(f.root, "keep.txt"))).isFile()).toBe(true);
  } finally {
    release.resolve();
    await f.dispose();
  }
});

it("does not report a message-driven handoff as completion and settles its original assignment once", async () => {
  const f = await fixture();
  const background = Promise.withResolvers<string>();
  const foreground = Promise.withResolvers<string>();
  try {
    const { defineTool } = await import("@deepseek-ai/dsh-tools");
    let backgroundStarted = false,
      foregroundStarted = false,
      workerSteps = 0;
    f.ctx.tools.register(
      defineTool({
        name: "moa_slow",
        description: "held transfer",
        backgroundOnMessage: true,
        parameters: {},
        output: {
          schema: { type: "string" },
          render: (_a, v) => [{ type: "text", text: v }],
        },
        execute: () => {
          backgroundStarted = true;
          return background.promise;
        },
      }),
    );
    f.ctx.tools.register(
      defineTool({
        name: "moa_foreground",
        description: "held new direction",
        parameters: {},
        output: {
          schema: { type: "string" },
          render: (_a, v) => [{ type: "text", text: v }],
        },
        execute: () => {
          foregroundStarted = true;
          return foreground.promise;
        },
      }),
    );
    const root = await parent(f);
    const call = (name: string) => [
      {
        type: "block-start" as const,
        index: 0,
        blockType: "tool-call" as const,
      },
      {
        type: "tool-call-delta" as const,
        index: 0,
        id: name,
        name,
        argumentsDelta: "{}",
      },
      {
        type: "block-end" as const,
        index: 0,
        block: { type: "tool-call" as const, id: name, name, arguments: "{}" },
      },
      { type: "finish" as const, reason: { kind: "tool-calls" as const } },
    ];
    f.adapter.handler = (options) =>
      options.sessionId === root.id
        ? response("root summary")
        : ++workerSteps === 1
          ? call("moa_slow")
          : workerSteps === 2
            ? call("moa_foreground")
            : response("FULL FINAL RESULT");
    const controls: MoAAgents = (f.ctx.projectMode as any).moa;
    const host = (f.ctx.projectMode as any).access;
    const [receipt] = await controls.task(
      root,
      [
        {
          name: "transfer-worker",
          task: "initial assignment",
          role: "General-purpose",
          workspace: "shared",
        },
      ],
      "handoff",
      signal(),
    );
    await vi.waitFor(() => expect(backgroundStarted).toBe(true));
    const worker = f.ctx.agents.get(SessionId(receipt.workerId))!;
    worker.steer(
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "urgent new direction" }],
      }),
    );
    await vi.waitFor(() => expect(foregroundStarted).toBe(true));
    expect(
      worker.session
        .snapshotEvents()
        .filter((e) => e.type === "turn/end")
        .map((e) => e.data.reason.kind),
    ).toEqual(["handoff"]);
    expect(
      host
        .record(root.id)
        .completions.filter((c: any) => c.workerId === worker.id),
    ).toHaveLength(0);
    background.resolve("actual background result");
    foreground.resolve("new direction finished");
    await vi.waitFor(() =>
      expect(
        host
          .record(root.id)
          .completions.filter((c: any) =>
            c.assignmentIds.includes(receipt.assignmentId),
          ),
      ).toHaveLength(1),
    );
    expect(
      JSON.stringify(
        host
          .record(root.id)
          .completions.find((c: any) =>
            c.assignmentIds.includes(receipt.assignmentId),
          ),
      ),
    ).toContain("FULL FINAL RESULT");
  } finally {
    background.resolve("cleanup");
    foreground.resolve("cleanup");
    await f.dispose();
  }
});

it("shows native approval wait as Waiting, while ordinary model work remains Running", async () => {
  const f = await fixture();
  const model = Promise.withResolvers<void>();
  const answer = Promise.withResolvers<"allowed-once">();
  try {
    const { ApprovalService } = await import("@deepseek-ai/dsh-user-approval");
    await f.ctx.plugin(ApprovalService);
    f.ctx.on("approval/request", () => answer.promise);
    const root = await parent(f);
    f.adapter.handler = async (options) => {
      if (options.sessionId !== root.id) await model.promise;
      return response("done");
    };
    const controls: MoAAgents = (f.ctx.projectMode as any).moa;
    const [receipt] = await controls.task(
      root,
      [
        {
          name: "approval-worker",
          task: "work",
          role: "General-purpose",
          workspace: "shared",
        },
      ],
      "approval",
      signal(),
    );
    const worker = f.ctx.agents.get(SessionId(receipt.workerId))!;
    await vi.waitFor(() =>
      expect(
        worker.session.snapshotEvents().some((e) => e.type === "turn/start"),
      ).toBe(true),
    );
    const approval = f.ctx.approval.request({
      agent: worker,
      toolName: "write",
      reason: "native approval test",
    });
    expect(controls.lifecycle(worker)).toBe("Waiting");
    answer.resolve("allowed-once");
    await approval;
    expect(controls.lifecycle(worker)).toBe("Running");
  } finally {
    answer.resolve("allowed-once");
    model.resolve();
    await f.dispose();
  }
});

it("runs KillAgent hard continuation through the model tool, waits for cleanup, and records the new turn's update capsule", async () => {
  const f = await fixture();
  const cleanup = Promise.withResolvers<void>();
  try {
    const { defineTool } = await import("@deepseek-ai/dsh-tools");
    let oldStarted = false,
      aborted = false,
      rootSteps = 0,
      workerSteps = 0;
    f.ctx.tools.register(
      defineTool({
        name: "held_for_kill",
        description: "held native resource",
        parameters: {},
        output: {
          schema: { type: "string" },
          render: (_a, v) => [{ type: "text", text: v }],
        },
        async execute(_a, exec) {
          oldStarted = true;
          await new Promise<void>((resolve) =>
            exec.signal.addEventListener(
              "abort",
              () => {
                aborted = true;
                resolve();
              },
              { once: true },
            ),
          );
          await cleanup.promise;
          return "old resource exited";
        },
      }),
    );
    const root = await parent(f);
    const call = (name: string, args: string) => [
      {
        type: "block-start" as const,
        index: 0,
        blockType: "tool-call" as const,
      },
      {
        type: "tool-call-delta" as const,
        index: 0,
        id: name,
        name,
        argumentsDelta: args,
      },
      {
        type: "block-end" as const,
        index: 0,
        block: { type: "tool-call" as const, id: name, name, arguments: args },
      },
      { type: "finish" as const, reason: { kind: "tool-calls" as const } },
    ];
    let childId = "";
    f.adapter.handler = (options) =>
      options.sessionId === root.id
        ? ++rootSteps === 1
          ? call(
              "KillAgent",
              JSON.stringify({
                id: childId,
                continue_with: "replacement direction",
              }),
            )
          : response("root delivery")
        : ++workerSteps === 1
          ? call("held_for_kill", "{}")
          : response("replacement finished");
    const controls: MoAAgents = (f.ctx.projectMode as any).moa;
    const [receipt] = await controls.task(
      root,
      [
        {
          name: "worker",
          task: "old direction",
          role: "General-purpose",
          workspace: "shared",
        },
      ],
      "before-kill",
      signal(),
    );
    childId = receipt.workerId;
    await vi.waitFor(() => expect(oldStarted).toBe(true));
    root.followup(
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "change direction now" }],
      }),
    );
    await vi.waitFor(() => expect(aborted).toBe(true));
    expect(workerSteps).toBe(1);
    cleanup.resolve();
    await root.whenIdle();
    const record = (f.ctx.projectMode as any).access.record(root.id);
    expect(
      record.assignments.find(
        (a: any) => a.workerId === childId && a.coordinatorTurn === 1,
      ),
    ).toMatchObject({ admission: "accepted", delivery: "steer" });
    expect(
      record.memberships.some(
        (m: any) =>
          m.workerId === childId &&
          m.coordinatorTurn === 1 &&
          m.participationKind === "send",
      ),
    ).toBe(true);
    using observed = await f.ctx.sessionQuery.observeSession(
      SessionId(childId),
    );
    expect(
      observed.events
        .filter(
          (e) =>
            e.type === "user/message" && e.data.source.kind === "moa-message",
        )
        .map((e) => JSON.stringify(e.data)),
    ).toEqual([expect.stringContaining("replacement direction")]);
    expect(workerSteps).toBeGreaterThan(1);
    expect(
      record.completions.some((c: any) =>
        JSON.stringify(c.lastAssistant).includes("replacement finished"),
      ),
    ).toBe(true);
  } finally {
    cleanup.resolve();
    await f.dispose();
  }
});
