import { expect, it } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { AttachmentId } from "@deepseek-ai/dsh-attachment";
import { createUserMessage, type ContentBlock } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type {} from "@deepseek-ai/dsh-tool-present/types";
import type { HostAccess } from "../../packages/project-mode/src/host/host-access.ts";
import { readWorkerTimeline } from "../../packages/project-mode/src/host/worker-timeline.ts";
import type { AgentDescriptor } from "../../packages/project-mode/src/host/moa/agents.ts";
import type { RecordState } from "../../packages/project-mode/src/host/state.ts";
import { fixture, response } from "./fixture.ts";

it("projects only the complete authored MoA prefix and preserves raw text and attachments", async () => {
  const parentId = SessionId("timeline-presentation-parent");
  const workerId = SessionId("timeline-presentation-worker");
  const source = {
    kind: "moa-message" as const,
    form: "relay" as const,
    rootId: parentId,
    senderId: parentId,
    operationId: "message",
    requestId: "request-1",
    replyTo: "request-0",
  };
  const prefix = `Request ID: request-1\nReply to: request-0\nFrom: ${parentId}\n`;
  const body =
    "## Task\n\nFrom: a quoted user message\nRequest ID: keep this\n";
  const file: ContentBlock = {
    type: "file",
    attachment: {
      attachmentId: AttachmentId("f".repeat(64)),
      name: "original notes.md",
      bytes: 17,
    },
  };
  const messages = [
    createUserMessage({
      source,
      content: [
        { type: "text", text: prefix + body },
        file,
        { type: "text", text: "\nTail stays exact.  " },
      ],
    }),
    createUserMessage({
      source: { ...source, requestId: undefined, replyTo: undefined },
      content: [{ type: "text", text: `From: ${parentId}\n${body}` }],
    }),
    createUserMessage({
      source: { kind: "user" },
      content: [{ type: "text", text: prefix + body }],
    }),
    createUserMessage({
      source: {
        kind: "project-mode-assignment",
        form: "relay",
        operationId: "assignment",
        coordinatorSessionId: parentId,
      },
      content: [{ type: "text", text: prefix + body }],
    }),
    createUserMessage({
      source: { ...source, senderId: "another-agent" },
      content: [{ type: "text", text: prefix + body }],
    }),
    createUserMessage({
      source: { ...source, requestId: "different-request" },
      content: [{ type: "text", text: prefix + body }],
    }),
    createUserMessage({
      source,
      content: [file, { type: "text", text: prefix + body }],
    }),
    createUserMessage({
      source,
      content: [
        { type: "text", text: "Request ID: request-1\n" },
        {
          type: "text",
          text: `Reply to: request-0\nFrom: ${parentId}\n${body}`,
        },
      ],
    }),
    createUserMessage({ source, content: [{ type: "text", text: prefix }] }),
  ];
  let disposed = false;
  const host = {
    record: () => ({
      project: { coordinatorSessionId: parentId },
      assignments: [],
    }),
    worker: () => ({ lifecycle: "active" }),
    view: async () => ({ status: "idle" }),
    ctx: {
      get: () => undefined,
      sessionQuery: {
        observeSession: async () => ({
          inheritedEventCount: 0,
          header: { cwd: "/workspace" },
          cursor: messages.length + 2,
          events: [
            { type: "turn/start", seq: 0, time: 10, data: { turn: 1 } },
            ...messages.map((data, index) => ({
              type: "user/message",
              seq: index + 1,
              time: 11 + index,
              data,
            })),
            {
              type: "turn/end",
              seq: messages.length + 1,
              time: 30,
              data: { turn: 1, reason: { kind: "completed" } },
            },
          ],
          [Symbol.dispose]() {
            disposed = true;
          },
        }),
      },
    },
  } as unknown as HostAccess;
  const page = await readWorkerTimeline(
    host,
    parentId,
    workerId,
    10,
    new AbortController().signal,
  );
  const inputs = page.turns[0].inputs;
  expect(inputs.map((message) => message.text)).toEqual(
    messages.map((message) =>
      message.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join(""),
    ),
  );
  expect(inputs.map((message) => message.displayText)).toEqual([
    body + "\nTail stays exact.  ",
    body,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    "",
  ]);
  expect(inputs[0].attachments).toEqual([
    { type: "file", attachment: file.attachment },
  ]);
  expect(inputs[6].attachments).toEqual(inputs[0].attachments);
  expect(inputs[0].actor).toBe("coordinator");
  expect(inputs[2].actor).toBe("user");
  expect(disposed).toBe(true);
});

it("removes the exact initial identity only from its accepted native birth message", async () => {
  const f = await fixture();
  try {
    const { agent: parent } = await f.ctx.agents.create({
      sessionId: SessionId("timeline-birth-parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(parent.id, true, 0, "enable");
    const service = f.ctx.projectMode as any;
    const host = service.access as HostAccess;
    const task =
      "## Prepare report\n\nAgent ID: this quoted user text stays.\nWorkdir: keep this too.\n";
    const [result] = await service.moa.task(
      parent,
      [
        {
          name: "writer",
          task,
          role: "General-purpose",
          workspace: "shared",
        },
      ],
      "birth",
      new AbortController().signal,
    );
    const workerId = SessionId(result.workerId);
    await expect
      .poll(() =>
        host
          .record(parent.id)
          ?.completions.find((value) => value.workerId === workerId),
      )
      .toBeDefined();
    await parent.whenIdle();
    const record = host.record(parent.id)!;
    const worker = host.worker(record, workerId);
    const assignment = record.assignments.find(
      (value) => value.operationId === worker.creationOperationId,
    )!;
    using observed = await f.ctx.sessionQuery.observeSession(workerId);
    const birth = observed.events.find(
      (event) =>
        event.type === "user/message" && event.data.id === assignment.messageId,
    )!;
    expect(birth).toMatchObject({
      type: "user/message",
      data: { source: { kind: "user" } },
    });
    const requestsBeforeRead = f.adapter.requests.length;
    const read = (snapshot = record) =>
      readWorkerTimeline(
        Object.assign(Object.create(host), {
          record: () => snapshot,
        }) as HostAccess,
        parent.id,
        workerId,
        10,
        new AbortController().signal,
      );
    const input = (await read()).turns[0].inputs[0];
    expect(input.text).toContain(
      `Agent ID: ${workerId}\nWorkdir: ${f.root} (Shared)\nReport to: ${parent.id}\nReporting instructions: `,
    );
    expect(input.text.endsWith(`\n\n${task}`)).toBe(true);
    expect(input.displayText).toBe(task);
    expect(input.actor).toBe("coordinator");
    const descriptorKey = `moa:agent:${workerId}`;
    const descriptor = record.operations[
      descriptorKey
    ] as unknown as AgentDescriptor;
    const { [descriptorKey]: _removed, ...withoutDescriptor } =
      record.operations;
    const variants: RecordState[] = [
      { ...record, operations: withoutDescriptor },
      {
        ...record,
        assignments: record.assignments.map((value) =>
          value === assignment
            ? { ...value, messageId: "not-the-birth-message" }
            : value,
        ),
      },
      {
        ...record,
        assignments: record.assignments.map((value) =>
          value === assignment
            ? { ...value, operationId: "not-the-creation-operation" }
            : value,
        ),
      },
      {
        ...record,
        assignments: record.assignments.map((value) =>
          value === assignment
            ? { ...value, participationKind: "send" }
            : value,
        ),
      },
      {
        ...record,
        operations: {
          ...record.operations,
          [descriptorKey]: { ...descriptor, reportTo: "changed-reporter" },
        },
      },
      {
        ...record,
        operations: {
          ...record.operations,
          [descriptorKey]: {
            ...descriptor,
            workspace: {
              ...descriptor.workspace!,
              directory: "unknown-relative-directory",
            },
          },
        },
      },
    ] as RecordState[];
    for (const snapshot of variants) {
      const unchanged = (await read(snapshot)).turns[0].inputs[0];
      expect(unchanged.text).toBe(input.text);
      expect(unchanged.displayText).toBeUndefined();
    }
    expect(f.adapter.requests).toHaveLength(requestsBeforeRead);
  } finally {
    await f.dispose();
  }
});

it("streams native turns newest first with visible dialogue and recorded artifacts, including empty failures", async () => {
  const f = await fixture();
  try {
    expect(typeof (f.ctx.projectMode as any).timeline).toBe("function");
    f.ctx.tools.register(
      defineTool({
        name: "timeline_probe",
        description: "Record an artifact",
        parameters: {},
        output: {
          schema: { type: "string" },
          render: () => [{ type: "text", text: "INTERNAL_TOOL_RESULT" }],
          presentationMeta: () => ({
            path: "report.md",
            diffs: [{ path: "report.md", oldText: null, newText: "report" }],
          }),
        },
        execute: async (_args, exec) => {
          exec.agent!.session.append("deliverables/presented", {
            turn: 1,
            callId: exec.callId,
            files: [{ path: "final.pdf", description: "Final document" }],
          });
          return "ok";
        },
      }),
    );
    const { agent: parent } = await f.ctx.agents.create({
      sessionId: SessionId("timeline-parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(parent.id, true, 0, "enable");
    let workerCalls = 0;
    f.adapter.handler = (request) => {
      if (request.sessionId === parent.id) return response("reviewed");
      if (workerCalls++ > 1) throw new Error("no AI reply");
      if (workerCalls === 2) return response("FIRST_FINAL");
      return [
        ...response("VISIBLE_INTERMEDIATE").slice(0, -1),
        { type: "block-start", index: 1, blockType: "tool-call" },
        {
          type: "tool-call-delta",
          index: 1,
          id: "probe",
          name: "timeline_probe",
          argumentsDelta: "{}",
        },
        {
          type: "block-end",
          index: 1,
          block: {
            type: "tool-call",
            id: "probe",
            name: "timeline_probe",
            arguments: "{}",
          },
        },
        { type: "finish", reason: { kind: "tool-calls" } },
      ];
    };
    const signal = new AbortController().signal;
    const receipt = (await f.ctx.projectMode.controlForAgent(
      parent,
      { action: "spawn", name: "writer", task: "FIRST_INPUT" },
      "spawn",
      signal,
    )) as { workerId: SessionId };
    const childId = receipt.workerId;
    await f.ctx.agents.get(childId)?.whenIdle();
    await f.ctx.projectMode.snapshot(parent.id);
    await parent.whenIdle();
    await f.ctx.projectMode.controlForAgent(
      parent,
      {
        action: "send",
        worker_id: childId,
        message: "SECOND_INPUT",
        delivery: "queue",
      },
      "second",
      signal,
    );
    await f.ctx.agents.get(childId)?.whenIdle();
    await f.ctx.projectMode.snapshot(parent.id);
    await parent.whenIdle();
    const before = f.adapter.requests.length;
    const controller = new AbortController();
    const stream = (f.ctx.projectMode as any)
      .timeline(parent.id, childId, 10, controller.signal)
      [Symbol.asyncIterator]();
    const page = (await stream.next()).value;
    expect(page).toMatchObject({
      workerId: childId,
      total: 2,
      hasMore: false,
    });
    expect(page.turns.map((turn: any) => turn.turn)).toEqual([2, 1]);
    expect(page.turns[0]).toMatchObject({
      outcome: "error",
      outputs: [],
      inputs: [{ text: "SECOND_INPUT", actor: "coordinator" }],
    });
    expect(page.turns[1]).toMatchObject({
      outcome: "completed",
      inputs: [{ text: "FIRST_INPUT", actor: "coordinator" }],
    });
    expect(page.turns[1].outputs.map((message: any) => message.text)).toEqual([
      "FIRST_FINAL",
    ]);
    expect(page.turns[1].artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "report.md", kind: "changed" }),
        expect.objectContaining({
          path: "final.pdf",
          kind: "presented",
          description: "Final document",
        }),
      ]),
    );
    expect(
      page.turns.every(
        (turn: any) => turn.startedAt > 0 && turn.finishedAt >= turn.startedAt,
      ),
    ).toBe(true);
    expect(JSON.stringify(page)).not.toContain("INTERNAL_TOOL_RESULT");
    expect(f.adapter.requests).toHaveLength(before);
    const updated = stream.next();
    f.adapter.handler = (request) =>
      response(request.sessionId === parent.id ? "reviewed" : "THIRD_FINAL");
    await f.ctx.projectMode.controlForAgent(
      parent,
      {
        action: "send",
        worker_id: childId,
        message: "THIRD_INPUT",
        delivery: "queue",
      },
      "third",
      signal,
    );
    await f.ctx.agents.get(childId)?.whenIdle();
    await f.ctx.projectMode.snapshot(parent.id);
    await parent.whenIdle();
    let latest = (await updated).value;
    for (let i = 0; i < 8 && latest.turns[0]?.outcome !== "completed"; i++)
      latest = (await stream.next()).value;
    expect(latest.turns[0]).toMatchObject({
      turn: 3,
      outcome: "completed",
      outputs: [{ text: "THIRD_FINAL" }],
    });
    const pending = stream.next();
    controller.abort();
    expect((await pending).done).toBe(true);
  } finally {
    await f.dispose();
  }
});
