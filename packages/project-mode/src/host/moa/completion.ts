import type { Agent, AgentHandle, ModelSelection } from "@deepseek-ai/dsh-agent";
import { createUserMessage, type ContentBlock, type UserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { moaToolNames as tools } from "../../shared/tool-names.ts";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import type { HostAccess } from "../host-access.ts";
import { waitForTurn, presentNativeTools } from "../native.ts";
import { buildDeliveryReviewInstructions, buildChecklistInstructions } from "../prompts/completion.ts";
import { bindWorkerMemoryPolicy, type WorkerMemoryPolicyBinding } from "./worker-memory-policy.ts";

declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    "moa-completion": { kind: "moa-completion"; form: "notice"; summary: string };
  }
}

const criteriaSchema = z.object({ criteria: z.string().min(1), promise: z.string().min(1) });
const rubricSchema = z.object({ rubric: z.string().min(1), tests_required: z.boolean() });
const verdictSchema = z.object({ status: z.enum(["Pass", "Partial", "Block"]), issues: z.array(z.string()), runtime_blocked: z.boolean().optional() });
type Verdict = z.infer<typeof verdictSchema>;
const key = "moa:completion-criteria";
const sourceKey = "moa:completion-input";
const sourceVersionSchema = z.object({ path: z.string(), requirement: z.number().int().positive().nullable(), content: z.string().nullable() });
const inputSchema = z.object({ taskId: z.string(), turn: z.number(), finished: z.boolean().default(false), requirements: z.array(z.string()), sources: z.record(z.string(), z.string().nullable()), sourceVersions: z.array(sourceVersionSchema).default([]), attachments: z.array(z.custom<ContentBlock>()).default([]) });
const boundSchema = criteriaSchema.extend({ taskId: z.string(), turn: z.number() });
type Input = z.infer<typeof inputSchema>;
/** Explicit file references; a declared delivery path is not an input specification. */
function referencedInputPaths(body: string): string[] {
  const paths: string[] = [];
  let previousEnd = 0, previousOutput = false;
  const references = /`([^`\n]+)`|\[[^\]\n]*\]\(([^)\n]+)\)|"([^"\n]+)"|(?:^|[\s（(\[，、；：。！？])((?:(?:[A-Za-z]:)?[\\/]|\.\.?[\\/])?[\p{L}\p{N}_.-]+(?:[\\/][\p{L}\p{N}_.-]+)*\.(?:md|txt|csv|tsv|jsonl?|ya?ml|pdf))(?=$|[\s，、；：。！？,.;:)\]）])/giu;
  for (const match of body.matchAll(references)) {
    const path = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (!path || !/\.[\w]+$/.test(path) || /^[\w+.-]+:\/\//.test(path)) continue;
    const before = body.slice(0, match.index);
    // In "generate <document>'s summary" the named document is the input,
    // even though the request starts with a delivery verb.
    const documentSubject = /^\s*(?:的|之|['’]s\b)/i.test(body.slice(match.index + match[0].length));
    const isDeliveryTarget: boolean = !documentSubject && (/(?:交付|输出|生成|写入|写到|保存到|保存|导出)(?:为|到|至|成)?\s*$/.test(before) ||
      /\b(?:write|save|create|deliver|output|generate|export)(?:\s+(?:the|a|an|result|report|file|artifact|json|to|in|at|as))*\s*$/i.test(before) ||
      (previousOutput && /^(?:[\s,、;；和及与&]|and\b)*$/i.test(body.slice(previousEnd, match.index))));
    previousEnd = match.index + match[0].length;
    previousOutput = isDeliveryTarget;
    if (!isDeliveryTarget) paths.push(path);
  }
  return [...new Set(paths)];
}
function isMissingSource(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const code: unknown = Reflect.get(error, "code");
  return code === "ENOENT" || code === "FS_NOT_FOUND";
}
function serializeOriginalInputs(input: Input): string {
  const { attachments: _attachments, sources, sourceVersions, ...snapshot } = input;
  // Persistence retains both latest values and their chronological versions.
  // Model input needs each captured document once, not a second full copy in
  // the latest-value map. Keep legacy/unversioned (including attachment) inputs
  // and any latest value not represented by the last captured version.
  const latest = new Map(sourceVersions.map(source => [source.path, source.content]));
  const unversioned = Object.fromEntries(Object.entries(sources).filter(
    ([path, content]) => !latest.has(path) || latest.get(path) !== content,
  ));
  return JSON.stringify({ ...snapshot, sources: unversioned, sourceVersions });
}
const output = { schema: { type: "string" as const }, render: (_: unknown, value: string) => [{ type: "text" as const, text: value }] };
const text = (message: { content: readonly ContentBlock[] }) => message.content.filter((b) => b.type === "text").map((b) => String(b.text)).join("\n");
const msg = (body: string) => createUserMessage({ source: { kind: "moa-completion", form: "notice", summary: "MoA completion review" }, content: [{ type: "text", text: body }] });
function lastText(agent: Agent, from = 0): string {
  const event = agent.session.snapshotEvents().slice(from).filter((e) => e.type === "assistant/message").at(-1);
  return event?.type === "assistant/message" ? text(event.data.message) : "";
}
class ReviewAgentFailure extends Error {}
interface ReviewEvidence {
  rubricRead: boolean;
  inspectionRecorded: boolean;
  testsRequired: boolean;
  successfulNativeExecution: boolean;
  capabilityUnavailable: boolean;
}
interface ReviewAttempt {
  evidence(): ReviewEvidence;
  protocolIssue(submitted?: Verdict): Promise<string | undefined>;
}
function missingVerdictGap(verdict: Verdict): boolean {
  return verdict.status !== "Pass" && !verdict.issues.some(issue => issue.trim().length > 0);
}
/** The context and final gate derive facts from the same attempt-local tool events. */
function collectReviewEvidence(agent: Agent, offset: number, testsRequired: boolean, successfulShell: ReadonlySet<number>, capabilityUnavailable: boolean): ReviewEvidence {
  const events = agent.session.snapshotEvents().slice(offset);
  const calls = events.filter(event => event.type === "tool/call");
  const results = events.filter(event => event.type === "tool/result" && !event.data.message.isError);
  const successfulCalls = calls.filter(call => results.some(result => result.type === "tool/result" && result.data.step === call.data.step && result.data.message.toolCallId === call.data.callId));
  return {
    rubricRead: successfulCalls.some(call => call.data.name === tools.readChecklist),
    inspectionRecorded: successfulCalls.some(call => call.data.name !== tools.readChecklist && call.data.name !== tools.submitReview),
    testsRequired,
    successfulNativeExecution: successfulCalls.some(call => successfulShell.has(call.seq)) || events.some(event => event.type === "job/settled" && ["bash", "pwsh"].includes(event.data.kind.toLowerCase()) && event.data.owner === agent.id && event.data.producerReported && event.data.status === "completed" && /^exit code: 0(?:;|$)/.test(event.data.detail ?? "") && successfulCalls.some(call => call.data.name.toLowerCase() === event.data.kind && call.data.callId === event.data.toolCall?.rootCallId)),
    capabilityUnavailable,
  };
}
function missingReviewEvidence(evidence: ReviewEvidence): string[] {
  return [
    ...evidence.rubricRead ? [] : [`Read the current rubric with ${tools.readChecklist}.`],
    ...evidence.inspectionRecorded ? [] : [`Inspect the actual deliverable with tools; use ${tools.readDelivery} for the frozen chat answer.`],
    ...!evidence.testsRequired || evidence.successfulNativeExecution ? [] : ["Personally perform the required execution using native Bash or PowerShell with confirmed successful exit; console success text alone does not count."],
  ];
}
function readReviewVerdict(submitted: Verdict | undefined, body: string): Verdict {
  if (submitted) return submitted;
  let value: unknown;
  try { value = JSON.parse(body.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch {
    const fenced = body.trim().split("```");
    if (fenced.length !== 3) throw new Error("Missing or ambiguous JSON verdict");
    value = JSON.parse(fenced[1].replace(/^\s*json\b/i, ""));
  }
  return verdictSchema.parse(value);
}
function assertReviewAgentHealthy(agent: Agent, role: string, from = 0): void {
  const end = agent.session.snapshotEvents().slice(from).findLast(event => event.type === "turn/end");
  if (end?.type === "turn/end" && end.data.reason.kind === "error")
    throw new ReviewAgentFailure(`MoA+ ${role} failed: ${end.data.reason.error.message}`);
}
interface Helpers { builder: AgentHandle; verifier: AgentHandle; verifierMemoryPolicy: WorkerMemoryPolicyBinding; build: Promise<boolean>; rubricPath: string; publish(signal: AbortSignal): Promise<void>; read(signal: AbortSignal): Promise<string>; freezeCandidate(answer: string, signal: AbortSignal, attempt: ReviewAttempt): { readVerdict(): Verdict | undefined; dispose(): void } }

/** New native loops record selection before preparing a step; legacy loops use request hooks. */
function hasNativeModelSelection(agent: Agent): agent is Agent & { model: {
  current(): ModelSelection | undefined;
  select(selection: ModelSelection): void;
} } {
  const model: unknown = Reflect.get(agent, "model");
  return typeof model === "object" && model !== null &&
    typeof Reflect.get(model, "current") === "function" && typeof Reflect.get(model, "select") === "function";
}

/** Bind to native pre-step and candidate-end events after the existing turn guard. */
export function bindDeliveryReview(host: HostAccess): (agent: Agent) => void {
  host.ctx.systemPrompt.context({
    name: "project-mode:task", order: 655, required: true, interpolate: false,
    text: ({ agent }) => {
      const record = agent && host.record(agent.id);
      if (!agent || record?.project.mode !== "enabled") return "";
      const input = inputSchema.safeParse(record.operations[sourceKey]);
      if (!input.success || input.data.finished) return "";
      const bound = boundSchema.safeParse(record.operations[`${key}:${record.project.coordinatorSessionId}`]);
      const reviewRequested = host.config.completionVerification === true ||
        (bound.success && bound.data.taskId === input.data.taskId);
      // Native checkpoints replace model-visible history while preserving the
      // original audit events. Recover task inputs from our existing capture;
      // this does not request acceptance or create any review helpers.
      const compacted = !reviewRequested && host.config.completionVerification === "on-demand" &&
        agent.session.surface.nodes.some(seq => {
          const event = agent.session.eventAt(seq);
          if (event?.type !== "user/message") return false;
          const kind: string | undefined = event.data.source?.kind;
          return kind === "compact-checkpoint";
        });
      if (!reviewRequested && !compacted) return "";
      return `Existing unfinished task: quoted original human requirements and explicitly referenced source snapshots retained by MoA+. This is task context, not a new human message or a new task. Read the human requirements chronologically, preserving unaffected earlier instructions. Progress notes describe work and may contain stale diagnoses; they do not replace these requirements or establish current runtime failures.\n\n${serializeOriginalInputs(input.data)}`;
    },
  });
  const helpers = new Map<Agent, Helpers>();
  const mounted = new Map<Agent, () => void>();
  const running = new Map<Agent, Promise<Helpers>>();
  let generations = new WeakMap<Agent, string>();
  const writes = new WeakMap<Agent, Promise<void>>();
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
  const retainTaskInputs = async (parent: Agent, input: Input, added: readonly UserMessage[], signal: AbortSignal): Promise<Input> => {
    const root = host.record(parent.id)!.project.workspacePath;
    const fs = filesystem(parent);
    const sources = { ...input.sources };
    // Old saved tasks have only the original source map; retain those snapshots
    // without inventing an exact human-message anchor for them.
    const sourceVersions = input.sourceVersions.length ? [...input.sourceVersions] : Object.entries(sources).map(([path, content]) => ({ path, requirement: null, content }));
    const requirements = added.map(text);
    // Capture before implementation. An unqualified name may abbreviate a
    // sibling of an explicitly named input; resolve it only when unique.
    for (const [index, body] of requirements.entries()) {
      const paths = referencedInputPaths(body);
      const directories = [...new Set(paths.filter(path => /[\\/]/.test(path)).map(path => dirname(path)))];
      for (const token of paths) {
        let path = token;
        let content: string | null = null;
        let missing = false;
        try {
          content = await fs.readText(await fs.resolve(token, { cwd: root, signal }), signal);
        } catch (error) { signal.throwIfAborted(); missing = isMissingSource(error); }
        if (missing && !/[\\/]/.test(token)) {
          const siblings: { path: string; content: string }[] = [];
          let unresolved = false;
          for (const directory of directories) {
            const sibling = join(directory, token);
            try {
              siblings.push({ path: sibling, content: await fs.readText(await fs.resolve(sibling, { cwd: root, signal }), signal) });
            } catch (error) { signal.throwIfAborted(); unresolved ||= !isMissingSource(error); }
          }
          if (!unresolved && siblings.length === 1) ({ path, content } = siblings[0]);
        }
        sources[path] = content;
        sourceVersions.push({ path, requirement: input.requirements.length + index + 1, content });
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
    let candidate: { answer: string; signal: AbortSignal; attempt: ReviewAttempt; verdict?: Verdict } | undefined;
    const freezeCandidate = (answer: string, signal: AbortSignal, attempt: ReviewAttempt) => {
      const snapshot: NonNullable<typeof candidate> = { answer, signal, attempt };
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
    const hiddenDelegation = [...new Set([...host.config.coordinatorHiddenTools, "subagent", "subagent_fork", "workflow", "send_message", "control_workers", tools.dispatch, tools.branch, tools.message, tools.observe, tools.stop])];
    const inherited = parent.session.requestHeader()?.config ?? parent.options;
    const selected = hasNativeModelSelection(parent) ? parent.model.current() : undefined;
    // A pending native selection can be newer than the last request header.
    // Omitting its effort restores the adapter default, clearing the old one.
    const { reasoningEffort: _inheritedEffort, ...controls } = inherited;
    const agentOptions = selected === undefined ? inherited : { ...controls, ...selected };
    const make = async (role: "builder" | "verifier") => host.ctx.agents.create({
      sessionId: SessionId(`moa-${role}-${randomUUID()}`), parentAgent: parent,
      meta: { cwd: root, parentSession: parent.id, origin: "subagent" },
      agentOptions,
      signal,
      async setup(ctx, agent) {
        ctx.get("agentPresets")?.composeFrom(ctx, parent.ctx);
        // Helpers use direct tool calls, including when the parent uses PTC.
        await presentNativeTools(ctx);
        if (role === "builder") {
          // Select the Builder's lightest supported effort before the native
          // loop fixes prompt/tool preparation to that model selection.
          if (hasNativeModelSelection(agent)) {
            const current = agent.model.current();
            if (current) {
              const model = await ctx.llm.resolveModelInfo(current.provider, current.model, signal);
              const effort = model.reasoning?.efforts[0]?.id;
              if (effort !== undefined) agent.model.select({ ...current, reasoningEffort: effort });
            }
          } else {
            // Legacy native selection is resolved in the request waterfall.
            ctx.on("agent/request", async ({ signal }, next) => {
              const config = await next();
              const model = await ctx.llm.resolveModelInfo(config.provider, config.model, signal);
              const effort = model.reasoning?.efforts[0]?.id;
              return effort === undefined ? config : { ...config, reasoningEffort: effort };
            }, { prepend: true });
          }
          ctx.tools.restrict({ allow: [] });
          ctx.tools.register(defineTool({
            name: tools.publishChecklist,
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
          ctx.tools.guard(exec => exec.name === tools.publishChecklist ? undefined : "Rubric Builder cannot access execution tools or implementation outputs");
        } else {
          ctx.systemPrompt.context({
            name: "project-mode:review-evidence", order: 665, required: true, interpolate: false,
            text: () => !candidate || candidate.signal.aborted ? "" :
              `Host prerequisites recorded for this frozen candidate only; these are not a verdict or proof that the rubric is satisfied. inspectionRecorded means another tool succeeded, not that its result establishes a requirement. successfulNativeExecution means confirmed native exit zero, not that the right tests were chosen or passed semantically. Judge the actual evidence against every rubric obligation.\n${JSON.stringify(candidate.attempt.evidence())}`,
          });
          // Native completion runs after the whole tool batch, including a
          // submit/read/shell batch. Repair protocol evidence within this same
          // review turn, without asking the author to rework sound artifacts.
          ctx.on("agent/turn-stopping", async ({ agent: stopping, signal }) => {
            const current = candidate;
            if (stopping !== agent || !current || current.signal.aborted || signal.aborted) return;
            const problem = await current.attempt.protocolIssue(current.verdict);
            if (!problem || candidate !== current || current.signal.aborted || signal.aborted) return;
            current.verdict = undefined;
            agent.steer(msg(problem));
          });
          ctx.tools.register(defineTool({ name: tools.readChecklist, description: "Read this task's independently authored rubric from disk. A superseded rubric requires fresh verification.", parameters: {}, output, execute: async (_args, exec) => read(exec.signal) }));
          ctx.tools.register(defineTool({ name: tools.readDelivery, description: "Read the complete frozen final-answer text for this review attempt, including an empty answer. This is the actual deliverable when the user requested an answer in chat; claims about files or tests still need native artifact inspection or execution.", parameters: {}, output, execute: async () => {
            if (!candidate) throw new Error("No active candidate review");
            candidate.signal.throwIfAborted();
            return candidate.answer;
          } }));
          ctx.tools.register(defineTool({
            name: tools.submitReview,
            description: "Submit this review attempt's structured outcome after inspecting the rubric and actual deliverables, requesting native completion. Missing protocol or Host prerequisites are corrected in this same review before closure; submission alone is not inspection or required test evidence.",
            parameters: {
              status: { type: "string", required: true, enum: ["Pass", "Partial", "Block"] },
              issues: { type: "array", required: true, items: { type: "string" }, description: "Concrete remaining gaps; empty when no issues remain" },
              runtime_blocked: { type: "boolean", description: "True when an unavailable runtime capability prevents independent verification with the remaining tools; false or omitted for ordinary deliverable gaps" },
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
      builder.agent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: buildChecklistInstructions(serializeOriginalInputs(input)) }, ...input.attachments] }));
      const build = builder.agent.whenIdle().then(async () => {
        assertReviewAgentHealthy(builder.agent, "Rubric Builder");
        if (!submitted) throw new Error(`Rubric Builder ended without a validated ${tools.publishChecklist} call`);
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
      name: tools.review, description: host.record(agent.id) && host.config.completionVerification === "on-demand"
        ? `Register independent acceptance for the current task with concrete criteria and an exact, natural completion statement. Continue the task and present your final candidate; the Host then runs hidden acceptance before closing. These helpers are not children to wait for with ${tools.observe}. Use this when a separate check adds value. The Builder derives its rubric from original human requirements, not these criteria.`
        : "Bind this task's completion criteria and exact completion promise to include in the final answer.",
      parameters: { criteria: { type: "string", required: true, description: "Task completion criteria" }, promise: { type: "string", required: true, description: "Exact complete promise" } }, output,
      async execute(args, exec) {
        if (exec.agent !== agent || !participant(agent)) throw new Error("moa/not-participant");
        const record = recordFor(agent.id)!;
        const own = host.record(agent.id);
        const input = inputSchema.safeParse(record.operations[sourceKey]);
        if (own && (!input.success || input.data.finished))
          throw new Error("No unfinished human task is available for independent verification.");
        const taskId = own && input.success ? input.data.taskId : agent.id;
        const start = agent.session.snapshotEvents().filter(event => event.type === "turn/start").at(-1);
        if (!start || start.type !== "turn/start") throw new Error("Missing completion task turn");
        const value = { ...criteriaSchema.parse(args), taskId, turn: start.data.turn };
        await host.update(SessionId(record.project.coordinatorSessionId), (r) => ({ ...r, operations: { ...r.operations, [criteriaKey(agent.id)]: value } }));
        return own
          ? `Independent acceptance registered. Complete the task and present your final candidate with this exact promise when its criteria are met: ${value.promise}\nThe Host reviews the candidate before closure and returns any concrete gaps. Acceptance helpers are hidden; do not wait for them with ${tools.observe}.`
          : "Completion criteria and exact promise bound. Include the promise when this assignment's criteria are met; this does not create independent acceptance helpers.";
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
    const prior = inputSchema.safeParse(host.record(agent.id)?.operations[sourceKey]);
    const events = agent.session.snapshotEvents();
    const start = events.filter((event) => event.type === "turn/start").at(-1);
    if (!start || start.type !== "turn/start") throw new Error("Missing turn identity");
    const priorCompleted = prior.success && events.some(event => event.type === "turn/end" && event.data.turn === prior.data.turn && event.data.reason.kind === "completed");
    if (!human.length) {
      // A background handoff can continue the same task in another native
      // turn without a new human input. Its eventual completion still owns
      // task cleanup, so the next human task does not inherit this binding.
      if (prior.success && !prior.data.finished && !priorCompleted && prior.data.turn !== start.data.turn)
        await host.update(agent.id, (r) => ({ ...r, operations: { ...r.operations, [sourceKey]: z.json().parse({ ...prior.data, turn: start.data.turn }) } }));
      return decision;
    }
    const continuation = prior.success && !prior.data.finished && !priorCompleted;
    const base: Input = continuation ? { ...prior.data, turn: start.data.turn } : { taskId: randomUUID(), turn: start.data.turn, finished: false, requirements: [], sources: {}, sourceVersions: [], attachments: [] };
    const input = await retainTaskInputs(agent, base, human, signal);
    await host.update(agent.id, (r) => ({ ...r, operations: { ...r.operations, [sourceKey]: z.json().parse(input) } }));
    const old = helpers.get(agent);
    helpers.delete(agent);
    if (old) retire(old);
    const bound = boundSchema.safeParse(host.record(agent.id)?.operations[criteriaKey(agent.id)]);
    if (host.config.completionVerification !== true &&
      (!bound.success || bound.data.taskId !== input.taskId)) return decision;
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
    if (host.config.completionVerification !== true && (!gate.success || !currentTask || gateCompleted)) return;
    if (agent.inbox.nextStep.length) return;
    const wake = new AbortController();
    const listener = () => { if (agent.inbox.nextStep.length) wake.abort(); };
    host.listeners.add(listener);
    const control = AbortSignal.any([signal, host.closing.signal, wake.signal]);
    let active: Helpers | undefined;
    let stopEvidence: (() => void) | undefined;
    const capabilitySuppressions: Array<() => void> = [];
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
      const shellKind = (name: string) => ["bash", "pwsh"].includes(name.toLowerCase());
      const successfulShell = new Set<number>();
      let capabilityFailure: ReviewAgentFailure | undefined;
      let capabilityJoin: Promise<void> | undefined;
      const unavailableTools = new Set<string>();
      let capabilityNotice = false;
      stopEvidence = pair.verifier.agent.ctx.on("tools/result", (exec, result) => {
        if (exec.agent !== pair.verifier.agent || !shellKind(exec.name) || control.aborted) return;
        if (result.isError) {
          if (result.error?.info?.code === "READ_ONLY_PATH_UNSUPPORTED") {
            capabilityFailure ??= new ReviewAgentFailure(`MoA+ Outcome Verifier cannot run ${exec.name}: ${result.error.message}`);
            if (testsRequired) {
              // Required execution cannot be replaced with file inspection.
              if (!capabilityJoin) {
                capabilityJoin = pair.verifier.agent.cancelAndJoin({ kind: "parent" });
                // The original promise is awaited below; observe early rejection.
                void capabilityJoin.catch(error => host.ctx.logger.warn(`moa: verifier capability-stop cleanup: ${String(error)}`));
              }
            } else if (!unavailableTools.has(exec.name)) {
              unavailableTools.add(exec.name);
              capabilitySuppressions.push(pair.verifier.agent.ctx.tools.suppress({ deny: [exec.name] }));
              if (!capabilityNotice) {
                capabilityNotice = true;
                pair.verifier.agent.inject(msg(`The native shell backend cannot enforce this review's file protection, so the unavailable tool has been removed from your scope. Continue independent verification using available file inspection tools and ${tools.readDelivery}. Do not retry unavailable shell tools or request wider access. Submit a verdict based on actual evidence; if available tools cannot establish the requirements, submit Block with runtime_blocked: true and the missing capability. Ordinary deliverable gaps remain Partial or Block without that flag.`));
              }
            }
          }
          return;
        }
        const value = result.value;
        const foregroundPassed = value && typeof value === "object" && !Array.isArray(value) && value.kind === "foreground" && value.exitCode === 0 && value.timedOut === false && value.aborted === false && value.signal === null;
        // Persistent shells keep their public string result. Their native
        // command owner attaches exit facts for this exact execution token;
        // console text itself never proves success.
        const meta = result.meta;
        const nativeShell = meta && typeof meta === "object" && !Array.isArray(meta) ? meta.nativeShell : undefined;
        const persistentPassed = nativeShell && typeof nativeShell === "object" && !Array.isArray(nativeShell) && nativeShell.kind === exec.name.toLowerCase() && nativeShell.completed === true && nativeShell.exitCode === 0 && nativeShell.signal === null && nativeShell.timedOut === false && nativeShell.aborted === false;
        if (!foregroundPassed && !persistentPassed) return;
        const call = pair.verifier.agent.session.snapshotEvents().filter(event => event.type === "tool/call" && event.data.callId === exec.callId && event.data.name === exec.name).at(-1);
        if (call) successfulShell.add(call.seq);
      });
      const evidence = () => collectReviewEvidence(pair.verifier.agent, offset, testsRequired, successfulShell, capabilityFailure !== undefined);
      candidateReview = pair.freezeCandidate(answer, control, {
        evidence,
        async protocolIssue(submitted) {
          // Existing capability failure handling owns the infrastructure path.
          if (control.aborted || capabilityFailure) return;
          // An unavailable/superseded authoritative rubric needs the existing
          // parent re-verification/republish path, not a Verifier read loop.
          try { await pair.read(control); } catch { return; }
          if (control.aborted) return;
          let verdict: Verdict;
          try { verdict = readReviewVerdict(submitted, lastText(pair.verifier.agent, offset)); }
          catch {
            return `Review protocol incomplete for this frozen candidate: call ${tools.submitReview} or return a valid JSON verdict object, directly or in exactly one fenced JSON block, with status Pass, Partial or Block and an issues string array. Continue this same review; this is not a defect in the author's deliverable.`;
          }
          if (missingVerdictGap(verdict)) return "Review protocol incomplete for this frozen candidate: a Partial or Block verdict needs a concrete anchored defect, ambiguity or missing evidence in its issues array. Do not invent a defect to fill the array. If every rubric obligation is supported, submit Pass instead.";
          if (verdict.status !== "Pass") return;
          const missing = missingReviewEvidence(evidence());
          if (missing.length) return `Review protocol incomplete for this frozen candidate. Missing Host prerequisites: ${missing.join(" ")} Reuse evidence already recorded in this attempt and submit a fresh verdict after resolving these gaps. If the available tools cannot verify a concrete requirement, submit Partial or Block with that gap. Do not request artifact rework merely because this review omitted its own evidence.`;
        },
      });
      pair.verifier.agent.followup(msg(buildDeliveryReviewInstructions(pair.rubricPath)));
      await waitForTurn(pair.verifier.agent.whenIdle(), control);
      if (capabilityJoin) {
        try { await waitForTurn(capabilityJoin, control); }
        catch (error) {
          control.throwIfAborted();
          throw new ReviewAgentFailure(`${capabilityFailure!.message}; native cleanup failed`, { cause: error });
        }
      }
      if (capabilityFailure && testsRequired) throw capabilityFailure;
      assertReviewAgentHealthy(pair.verifier.agent, "Outcome Verifier", offset);
      await pair.read(control);
      control.throwIfAborted();
      const facts = evidence();
      let verdict: Verdict;
      try {
        verdict = readReviewVerdict(candidateReview.readVerdict(), lastText(pair.verifier.agent, offset));
      } catch {
        if (capabilityFailure) throw capabilityFailure;
        agent.steer(msg(`Outcome verification did not pass. Verifier must call ${tools.submitReview} or return a valid JSON verdict object, directly or in exactly one fenced JSON block.`));
        return;
      }
      if (capabilityFailure && (missingVerdictGap(verdict) || verdict.runtime_blocked === true)) throw capabilityFailure;
      if (verdict.status !== "Pass" || missingReviewEvidence(facts).length) {
        if (capabilityFailure && verdict.status === "Pass") throw capabilityFailure;
        agent.steer(msg(`Outcome verification did not pass. ${JSON.stringify(verdict.issues.length ? verdict.issues : missingReviewEvidence(facts))}`));
      }
    } catch (error) {
      signal.throwIfAborted();
      if (!wake.signal.aborted && !host.closing.signal.aborted) {
        if (active && helpers.get(agent) === active) { helpers.delete(agent); retire(active); }
        // A failed native helper turn is an infrastructure failure, not evidence
        // that the user's deliverable needs more work. Let the native loop report
        // it instead of directing the Coordinator into repeated self-repair.
        if (error instanceof ReviewAgentFailure) throw error;
        agent.steer(msg(`Outcome verification blocked: ${String(error)}. Continue the task and repeat verification against its original requirements; a superseded rubric requires re-verification, not changes to otherwise correct deliverables.`));
      }
    } finally {
      candidateReview?.dispose();
      stopEvidence?.();
      for (const remove of capabilitySuppressions) remove();
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
    generations = new WeakMap();
    for (const off of mounted.values()) off();
    mounted.clear();
    await Promise.all([...helpers.values()].map(close).concat([...retired]));
    helpers.clear();
  });
  return mount;
}
