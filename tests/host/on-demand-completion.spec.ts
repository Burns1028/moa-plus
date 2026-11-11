import { expect, it } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage, type StreamChunk } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture, response } from "./fixture.ts";

const user = (text: string) =>
  createUserMessage({
    source: { kind: "user" },
    content: [{ type: "text", text }],
  });
const isHelper = (id: string) => /^moa-(builder|verifier)-/.test(id);
function call(name: string, args: object = {}): StreamChunk[] {
  const argumentsValue = JSON.stringify(args);
  return [
    { type: "block-start", index: 0, blockType: "tool-call" },
    {
      type: "block-end",
      index: 0,
      block: { type: "tool-call", id: "call", name, arguments: argumentsValue },
    },
    { type: "finish", reason: { kind: "tool-calls" } },
  ];
}
const rubric = () =>
  call("submit_rubric", {
    rubric: "- Deliver the original requested report [human requirement]",
    tests_required: false,
  });

it("activates helpers only for a bound human task and rejects later internal-only activation", async () => {
  const f = await fixture(undefined, { completionVerification: "on-demand" });
  try {
    const created: string[] = [];
    const helperBirths: { id: string; toolCalled: boolean }[] = [];
    let root: Awaited<ReturnType<typeof f.ctx.agents.create>>["agent"];
    f.ctx.on("agent/created", ({ agent }) => {
      created.push(agent.id);
      if (isHelper(agent.id))
        helperBirths.push({
          id: agent.id,
          toolCalled: root.session
            .snapshotEvents()
            .some(
              (event) =>
                event.type === "tool/call" &&
                event.data.name === "set_completion_criteria",
            ),
        });
    });
    ({ agent: root } = await f.ctx.agents.create({
      sessionId: SessionId("on-demand-main"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    }));
    await f.ctx.projectMode.setEnabled(root.id, true, 0, "enable");
    const candidate = "The requested complete report. EXACT PROMISE";
    let main = 0,
      verifier = 0;
    f.adapter.handler = (options) => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) {
        expect(options.tools?.map((tool) => tool.name)).toEqual([
          "submit_rubric",
        ]);
        return rubric();
      }
      if (id.startsWith("moa-verifier-")) {
        expect(options.tools?.map((tool) => tool.name)).not.toContain(
          "set_completion_criteria",
        );
        if (++verifier === 1) return call("read_rubric");
        if (verifier === 2) return call("read_candidate");
        const evidence = options.messages.findLast(
          (message) => message.role === "tool",
        );
        expect(evidence?.role === "tool" && !evidence.isError).toBe(true);
        expect(
          evidence?.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join(""),
        ).toBe(candidate);
        return call("submit_verdict", { status: "Pass", issues: [] });
      }
      main++;
      if (main <= 2) expect(created).toEqual([root.id]);
      if (main === 1) {
        const tool = options.tools?.find(
          (tool) => tool.name === "set_completion_criteria",
        );
        expect(tool?.parameters).toMatchObject({
          required: ["criteria", "promise"],
          properties: {
            criteria: { type: "string" },
            promise: { type: "string" },
          },
        });
        return call("set_completion_criteria", {
          criteria: "Deliver the report",
          promise: "EXACT PROMISE",
        });
      }
      if (main === 4)
        return call("set_completion_criteria", {
          criteria: "Internal notice must not resurrect a completed task",
          promise: "ORPHAN PROMISE",
        });
      if (main === 5) {
        const result = options.messages.findLast(
          (message) => message.role === "tool",
        );
        expect(result).toMatchObject({ role: "tool", isError: true });
        expect(
          result?.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join(""),
        ).toContain("No unfinished human task");
        return response("Internal notice handled.");
      }
      return response(main === 2 ? candidate : "收到。");
    };
    root.followup(user("Deliver the report in your final answer"));
    await root.whenIdle();
    expect(main).toBe(2);
    expect(verifier).toBe(3);
    expect(helperBirths).toHaveLength(2);
    expect(helperBirths.every((birth) => birth.toolCalled)).toBe(true);
    expect(created.filter((id) => id.startsWith("moa-builder-"))).toHaveLength(
      1,
    );
    expect(created.filter((id) => id.startsWith("moa-verifier-"))).toHaveLength(
      1,
    );
    expect(await readFile(join(f.root, "rubrics.md"), "utf8")).toContain(
      "original requested report",
    );
    await f.ctx.projectMode.snapshot(root.id);
    const requests = f.adapter.requests.length;
    root.followup(user("123"));
    await root.whenIdle();
    expect(f.adapter.requests).toHaveLength(requests + 1);
    expect(created).toHaveLength(3);
    expect(
      root.session
        .snapshotEvents()
        .filter((event) => event.type === "turn/end"),
    ).toMatchObject([
      { data: { reason: { kind: "completed" } } },
      { data: { reason: { kind: "completed" } } },
    ]);
    await f.ctx.projectMode.snapshot(root.id);
    const record = () => (f.ctx.projectMode as any).access.record(root.id);
    const finishedInput = structuredClone(
      record().operations["moa:completion-input"],
    );
    expect(finishedInput).toMatchObject({ finished: true });
    root.steer(
      createUserMessage({
        source: {
          kind: "moa-completion",
          form: "notice",
          summary: "Owned internal notice",
        },
        content: [
          { type: "text", text: "Internal update without a new human task" },
        ],
      }),
    );
    await root.whenIdle();
    await f.ctx.projectMode.snapshot(root.id);
    expect(main).toBe(5);
    expect(f.adapter.requests).toHaveLength(requests + 3);
    expect(created).toHaveLength(3);
    expect(record().operations["moa:completion-input"]).toEqual(finishedInput);
    expect(
      record().operations[`moa:completion-criteria:${root.id}`],
    ).toBeUndefined();
    expect(
      root.session
        .snapshotEvents()
        .findLast((event) => event.type === "turn/end"),
    ).toMatchObject({ data: { reason: { kind: "completed" } } });
  } finally {
    await f.dispose();
  }
});

it("retains the initial human specification when the Coordinator enables verification after implementation", async () => {
  const f = await fixture(undefined, { completionVerification: "on-demand" });
  try {
    await writeFile(join(f.root, "spec.md"), "ORIGINAL HUMAN SPECIFICATION");
    f.ctx.tools.register(
      defineTool({
        name: "implement_spec",
        description: "Update the owned implementation",
        parameters: {},
        output: {
          schema: { type: "string" },
          render: (_, value: string) => [{ type: "text", text: value }],
        },
        execute: async () => {
          await writeFile(
            join(f.root, "spec.md"),
            "IMPLEMENTATION MUST NOT BECOME ORIGINAL REQUIREMENTS",
          );
          return "Implementation updated";
        },
      }),
    );
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("on-demand-late-binding"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let main = 0,
      verifier = 0;
    const builderInputs: string[] = [];
    f.adapter.handler = (options) => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) {
        builderInputs.push(JSON.stringify(options.messages));
        return rubric();
      }
      if (id.startsWith("moa-verifier-")) {
        if (++verifier === 1) return call("read_rubric");
        if (verifier === 2) return call("read_candidate");
        return call("submit_verdict", { status: "Pass", issues: [] });
      }
      expect(builderInputs).toEqual([]);
      if (++main === 1) return call("implement_spec");
      if (main === 2)
        return call("set_completion_criteria", {
          criteria: "MODEL CRITERIA MUST NOT REPLACE HUMAN REQUIREMENTS",
          promise: "LATE PROMISE",
        });
      return response("AI CANDIDATE SECRET. LATE PROMISE");
    };
    agent.followup(user("Deliver the original report specified in `spec.md`"));
    await agent.whenIdle();
    expect(main).toBe(3);
    expect(builderInputs).toHaveLength(1);
    expect(builderInputs[0]).toContain("ORIGINAL HUMAN SPECIFICATION");
    expect(builderInputs[0]).not.toContain("IMPLEMENTATION MUST NOT");
    expect(builderInputs[0]).not.toContain("MODEL CRITERIA MUST NOT");
    expect(builderInputs[0]).not.toContain("AI CANDIDATE SECRET");
    expect(
      agent.session
        .snapshotEvents()
        .findLast((event) => event.type === "turn/end"),
    ).toMatchObject({ data: { reason: { kind: "completed" } } });
  } finally {
    await f.dispose();
  }
});

it("preserves an activated task and original sources across Stop and native restart", async () => {
  let f = await fixture(undefined, {
    completionVerification: "on-demand",
    keepFiles: true,
  });
  try {
    let { agent } = await f.ctx.agents.create({
      sessionId: SessionId("on-demand-restart"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    await writeFile(
      join(f.root, "original spec.md"),
      "ORIGINAL STOPPED TASK SNAPSHOT",
    );
    let main = 0;
    f.adapter.handler = (options) => {
      expect(isHelper(String(options.sessionId))).toBe(false);
      if (++main === 1)
        return call("set_completion_criteria", {
          criteria: "Meet the original report requirements",
          promise: "PERSISTED PROMISE",
        });
      agent.cancel({ kind: "user" });
      return response("unfinished");
    };
    agent.followup(user("Complete the report in `original spec.md`"));
    await agent.whenIdle();
    const root = f.root;
    const id = agent.id;
    expect(
      agent.session
        .snapshotEvents()
        .some(
          (event) =>
            event.type === "tool/result" && !event.data.message.isError,
        ),
    ).toBe(true);
    await f.dispose();
    await writeFile(
      join(root, "original spec.md"),
      "REPLACEMENT MUST NOT BECOME ORIGINAL REQUIREMENT",
    );
    f = await fixture(undefined, { root, completionVerification: "on-demand" });
    ({ agent } = await f.ctx.agents.resume({
      resumeSessionId: id,
      agentOptions: { provider: "test", model: "test" },
    }));
    let resumed = 0,
      verified = 0,
      built = 0;
    f.adapter.handler = (options) => {
      const sessionId = String(options.sessionId);
      if (sessionId.startsWith("moa-builder-")) {
        built++;
        const input = JSON.stringify(options.messages);
        expect(input).toContain("ORIGINAL STOPPED TASK SNAPSHOT");
        expect(input).not.toContain("REPLACEMENT MUST NOT");
        return rubric();
      }
      if (sessionId.startsWith("moa-verifier-")) {
        if (++verified === 1) return call("read_rubric");
        if (verified === 2) return call("read_candidate");
        return call("submit_verdict", { status: "Pass", issues: [] });
      }
      if (++resumed === 1) return response("Candidate missing its promise");
      expect(JSON.stringify(options.messages)).toContain("PERSISTED PROMISE");
      return response("PERSISTED PROMISE");
    };
    agent.followup(user("Continue the stopped task"));
    await agent.whenIdle();
    expect(resumed).toBe(2);
    expect(built).toBe(1);
    expect(verified).toBe(3);
    expect(
      agent.session
        .snapshotEvents()
        .findLast((event) => event.type === "turn/end"),
    ).toMatchObject({ data: { reason: { kind: "completed" } } });
  } finally {
    await f.dispose();
  }
});

it("finishes a task across a non-human background handoff before capturing the next task", async () => {
  const f = await fixture(undefined, {
    completionVerification: "on-demand",
    backgroundStrategy: "new-message",
    backgroundAfterSeconds: 0,
  });
  const entered = Promise.withResolvers<void>();
  const result = Promise.withResolvers<string>();
  const continued = Promise.withResolvers<void>();
  const releaseCandidate = Promise.withResolvers<void>();
  try {
    f.ctx.tools.register(
      defineTool({
        name: "held_work",
        description: "Hold owned work until the native background handoff",
        parameters: {},
        output: {
          schema: { type: "string" },
          render: (_, value: string) => [{ type: "text", text: value }],
        },
        execute: async () => {
          entered.resolve();
          return result.promise;
        },
      }),
    );
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("on-demand-handoff"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let firstSteps = 0,
      secondBound = false;
    const builderInputs: string[] = [];
    const verifierSteps = new Map<string, number>();
    f.adapter.handler = async (options) => {
      const id = String(options.sessionId);
      if (id.startsWith("moa-builder-")) {
        builderInputs.push(JSON.stringify(options.messages));
        return rubric();
      }
      if (id.startsWith("moa-verifier-")) {
        const step = (verifierSteps.get(id) ?? 0) + 1;
        verifierSteps.set(id, step);
        if (step === 1) return call("read_rubric");
        if (step === 2) return call("read_candidate");
        return call("submit_verdict", { status: "Pass", issues: [] });
      }
      const human = options.messages.findLast(
        (message) => message.source.kind === "user",
      );
      const current =
        human?.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("") ?? "";
      if (current.includes("SECOND INDEPENDENT TASK")) {
        if (!secondBound) {
          secondBound = true;
          return call("set_completion_criteria", {
            criteria: "Deliver the new report",
            promise: "SECOND PROMISE",
          });
        }
        return response("SECOND PROMISE");
      }
      if (++firstSteps === 1)
        return call("set_completion_criteria", {
          criteria: "Deliver the first report",
          promise: "FIRST PROMISE",
        });
      if (firstSteps === 2) return call("held_work");
      continued.resolve();
      await releaseCandidate.promise;
      return response("FIRST PROMISE");
    };
    agent.followup(user("FIRST HANDOFF TASK: deliver the first report"));
    await entered.promise;
    agent.steer(
      createUserMessage({
        source: {
          kind: "moa-completion",
          form: "notice",
          summary: "Owned internal progress",
        },
        content: [
          {
            type: "text",
            text: "Internal progress changed while the tool runs",
          },
        ],
      }),
    );
    await continued.promise;
    result.resolve("Complete owned background result");
    releaseCandidate.resolve();
    await agent.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    const firstEnds = agent.session
      .snapshotEvents()
      .filter((event) => event.type === "turn/end");
    expect(firstEnds).toMatchObject([
      { data: { turn: 1, reason: { kind: "handoff" } } },
      { data: { turn: 2, reason: { kind: "completed" } } },
    ]);
    expect(builderInputs).toHaveLength(1);
    agent.followup(user("SECOND INDEPENDENT TASK: deliver a different report"));
    await agent.whenIdle();
    expect(builderInputs).toHaveLength(2);
    expect(builderInputs[0]).toContain("FIRST HANDOFF TASK");
    expect(builderInputs[1]).toContain("SECOND INDEPENDENT TASK");
    expect(builderInputs[1]).not.toContain("FIRST HANDOFF TASK");
    expect(builderInputs[1]).not.toContain("Internal progress changed");
    expect(
      agent.session
        .snapshotEvents()
        .findLast((event) => event.type === "turn/end"),
    ).toMatchObject({ data: { reason: { kind: "completed" } } });
  } finally {
    result.resolve("cleanup");
    releaseCandidate.resolve();
    await f.dispose();
  }
});

it("lets a Worker bind its exact promise without creating recursive outcome helpers", async () => {
  const f = await fixture(undefined, { completionVerification: "on-demand" });
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("on-demand-worker-parent"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(agent.id, true, 0, "enable");
    let worker = 0;
    f.adapter.handler = (options) => {
      expect(isHelper(String(options.sessionId))).toBe(false);
      if (options.sessionId === agent.id)
        return response("Worker result reviewed");
      if (++worker === 1)
        return call("set_completion_criteria", {
          criteria: "Deliver the assigned report",
          promise: "WORKER PROMISE",
        });
      if (worker === 2) return response("Candidate missing its promise");
      expect(JSON.stringify(options.messages)).toContain("WORKER PROMISE");
      return response("WORKER PROMISE");
    };
    const result = (await f.ctx.projectMode.controlForAgent(
      agent,
      { action: "spawn", name: "worker", task: "Deliver the assigned report" },
      "spawn",
      new AbortController().signal,
    )) as { workerId: SessionId };
    await f.ctx.agents.get(result.workerId)?.whenIdle();
    await f.ctx.projectMode.snapshot(agent.id);
    await agent.whenIdle();
    expect(worker).toBe(3);
    expect(
      f.adapter.requests.some((options) => isHelper(String(options.sessionId))),
    ).toBe(false);
  } finally {
    await f.dispose();
  }
});
