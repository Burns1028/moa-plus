import type { Agent, AgentHandle } from "@deepseek-ai/dsh-agent";
import { createUserMessage, type ContentBlock, type UserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import type { HostAccess } from "../host-access.ts";
import { waitForTurn } from "../native.ts";
import { outcomeVerifierPrompt, rubricBuilderPrompt } from "../prompts/completion.ts";
import { bindWorkerMemoryPolicy, type WorkerMemoryPolicyBinding } from "./worker-memory-policy.ts";

declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    "moa-completion": { kind: "moa-completion"; form: "notice"; summary: string };
  }
}

const criteriaSchema = z.object({ criteria: z.string().min(1), promise: z.string().min(1) });
const rubricSchema = z.object({ rubric: z.string().min(1), tests_required: z.boolean() });
const verdictSchema = z.object({ status: z.enum(["Pass", "Partial", "Block"]), issues: z.array(z.string()) });
type Verdict = z.infer<typeof verdictSchema>;
const key = "moa:completion-criteria";
const sourceKey = "moa:completion-input";
const sourceVersionSchema = z.object({ path: z.string(), requirement: z.number().int().positive().nullable(), content: z.string().nullable() });
const inputSchema = z.object({ taskId: z.string(), turn: z.number(), finished: z.boolean().default(false), requirements: z.array(z.string()), sources: z.record(z.string(), z.string().nullable()), sourceVersions: z.array(sourceVersionSchema).default([]), attachments: z.array(z.custom<ContentBlock>()).default([]) });
const boundSchema = criteriaSchema.extend({ taskId: z.string(), turn: z.number() });
type Input = z.infer<typeof inputSchema>;
const output = { schema: { type: "string" as const }, render: (_: unknown, value: string) => [{ type: "text" as const, text: value }] };
const text = (message: { content: readonly ContentBlock[] }) => message.content.filter((b) => b.type === "text").map((b) => String(b.text)).join("\n");
const msg = (body: string) => createUserMessage({ source: { kind: "moa-completion", form: "notice", summary: "MoA completion review" }, content: [{ type: "text", text: body }] });
function lastText(agent: Agent, from = 0): string {
  const event = agent.session.snapshotEvents().slice(from).filter((e) => e.type === "assistant/message").at(-1);
  return event?.type === "assistant/message" ? text(event.data.message) : "";
}
interface Helpers { builder: AgentHandle; verifier: AgentHandle; verifierMemoryPolicy: WorkerMemoryPolicyBinding; build: Promise<boolean>; rubricPath: string; publish(signal: AbortSignal): Promise<void>; read(signal: AbortSignal): Promise<string>; freezeCandidate(answer: string, signal: AbortSignal): { readVerdict(): Verdict | undefined; dispose(): void } }

/** Bind to native pre-step and candidate-end events after the existing turn guard. */
export function bindCompletion(host: HostAccess): (agent: Agent) => void {
  const helpers = new Map<Agent, Helpers>();
  const mounted = new Map<Agent, () => void>();
  const running = new Map<Agent, Promise<Helpers>>();
  const generations = new Map<Agent, string>();
  const writes = new Map<Agent, Promise<void>>();
  const retired = new Set<Promise<void>>();
  const recordFor = (id: SessionId) => host.record(id) ?? host.owner(id);
  const criteriaKey = (id: SessionId) => `${key}:${id}`;
  const participant = (agent: Agent) => {
    const record = recordFor(agent.id);
    return record?.project.mode === "enabled" && (record.project.coordinatorSessionId === agent.id || record.workers.some(worker => worker.id === agent.id && (worker.lifecycle === "active" || worker.lifecycle === "provisioning")));
  };
  const close = async (pair: Helpers) => { await Promise.all([pair.builder.dispose(), pair.verifier.dispose().finally(pair.verifierMemoryPolicy.dispose)]); };
  const retire = (pair: Helpers) => {
    const pending = close(pair);
    retired.add(pending);
    void pending.then(() => retired.delete(pending), error => {
      retired.delete(pending);
      host.ctx.logger.warn(`moa: completion helper cleanup: ${String(error)}`);
    });
  };
  const filesystem = (agent: Agent) => host.ctx.get("agentPresets")?.serviceFor(agent, "fs") ?? agent.ctx.get("fs")!;
  const capture = async (parent: Agent, input: Input, added: readonly UserMessage[], signal: AbortSignal): Promise<Input> => {
    const root = host.record(parent.id)!.project.workspacePath;
    const fs = filesystem(parent);
    const sources = { ...input.sources };
    // Old saved tasks have only the original source map; retain those snapshots
    // without inventing an exact human-message anchor for them.
    const sourceVersions = input.sourceVersions.length ? [...input.sourceVersions] : Object.entries(sources).map(([path, content]) => ({ path, requirement: null, content }));
    const requirements = added.map(text);
    // Explicit Markdown links and quoted paths retain spaces. Plain paths are
    // accepted too; only named sources are read, never implementation outputs.
    for (const [index, body] of requirements.entries()) {
      const paths = new Set<string>();
      for (const match of body.matchAll(/`([^`\n]+\.[\w]+)`|\]\(([^)\n]+)\)|"([^"\n]+\.[\w]+)"|(?:^|\s)((?:\/?[\w.\-\u0080-\uffff]+\/)*[\w.\-\u0080-\uffff]+\.(?:md|txt|pdf|json|ya?ml))(?=$|\s|[.,;])/g)) {
        const path = match[1] ?? match[2] ?? match[3] ?? match[4];
        if (path && !/^[\w+.-]+:\/\//.test(path)) paths.add(path);
      }
      for (const token of paths) {
        let content: string | null = null;
        try {
          content = await fs.readText(await fs.resolve(token, { cwd: root, signal }), signal);
        } catch { signal.throwIfAborted(); /* Only an explicit human reference captures a source version. */ }
        sources[token] = content;
        sourceVersions.push({ path: token, requirement: input.requirements.length + index + 1, content });
      }
    }
    const attachments = added.flatMap(message => message.content.filter(block => block.type === "file" || block.type === "image"));
    for (const block of attachments) if (block.type === "file") {
      const label = `attachment:${block.attachment.attachmentId}:${block.attachment.name}`;
      if (Object.hasOwn(sources, label)) continue;
      sources[label] = null;
      try {
        const hostPath = host.ctx.get("attachments")?.fileHostPath(block.attachment);
        const path = hostPath && fs.processPathFromHostPath(hostPath);
        if (path) sources[label] = await fs.readText(await fs.resolve(path, { signal }), signal);
      } catch { signal.throwIfAborted(); /* Binary/unavailable attachments remain explicit references. */ }
    }
    return { ...input, requirements: [...input.requirements, ...requirements], sources, sourceVersions, attachments: [...input.attachments, ...attachments] };
  };
  const create = async (parent: Agent, input: Input, signal: AbortSignal): Promise<Helpers> => {
    const record = host.record(parent.id)!;
    const root = record.project.workspacePath;
    const rubricPath = resolve(root, "rubrics.md");
    const generation = randomUUID();
    generations.set(parent, generation);
    let rubric: string | undefined;
    let submitted: z.infer<typeof rubricSchema> | undefined;
    let candidate: { answer: string; signal: AbortSignal; verdict?: Verdict } | undefined;
    const freezeCandidate = (answer: string, signal: AbortSignal) => {
      const snapshot: NonNullable<typeof candidate> = { answer, signal };
      candidate = snapshot;
      return {
        readVerdict: () => snapshot.verdict,
        dispose: () => { if (candidate === snapshot) candidate = undefined; },
      };
    };
    const read = async (signal: AbortSignal) => {
      const fs = filesystem(parent);
      const actual = await fs.readText(await fs.resolve(rubricPath, { cwd: root, signal }), signal);
      if (generations.get(parent) !== generation || rubric === undefined || actual !== rubric) throw new Error("Rubric superseded; repeat verification against this task's original requirements.");
      return actual;
    };
    const publish = async (signal: AbortSignal) => {
      const write = (writes.get(parent) ?? Promise.resolve()).catch(() => {}).then(async () => {
        if (generations.get(parent) !== generation || rubric === undefined) throw new Error("Rubric Builder superseded");
        const fs = filesystem(parent);
        const policy = (host.ctx.get("agentPresets")?.serviceFor(parent, "sandboxPolicy") ?? parent.ctx.get("sandboxPolicy"))?.resolve({ session: parent.session });
        if (fs.sandboxMode && !policy) throw new Error("Missing rubric filesystem policy");
        await fs.writeText(await fs.resolve(rubricPath, { cwd: root, signal }), rubric, undefined, signal, policy);
      });
      writes.set(parent, write);
      await write;
    };
    const hiddenDelegation = [...new Set([...host.config.coordinatorHiddenTools, "subagent", "subagent_fork", "workflow", "send_message", "control_workers", "Task", "Fork", "SendMessage", "QueryAgent", "KillAgent"])];
    const make = async (role: "builder" | "verifier") => host.ctx.agents.create({
      sessionId: SessionId(`moa-${role}-${randomUUID()}`), parentAgent: parent,
      meta: { cwd: root, parentSession: parent.id, origin: "subagent" },
      agentOptions: parent.session.requestHeader()?.config ?? parent.options,
      signal,
      setup(ctx) {
        ctx.get("agentPresets")?.composeFrom(ctx, parent.ctx);
        // Helpers use direct tool calls, including when the parent uses PTC.
        ctx.tools.presentAs("native");
        if (role === "builder") {
          // Rubric extraction has no execution or research to perform. Select
          // the model's least reasoning effort after native model selection;
          // the parent and evidence-gathering Verifier keep their own effort.
          ctx.on("agent/request", async ({ signal }, next) => {
            const config = await next();
            const model = await ctx.llm.resolveModelInfo(config.provider, config.model, signal);
            const effort = model.reasoning?.efforts[0]?.id;
            return effort === undefined ? config : { ...config, reasoningEffort: effort };
          }, { prepend: true });
          ctx.tools.restrict({ allow: [] });
          ctx.tools.register(defineTool({
            name: "submit_rubric",
            description: "Submit the acceptance rubric derived from the supplied original requirements and source snapshots. This completes rubric building without reading implementation outputs.",
            parameters: {
              rubric: { type: "string", required: true, description: "Markdown acceptance criteria with original requirement/source anchors" },
              tests_required: { type: "boolean", required: true, description: "True whenever the original requirements or specifications require build or test execution" },
            },
            output,
            async execute(args, exec) {
              submitted = rubricSchema.parse(args);
              exec.concludeTurn();
              return "Rubric submitted.";
            },
          }));
          ctx.tools.guard(exec => exec.name === "submit_rubric" ? undefined : "Rubric Builder cannot access execution tools or implementation outputs");
        } else {
          ctx.tools.register(defineTool({ name: "read_rubric", description: "Read this task's independently authored rubric from disk. A superseded rubric requires fresh verification.", parameters: {}, output, execute: async (_args, exec) => read(exec.signal) }));
          ctx.tools.register(defineTool({ name: "read_candidate", description: "Read the complete frozen final-answer text for this review attempt, including an empty answer. This is the actual deliverable when the user requested an answer in chat; claims about files or tests still need native artifact inspection or execution.", parameters: {}, output, execute: async () => {
            if (!candidate) throw new Error("No active candidate review");
            candidate.signal.throwIfAborted();
            return candidate.answer;
          } }));
          ctx.tools.register(defineTool({
            name: "submit_verdict",
            description: "Submit this review attempt's structured outcome after inspecting the rubric and actual deliverables. This ends the review; submission alone is not inspection or required test evidence.",
            parameters: {
              status: { type: "string", required: true, enum: ["Pass", "Partial", "Block"] },
              issues: { type: "array", required: true, items: { type: "string" }, description: "Concrete remaining gaps; empty when no issues remain" },
            },
            output,
            async execute(args, exec) {
              if (!candidate) throw new Error("No active candidate review");
              exec.signal.throwIfAborted();
              candidate.signal.throwIfAborted();
              candidate.verdict = verdictSchema.parse(args);
              exec.concludeTurn();
              return "Verdict submitted.";
            },
          }));
        }
        // Standard installs its own per-Agent delegation variant after setup.
        ctx.tools.suppress({ deny: hiddenDelegation });
      },
    });
    const builder = await make("builder");
    let verifier: AgentHandle | undefined;
    let verifierMemoryPolicy: WorkerMemoryPolicyBinding | undefined;
    try {
      verifier = await make("verifier");
      verifierMemoryPolicy = bindWorkerMemoryPolicy(host.ctx, verifier.agent, record.project.paths);
      builder.agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: rubricBuilderPrompt(JSON.stringify({ ...input, attachments: undefined })) }, ...input.attachments] }));
      const build = builder.agent.whenIdle().then(async () => {
        if (!submitted) throw new Error("Rubric Builder ended without a validated submit_rubric call");
        rubric = `# MoA acceptance rubric\n\nTask: ${input.taskId}\nGeneration: ${generation}\n\n${submitted.rubric}`;
        await publish(signal);
        return submitted.tests_required;
      });
      void build.catch(() => {});
      return { builder, verifier, verifierMemoryPolicy, build, rubricPath, publish, read, freezeCandidate };
    } catch (error) {
      await Promise.all([builder.dispose(), verifier?.dispose().finally(() => verifierMemoryPolicy?.dispose())]);
      throw error;
    }
  };
  const mount = (agent: Agent) => {
    if (!participant(agent)) {
      const off = mounted.get(agent); mounted.delete(agent); off?.();
      return;
    }
    if (mounted.has(agent)) return;
    mounted.set(agent, () => {});
    const off = agent.ctx.tools.register(defineTool({
      name: "set_completion_criteria", description: "Bind this task's completion criteria and exact completion promise to include in the final answer.",
      parameters: { criteria: { type: "string", required: true, description: "Task completion criteria" }, promise: { type: "string", required: true, description: "Exact complete promise" } }, output,
      async execute(args, exec) {
        if (exec.agent !== agent || !participant(agent)) throw new Error("moa/not-participant");
        const record = recordFor(agent.id)!;
        const taskId = host.record(agent.id) ? inputSchema.parse(record.operations[sourceKey]).taskId : agent.id;
        const start = agent.session.snapshotEvents().filter(event => event.type === "turn/start").at(-1);
        if (!start || start.type !== "turn/start") throw new Error("Missing completion task turn");
        const value = { ...criteriaSchema.parse(args), taskId, turn: start.data.turn };
        await host.update(SessionId(record.project.coordinatorSessionId), (r) => ({ ...r, operations: { ...r.operations, [criteriaKey(agent.id)]: value } }));
        return "Completion criteria and exact promise bound.";
      },
    }));
    mounted.set(agent, off);
  };
  host.ctx.on("agent/pre-step", async ({ agent, signal }, next) => {
    const decision = await next();
    if (host.record(agent.id)?.project.mode !== "enabled") return decision;
    mount(agent);
    if (decision.kind !== "enter") return decision;
    const human = decision.messages.filter((m) => m.source.kind === "user");
    if (!human.length) return decision;
    const prior = inputSchema.safeParse(host.record(agent.id)?.operations[sourceKey]);
    const events = agent.session.snapshotEvents();
    const start = events.filter((event) => event.type === "turn/start").at(-1);
    if (!start || start.type !== "turn/start") throw new Error("Missing turn identity");
    const priorCompleted = prior.success && events.some(event => event.type === "turn/end" && event.data.turn === prior.data.turn && event.data.reason.kind === "completed");
    const continuation = prior.success && !prior.data.finished && !priorCompleted;
    const base: Input = continuation ? { ...prior.data, turn: start.data.turn } : { taskId: randomUUID(), turn: start.data.turn, finished: false, requirements: [], sources: {}, sourceVersions: [], attachments: [] };
    const input = await capture(agent, base, human, signal);
    await host.update(agent.id, (r) => ({ ...r, operations: { ...r.operations, [sourceKey]: z.json().parse(input) } }));
    const old = helpers.get(agent);
    helpers.delete(agent);
    if (old) retire(old);
    const pending = create(agent, input, signal);
    running.set(agent, pending);
    try { const pair = await pending; helpers.set(agent, pair); } finally { if (running.get(agent) === pending) running.delete(agent); }
    return decision;
  });
  host.ctx.on("agent/turn-stopping", async ({ agent, signal }) => {
    if (!participant(agent)) return;
    const gate = boundSchema.safeParse(recordFor(agent.id)?.operations[criteriaKey(agent.id)]);
    const current = inputSchema.safeParse(host.record(agent.id)?.operations[sourceKey]);
    const answer = lastText(agent, agent.session.snapshotEvents().findLastIndex(event => event.type === "turn/start"));
    const gateCompleted = gate.success && agent.session.snapshotEvents().some(event => event.type === "turn/end" && event.data.turn >= gate.data.turn && event.data.reason.kind === "completed");
    const currentTask = host.record(agent.id) ? (current.success && !current.data.finished && gate.success && gate.data.taskId === current.data.taskId) : gate.success;
    if (gate.success && currentTask && !gateCompleted && !answer.includes(gate.data.promise)) {
      agent.steer(msg(`The exact completion promise is missing. Continue until these criteria are met: ${gate.data.criteria}\nInclude this exact promise in your final response: ${gate.data.promise}`));
      return;
    }
    // Only the direct-to-human Coordinator gets independent outcome helpers.
    if (!host.record(agent.id) || !current.success || current.data.finished) return;
    if (agent.inbox.nextStep.length) return;
    const wake = new AbortController();
    const listener = () => { if (agent.inbox.nextStep.length) wake.abort(); };
    host.listeners.add(listener);
    const control = AbortSignal.any([signal, host.closing.signal, wake.signal]);
    let active: Helpers | undefined;
    let stopEvidence: (() => void) | undefined;
    let candidateReview: ReturnType<Helpers["freezeCandidate"]> | undefined;
    try {
      listener();
      let pending = running.get(agent);
      if (!helpers.has(agent) && !pending) {
        const saved = inputSchema.parse(host.record(agent.id)?.operations[sourceKey]);
        pending = create(agent, saved, signal);
        running.set(agent, pending);
        void pending.then((pair) => { helpers.set(agent, pair); }, () => {}).finally(() => { if (running.get(agent) === pending) running.delete(agent); });
      }
      const pair = helpers.get(agent) ?? await waitForTurn(pending!, control);
      if (!pair) throw new Error("Missing completion helpers");
      active = pair;
      const testsRequired = await waitForTurn(pair.build, control);
      await pair.publish(control);
      control.throwIfAborted();
      await waitForTurn(pair.verifier.agent.whenIdle(), control);
      control.throwIfAborted();
      const offset = pair.verifier.agent.session.snapshotEvents().length;
      const successfulBash = new Set<number>();
      stopEvidence = pair.verifier.agent.ctx.on("tools/result", (exec, result) => {
        if (exec.agent !== pair.verifier.agent || exec.name.toLowerCase() !== "bash" || result.isError) return;
        const value = result.value;
        if (!value || typeof value !== "object" || Array.isArray(value) || value.kind !== "foreground" || value.exitCode !== 0 || value.timedOut !== false || value.aborted !== false || value.signal !== null) return;
        const call = pair.verifier.agent.session.snapshotEvents().filter(event => event.type === "tool/call" && event.data.callId === exec.callId && event.data.name === exec.name).at(-1);
        if (call) successfulBash.add(call.seq);
      });
      candidateReview = pair.freezeCandidate(answer, control);
      pair.verifier.agent.followup(msg(outcomeVerifierPrompt(pair.rubricPath)));
      await waitForTurn(pair.verifier.agent.whenIdle(), control);
      await pair.read(control);
      control.throwIfAborted();
      const events = pair.verifier.agent.session.snapshotEvents().slice(offset);
      const calls = events.filter((e) => e.type === "tool/call");
      const results = events.filter((e) => e.type === "tool/result" && !e.data.message.isError);
      const successfulCalls = calls.filter((e) => e.type === "tool/call" && results.some((result) => result.type === "tool/result" && result.data.step === e.data.step && result.data.message.toolCallId === e.data.callId));
      const passedBash = successfulCalls.some(call => successfulBash.has(call.seq)) || events.some(event => event.type === "job/settled" && event.data.kind === "bash" && event.data.owner === pair.verifier.agent.id && event.data.producerReported && event.data.status === "completed" && /^exit code: 0(?:;|$)/.test(event.data.detail ?? "") && successfulCalls.some(call => call.type === "tool/call" && call.data.name.toLowerCase() === "bash" && call.data.callId === event.data.toolCall?.rootCallId));
      let verdict: { status?: string; issues?: unknown };
      try {
        const submittedVerdict = candidateReview.readVerdict();
        if (submittedVerdict) verdict = submittedVerdict;
        else {
          const body = lastText(pair.verifier.agent, offset).trim();
          try { verdict = JSON.parse(body.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch {
            const fenced = body.split("```");
            if (fenced.length !== 3) throw new Error("Missing or ambiguous JSON verdict");
            verdict = JSON.parse(fenced[1].replace(/^\s*json\b/i, ""));
          }
          if (!verdict || typeof verdict !== "object" || Array.isArray(verdict)) throw new Error("Expected a verdict object");
        }
      } catch {
        agent.steer(msg("Outcome verification did not pass. Verifier must call submit_verdict or return a valid JSON verdict object, directly or in exactly one fenced JSON block."));
        return;
      }
      if (verdict.status !== "Pass" || !successfulCalls.some((e) => e.type === "tool/call" && e.data.name === "read_rubric") || !successfulCalls.some((e) => e.type === "tool/call" && e.data.name !== "read_rubric" && e.data.name !== "submit_verdict") || (testsRequired && !passedBash)) agent.steer(msg(`Outcome verification did not pass. ${JSON.stringify(Array.isArray(verdict.issues) && verdict.issues.length ? verdict.issues : ["Verifier must read the rubric, inspect actual results using tools, and perform required tests."])}`));
    } catch (error) {
      signal.throwIfAborted();
      if (!wake.signal.aborted && !host.closing.signal.aborted) {
        if (active && helpers.get(agent) === active) { helpers.delete(agent); retire(active); }
        agent.steer(msg(`Outcome verification blocked: ${String(error)}. Continue the task and repeat verification against its original requirements; a superseded rubric requires re-verification, not changes to otherwise correct deliverables.`));
      }
    } finally {
      candidateReview?.dispose();
      stopEvidence?.();
      host.listeners.delete(listener);
      if (control.aborted && active?.verifier.agent.status === "running") active.verifier.agent.cancel({ kind: "parent" });
    }
  });
  host.ctx.on("session/event", (session, event) => {
    if (event.type !== "turn/end" || event.data.reason.kind !== "completed") return;
    const owner = recordFor(session.id);
    if (!owner || owner.project.mode !== "enabled") return;
    const saved = inputSchema.safeParse(host.record(session.id)?.operations[sourceKey]);
    host.enqueue(SessionId(owner.project.coordinatorSessionId), async () => {
      await host.update(SessionId(owner.project.coordinatorSessionId), (record) => {
        const operations = { ...record.operations };
        const gate = boundSchema.safeParse(operations[criteriaKey(session.id)]);
        if (gate.success && gate.data.turn <= event.data.turn) delete operations[criteriaKey(session.id)];
        const current = inputSchema.safeParse(record.operations[sourceKey]);
        if (saved.success && saved.data.turn === event.data.turn && current.success && current.data.taskId === saved.data.taskId && current.data.turn === saved.data.turn) operations[sourceKey] = z.json().parse({ ...saved.data, finished: true });
        return { ...record, operations };
      });
    });
  });
  host.ctx.on("agent/disposed", async ({ agent }) => {
    mounted.get(agent)?.(); mounted.delete(agent);
    const pair = helpers.get(agent); helpers.delete(agent); if (pair) await close(pair);
  });
  host.ctx.effect(() => async () => {
    generations.clear();
    for (const off of mounted.values()) off();
    mounted.clear();
    await Promise.all([...helpers.values()].map(close).concat([...retired]));
    helpers.clear();
  });
  return mount;
}
