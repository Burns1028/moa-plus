/** Test-only model adapter. It never drives Agents, invokes tools, or writes Session state. */
import { LlmAdapter } from "@deepseek-ai/dsh-llm";
import { appendFile, access, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const name = "project-mode-acceptance-provider";
export const inject = ["llm", "agents", "tools", "sessions"];
export const PROVIDER = "project-mode-acceptance";
export const MODEL = "acceptance";
const nativeDelegation = [
  "subagent",
  "subagent_fork",
  "list_agents",
  "send_message",
  "interrupt_agent",
  "list_subagent_models",
];
const textOf = (message) =>
  (message.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
const hasFile = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};
const toolsOf = (schemas) => schemas.map((t) => t.name).sort();
const abortCheck = (signal) => signal?.throwIfAborted();

export function workerFinal(scenario, label, sequence) {
  return (
    `PM_WORKER_FINAL_BEGIN scenario=${scenario} worker=${label} sequence=${sequence}\n` +
    Array.from(
      { length: 64 },
      (_, i) =>
        `Evidence ${String(i + 1).padStart(3, "0")}: native worker response preserved end to end; ${scenario}/${label}/${sequence}.`,
    ).join("\n") +
    `\nPM_WORKER_FINAL_END scenario=${scenario} worker=${label} sequence=${sequence}`
  );
}

export class AcceptanceAdapter extends LlmAdapter {
  constructor(ctx, config, record) {
    super();
    this.ctx = ctx;
    this.config = config;
    this.record = record;
    this.sessions = new Map();
    this.calls = new Map();
    this.workerCalls = new Map();
  }
  providerInfo(provider) {
    return { id: provider, name: "MoA Acceptance (scripted model)" };
  }
  async listModels(provider) {
    return [
      {
        provider,
        id: MODEL,
        name: "Acceptance — deterministic model only",
        inputModalities: ["text"],
      },
    ];
  }
  async resolveModel(provider, model) {
    if (provider !== PROVIDER || model !== MODEL)
      throw new Error("Unknown acceptance model");
    return {
      ...(await this.listModels(provider))[0],
      context: { contextWindow: 131072 },
      defaultMaxTokens: 16384,
    };
  }
  async *text(text, signal, paced = true) {
    yield { type: "block-start", index: 0, blockType: "text" };
    const pieces = paced
      ? (text.match(/.{1,160}(?:\n|$)|.{1,160}/gs) ?? [text])
      : [text];
    for (const piece of pieces) {
      abortCheck(signal);
      yield { type: "text-delta", index: 0, text: piece };
      if (paced && this.config.chunkDelayMs)
        await delay(this.config.chunkDelayMs, undefined, { signal });
    }
    yield { type: "block-end", index: 0, block: { type: "text", text } };
    yield { type: "finish", reason: { kind: "stop" } };
  }
  async *toolCalls(requests, options) {
    if (!(options.tools ?? []).some((t) => t.name === "control_workers")) {
      throw new Error(
        "Acceptance requires native direct control_workers presentation; choose Standard preset and enable MoA.",
      );
    }
    for (let index = 0; index < requests.length; index++) {
      abortCheck(options.signal);
      const id = `pm-accept-${options.sessionId}-${this.calls.get(options.sessionId)}-${index}`;
      const argumentsText = JSON.stringify(requests[index]);
      yield { type: "block-start", index, blockType: "tool-call" };
      yield {
        type: "tool-call-delta",
        index,
        id,
        name: "control_workers",
        argumentsDelta: argumentsText,
      };
      yield {
        type: "block-end",
        index,
        block: {
          type: "tool-call",
          id,
          name: "control_workers",
          arguments: argumentsText,
        },
      };
    }
    yield { type: "finish", reason: { kind: "tool-calls" } };
  }
  async waitGate(scenario, signal) {
    const path = join(this.config.controlRoot, scenario, "release");
    await this.record({ kind: "gate-wait", scenario, path });
    while (!(await hasFile(path))) {
      abortCheck(signal);
      await delay(100, undefined, { signal });
    }
    abortCheck(signal);
  }
  async *worker(options) {
    const assignments = options.messages.filter(
      (m) =>
        ["project-mode-assignment", "user"].includes(m.source?.kind) &&
        /\[PM WORK /.test(textOf(m)),
    );
    const latest = assignments.at(-1);
    const marker = textOf(latest ?? {}).match(
      /\[PM WORK (normal|queue|stop|reuse|steer) ([\w-]+)\]/,
    );
    if (!marker)
      throw new Error("MoA worker request has no acceptance assignment marker");
    const [, scenario, label] = marker;
    const sequence = (this.workerCalls.get(options.sessionId) ?? 0) + 1;
    this.workerCalls.set(options.sessionId, sequence);
    await this.record({
      kind: "worker-start",
      sessionId: options.sessionId,
      scenario,
      label,
      sequence,
    });
    // A real open assistant stream supplies visible live progress before the gate.
    const prefix = `PM_WORKER_PROGRESS ${scenario}/${label}/${sequence}: running in native child session.\n`;
    yield { type: "block-start", index: 0, blockType: "text" };
    yield { type: "text-delta", index: 0, text: prefix };
    await this.waitGate(scenario, options.signal);
    const final = workerFinal(scenario, label, sequence);
    for (const piece of final.match(/.{1,160}(?:\n|$)|.{1,160}/gs) ?? [final]) {
      abortCheck(options.signal);
      yield { type: "text-delta", index: 0, text: piece };
      if (this.config.chunkDelayMs)
        await delay(this.config.chunkDelayMs, undefined, {
          signal: options.signal,
        });
    }
    yield {
      type: "block-end",
      index: 0,
      block: { type: "text", text: prefix + final },
    };
    await this.record({
      kind: "worker-final",
      sessionId: options.sessionId,
      scenario,
      label,
      sequence,
      chars: (prefix + final).length,
      tail: final.split("\n").at(-1),
    });
    yield { type: "finish", reason: { kind: "stop" } };
  }
  learnReceipts(options, state) {
    const calls = new Map();
    for (const message of options.messages)
      for (const block of message.content ?? []) {
        if (block.type === "tool-call" && block.name === "control_workers") {
          try {
            calls.set(block.id, JSON.parse(block.arguments));
          } catch {
            /* diagnostics below expose missing receipt */
          }
        }
      }
    for (const message of options.messages) {
      if (message.role !== "tool") continue;
      const call = calls.get(message.source?.callId);
      if (
        call?.action !== "spawn" ||
        !call.task.includes(`[PM WORK ${state.scenario} `)
      )
        continue;
      try {
        const receipt = JSON.parse(textOf(message));
        if (
          receipt.accepted &&
          receipt.workerId &&
          !state.workerIds.includes(receipt.workerId)
        )
          state.workerIds.push(receipt.workerId);
      } catch {
        /* a native tool failure is reported by the bounded missing-receipt check */
      }
    }
  }
  async *parent(options) {
    const markerMessages = options.messages.filter(
      (m) =>
        m.role === "user" &&
        m.source?.kind === "user" &&
        /\[PM ACCEPT (normal|queue|stop|reuse|probe|steer)\]/.test(textOf(m)),
    );
    const latest = markerMessages.at(-1);
    const scenario = textOf(latest ?? {}).match(
      /\[PM ACCEPT (normal|queue|stop|reuse|probe|steer)\]/,
    )?.[1];
    if (!scenario) {
      yield* this.text(
        "Acceptance adapter ready. Use [PM ACCEPT normal], [PM ACCEPT queue], [PM ACCEPT stop], [PM ACCEPT reuse], or [PM ACCEPT probe].",
        options.signal,
      );
      return;
    }
    let state = this.sessions.get(options.sessionId);
    const markerId = latest.id ?? textOf(latest);
    if (state?.markerId !== markerId) {
      state = {
        markerId,
        scenario,
        phase: "initial",
        workerIds: [],
        previousWorkerIds: state?.workerIds ?? [],
        baselineResultIds: new Set(
          options.messages
            .filter((m) => m.source?.kind === "project-mode-result")
            .map((m) => m.id),
        ),
        checks: 0,
      };
      this.sessions.set(options.sessionId, state);
    }
    if (scenario === "probe") {
      yield* this.text(
        `PM_PROBE effective_tools=${toolsOf(options.tools ?? []).join(",")}\nMoA role present=${options.messages.some((m) => textOf(m).includes("MoA coordinator"))}`,
        options.signal,
      );
      return;
    }
    if (state.phase === "initial") {
      state.phase = "dispatched";
      if (scenario === "reuse") {
        const workerId = state.previousWorkerIds[0];
        if (!workerId)
          throw new Error(
            "Reuse requires a completed scenario in this same coordinator session.",
          );
        state.workerIds = [workerId];
        yield* this.toolCalls(
          [
            {
              action: "send",
              worker_id: workerId,
              message: "[PM WORK reuse existing] Complete this new assignment.",
              delivery: "queue",
            },
          ],
          options,
        );
      } else {
        const labels = scenario === "normal" ? ["alpha", "beta"] : ["first"];
        yield* this.toolCalls(
          labels.map((label) => ({
            action: "spawn",
            name: `acceptance-${scenario}-${label}`,
            task: `[PM WORK ${scenario} ${label}] Complete this deterministic native acceptance assignment.`,
          })),
          options,
        );
      }
      return;
    }
    this.learnReceipts(options, state);
    if (
      state.phase === "dispatched" &&
      ["queue", "stop", "steer"].includes(scenario)
    ) {
      if (!state.workerIds.length)
        throw new Error(
          "Native spawn receipt missing workerId; refusing to fabricate a child identity.",
        );
      state.phase = "queued";
      yield* this.toolCalls(
        [
          {
            action: "send",
            worker_id: state.workerIds[0],
            message: `[PM WORK ${scenario} second] Complete the second worker assignment.`,
            delivery: scenario === "steer" ? "steer" : "queue",
          },
        ],
        options,
      );
      return;
    }
    const results = options.messages.filter(
      (m) =>
        m.source?.kind === "project-mode-result" &&
        !state.baselineResultIds.has(m.id) &&
        state.workerIds.includes(m.source.workerId),
    );
    const wanted = ["normal", "queue", "stop"].includes(scenario) ? 2 : 1;
    for (const result of results) {
      if (state.verified?.has(result.id)) continue;
      state.verified ??= new Set();
      state.verified.add(result.id);
      const content = textOf(result);
      const end = content.match(
        /PM_WORKER_FINAL_END scenario=(\w+) worker=([\w-]+) sequence=(\d+)/,
      );
      const expected = end && workerFinal(end[1], end[2], Number(end[3]));
      await this.record({
        kind: "canonical-result",
        sessionId: options.sessionId,
        messageId: result.id,
        workerId: result.source.workerId,
        workerTurn: result.source.workerTurn,
        completionId: result.source.completionId,
        chars: content.length,
        fullFinalPresent: !!expected && content.includes(expected),
        tail: end?.[0] ?? null,
      });
      if (!expected || !content.includes(expected))
        throw new Error(
          "Canonical MoA result omitted part of the scripted worker final.",
        );
    }
    if (results.length >= wanted) {
      state.phase = "complete";
      yield* this.text(
        `PM_MAIN_FINAL ${scenario}: reviewed ${results.length} canonical project-mode-result messages from ${state.workerIds.length} native workers. Every scripted full final, including its tail sentinel, is present.`,
        options.signal,
      );
      return;
    }
    if (++state.checks > 8)
      throw new Error(
        "Acceptance exceeded bounded coordinator checks while canonical results were incomplete.",
      );
    // This closes one MODEL response only. The production native turn guard must keep
    // the coordinator turn open, consume actual child results, then request a main final.
    yield* this.text(
      `PM_COORDINATOR_INTERIM ${scenario}: workers dispatched; ${results.length}/${wanted} canonical results received. I am continuing this same native coordinator turn after worker completion.`,
      options.signal,
    );
    state.phase = "awaiting-results";
  }
  async *stream(options) {
    const count = (this.calls.get(options.sessionId) ?? 0) + 1;
    this.calls.set(options.sessionId, count);
    const agent = options.sessionId && this.ctx.agents.get(options.sessionId);
    const roleText = `${options.system ?? ""}\n${options.messages
      .filter(
        (m) => m.role === "system" || m.source?.kind === "runtime-context",
      )
      .map(textOf)
      .join("\n")}`;
    await this.record({
      kind: "request",
      sessionId: options.sessionId ?? null,
      count,
      purpose: options.purpose ?? null,
      background: !!options.purpose,
      role: roleText.includes("MoA worker")
        ? "worker"
        : roleText.includes("MoA coordinator")
          ? "coordinator"
          : "ordinary",
      firstRolePresent:
        count === 1 ? /MoA worker|MoA coordinator/.test(roleText) : undefined,
      messageKinds: options.messages.map((m) => ({
        role: m.role,
        sourceKind: m.source?.kind ?? null,
      })),
      effectiveTools: toolsOf(options.tools ?? []),
      nativeTools: agent ? toolsOf(this.ctx.tools.schemas(agent)) : [],
      signalAborted: options.signal?.aborted ?? false,
    });
    if (options.purpose) {
      yield* this.text("MoA acceptance", options.signal, false);
      return;
    }
    try {
      if (roleText.includes("MoA worker")) yield* this.worker(options);
      else yield* this.parent(options);
    } catch (error) {
      await this.record({
        kind: options.signal?.aborted ? "request-aborted" : "request-error",
        sessionId: options.sessionId,
        count,
        message: String(error?.message ?? error),
      });
      throw error;
    }
  }
}

export async function apply(ctx, config = {}) {
  const controlRoot = resolve(
    config.controlRoot ??
      ".superpowers/app-acceptance/workspace/acceptance-control",
  );
  const logRoot = resolve(
    config.logRoot ?? ".superpowers/app-acceptance/provider-logs",
  );
  const resolved = {
    controlRoot,
    logRoot,
    chunkDelayMs: config.chunkDelayMs ?? 35,
  };
  await mkdir(logRoot, { recursive: true });
  await mkdir(controlRoot, { recursive: true });
  let writes = Promise.resolve();
  const record = (row) => {
    writes = writes.then(() =>
      appendFile(
        join(logRoot, "trace.jsonl"),
        JSON.stringify({ time: new Date().toISOString(), ...row }) + "\n",
      ),
    );
    return writes;
  };
  const adapter = new AcceptanceAdapter(ctx, resolved, record);
  ctx.effect(() => ctx.llm.registerAdapter([PROVIDER], adapter));
  const snapshot = (reason) => {
    for (const agent of ctx.agents.list()) {
      const names = toolsOf(ctx.tools.schemas(agent));
      void record({
        kind: "tool-snapshot",
        reason,
        sessionId: agent.id,
        tools: names,
        nativeDelegation: Object.fromEntries(
          nativeDelegation.map((name) => [name, names.includes(name)]),
        ),
        controlWorkers: names.includes("control_workers"),
      });
    }
  };
  ctx.on("agent/created", () => {
    snapshot("agent/created");
    return undefined;
  });
  ctx.on("tools/change", () => snapshot("tools/change"));
  const turns = new Map();
  ctx.on("session/event", (session, event) => {
    if (event.data?.turn !== undefined) turns.set(session.id, event.data.turn);
    void record({
      kind: "native-event",
      sessionId: session.id,
      id: event.data?.id ?? event.data?.message?.id ?? null,
      type: event.type,
      turn: event.data?.turn ?? turns.get(session.id) ?? null,
      seq: event.seq,
      sourceKind:
        event.data?.source?.kind ?? event.data?.message?.source?.kind ?? null,
      reason: event.data?.reason?.kind ?? null,
    });
  });
  ctx.on("dispose", () => writes);
  await record({
    kind: "provider-ready",
    provider: PROVIDER,
    model: MODEL,
    ...resolved,
  });
  snapshot("mounted");
}
