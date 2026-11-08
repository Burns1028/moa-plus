import type { Context } from "@deepseek-ai/cordis";
import { appendPluginRecord, pluginRecordOf } from "@deepseek-ai/dsh-session";
import type { Agent, BackgroundReceipt, ToolActivityStarted } from "@deepseek-ai/dsh-agent";
import { createUserMessage, type UserMessage } from "@deepseek-ai/dsh-llm";
import type { ToolExecutionResult } from "@deepseek-ai/dsh-tools";
import type { JobId } from "@deepseek-ai/dsh-jobs";
import type { JobView } from "@deepseek-ai/dsh-jobs/view";
import type { Config } from "../config.ts";
import { contentSchema, messageSchema } from "../state.ts";
import { z } from "zod";
import { judgeInterrupt } from "./judge.ts";
import { waitForTurn, requireNativeBackground } from "../native.ts";

export interface BackgroundResultData {
  readonly receipt: BackgroundReceipt;
  readonly job?: JobView;
  readonly result: Pick<ToolExecutionResult, "content" | "isError" | "error" | "meta">;
  readonly additionalContexts: readonly UserMessage[];
  readonly delivery: UserMessage;
}
declare module "@deepseek-ai/dsh-session/types" {
  interface PluginRecordMap { "plugin:moa/background-result": BackgroundResultData; }
}
declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap { "moa-background-result": { kind: "moa-background-result"; tool_call_id: string }; }
}
declare module "@deepseek-ai/dsh-jobs/view" {
  interface JobKindMap { "moa-tool": "moa-tool"; }
}
export const backgroundHandle = (receipt: Pick<BackgroundReceipt, "owner" | "callSeq">) =>
  JSON.stringify([receipt.owner, receipt.callSeq]);

const backgroundRecordType = "plugin:moa/background-result";
const backgroundRecordSchema = z.object({
  receipt: z.object({
    owner: z.string().min(1),
    turn: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
    callSeq: z.number().int().nonnegative(),
    callId: z.string().min(1),
    rootCallId: z.string().min(1),
    jobId: z.string().min(1),
    cause: z.discriminatedUnion("kind", [
      z.object({ kind: z.enum(["after-seconds", "producer-promotion"]) }),
      z.object({ kind: z.enum(["new-message", "llm-judge"]), messageIds: z.array(z.string().min(1)) }),
    ]),
  }).passthrough(),
  result: z.object({ content: contentSchema, isError: z.boolean() }).passthrough(),
  additionalContexts: z.array(messageSchema),
  delivery: messageSchema,
}).passthrough();

function records(agent: Agent): BackgroundResultData[] {
  return agent.session.snapshotEvents().flatMap(event => {
    const record = pluginRecordOf(event);
    if (record?.type !== backgroundRecordType) return [];
    const data = backgroundRecordSchema.parse(record.data) as unknown as BackgroundResultData;
    return data.receipt.owner === agent.id ? [data] : [];
  });
}
function receipts(agent: Agent): BackgroundReceipt[] {
  return agent.session.snapshotEvents().flatMap(e => {
    if (e.type !== "tool/result" || !e.data.meta || typeof e.data.meta !== "object" || Array.isArray(e.data.meta)) return [];
    const receipt = e.data.meta.moaBackground as unknown as BackgroundReceipt | undefined;
    return receipt?.owner === agent.id ? [receipt] : [];
  });
}
function consumed(agent: Agent, message: UserMessage): boolean {
  return agent.session.snapshotEvents().some(e => e.type === "user/message" && e.data.id === message.id);
}

/** Install policy and receipts on one native owner; the loop retains all execution ownership. */
export async function bindBackground(ctx: Context, agent: Agent, config: Pick<Config, "backgroundStrategy" | "backgroundAfterSeconds">, requestPending: (callSeq: number) => boolean = () => false): Promise<() => Promise<void>> {
  const jobs = requireNativeBackground(ctx, agent);
  if (!Number.isFinite(config.backgroundAfterSeconds) || config.backgroundAfterSeconds < 0) throw new Error("backgroundAfterSeconds must be finite and nonnegative");
  const detachController = jobs.attachController("moa-background");
  const disposers: (() => void)[] = [];
  const live = new Map<string, Promise<void>>();
  const watchers = new Set<() => void>();
  const pending = new Map<string, { receipt: BackgroundReceipt; result: BackgroundResultData["result"]; additionalContexts: readonly UserMessage[] }>();
  const disable = agent.enableToolBackground({ hasPendingResult: () => {
    if (pending.size) return true;
    // A successful Kill may park a fully persisted result for deliberate resume.
    if (agent.moaStopped) return false;
    const completed = records(agent);
    return receipts(agent).some(receipt => {
      const result = completed.find(item => backgroundHandle(item.receipt) === backgroundHandle(receipt));
      return !result || !consumed(agent, result.delivery);
    });
  } });
  let disposing = false;
  let admission = Promise.resolve();
  async function deliver(record: BackgroundResultData): Promise<void> {
    if (disposing || agent.moaStopped || consumed(agent, record.delivery)) return;
    const messages = [record.delivery, ...record.additionalContexts];
    const pending = new Set([...agent.inbox.nextStep, ...agent.inbox.nextTurn].map(m => m.id));
    const missing = messages.filter(m => !pending.has(m.id) && !consumed(agent, m));
    const checkpoint = Promise.withResolvers<void>();
    admission = checkpoint.promise;
    admission.catch(() => {});
    try {
      for (const message of missing) agent.send(message, "next-step", true);
      await ctx.sessions.flush(agent.session);
      checkpoint.resolve();
    } catch (error) { checkpoint.reject(error); throw error; }
  }
  async function recordResult(receipt: BackgroundReceipt, result: BackgroundResultData["result"], additionalContexts: readonly UserMessage[] = []): Promise<void> {
    const handle = backgroundHandle(receipt);
    let record = records(agent).find(r => backgroundHandle(r.receipt) === handle);
    if (!record) {
      let job: JobView | undefined;
      try { job = jobs!.get(receipt.jobId, agent.id); } catch { /* recovered process-local job is unavailable */ }
      const delivery = createUserMessage({
        source: { kind: "moa-background-result", tool_call_id: handle },
        content: [
          { type: "text", text: `Background tool completed: ${handle}; original call ${receipt.callId}; job ${receipt.jobId}.\n${JSON.stringify({ isError: result.isError, error: result.error, meta: result.meta, job })}` },
          ...result.content,
        ],
      });
      record = { receipt, result, additionalContexts, delivery, ...(job ? { job } : {}) };
      appendPluginRecord(agent.session, backgroundRecordType, record);
    }
    await ctx.sessions.flush(agent.session);
    await deliver(record);
  }
  disposers.push(agent.ctx.on("agent/tool-background-result", async ({ receipt, result }) => {
    const { content, isError, error, meta } = result;
    const key = backgroundHandle(receipt);
    const value = { receipt, result: { content, isError, ...(error ? { error } : {}), ...(meta !== undefined ? { meta } : {}) }, additionalContexts: result.additionalContexts ?? [] };
    pending.set(key, value);
    await recordResult(value.receipt, value.result, value.additionalContexts);
    pending.delete(key);
  }));
  disposers.push(agent.ctx.on("agent/tool-activity-started", (activity) => {
    const key = backgroundHandle(activity.identity);
    live.set(key, activity.finished);
    const stop = watchActivity(ctx, agent, activity, config, requestPending);
    watchers.add(stop);
    const cleanup = () => { stop(); watchers.delete(stop); };
    void activity.finished.then(() => { live.delete(key); cleanup(); }, cleanup);
  }));
  // A Stop-cleared or transiently claimed message is still owed until user/message commits.
  disposers.push(agent.ctx.on("agent/pre-step", async (_payload, next) => {
    // Claims are already removed here. Only recover on a distinct explicit wake, not by
    // re-admitting messages currently in this pre-step's claimed batch.
    const claimed = new Set(_payload.messages.map(m => m.id));
    for (const [key, value] of pending) {
      const logged = records(agent).find(r => backgroundHandle(r.receipt) === key);
      if (logged && claimed.has(logged.delivery.id)) continue;
      await recordResult(value.receipt, value.result, value.additionalContexts);
      pending.delete(key);
    }
    for (const record of records(agent)) if (!claimed.has(record.delivery.id) && !consumed(agent, record.delivery)) await deliver(record);
    // A failed flush prevents inference. A later explicit wake retries the same
    // canonical result and stable message identity before entering the model.
    await admission;
    return next();
  }));
  function resolveHandle(handle: string): BackgroundReceipt {
    const receipt = receipts(agent).find(r => backgroundHandle(r) === handle);
    if (!receipt) throw new Error("Background handle is unknown or belongs to another Agent");
    return receipt;
  }
  async function query(handle: string, seconds: number, signal: AbortSignal) {
    const receipt = resolveHandle(handle);
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error("wait_timeout must be a finite nonnegative number of seconds");
    let record = records(agent).find(r => backgroundHandle(r.receipt) === handle);
    if (!record && seconds > 0) {
      const deadline = Date.now() + Math.min(seconds * 1000, 300_000);
      await jobs!.wait(receipt.jobId, Math.max(1, deadline - Date.now()), agent.id, signal);
      const finalizing = live.get(handle);
      if (finalizing && Date.now() < deadline) {
        const timeout = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
        try { await waitForTurn(finalizing, AbortSignal.any([signal, timeout])); }
        catch (error) { if (!timeout.aborted || signal.aborted) throw error; }
      }
      record = records(agent).find(r => backgroundHandle(r.receipt) === handle);
    }
    if (record) return { status: "finished", tool_call_id: handle, job_id: receipt.jobId, job: record.job, ...record.result };
    const job = jobs!.get(receipt.jobId, agent.id);
    return { status: job.status, finalization_pending: job.status !== "running" && job.status !== "stopping", job, output: jobs!.readAt(receipt.jobId, 0, agent.id) };
  }
  const parameters = { type: "object", properties: { tool_call_id: { type: "string" }, wait_timeout: { type: "number", minimum: 0 } }, required: ["tool_call_id"], additionalProperties: false };
  disposers.push(agent.ctx.tools.register({
    name: "query_background_tool", description: "Read the full repeatable result or actual native job progress. wait_timeout is seconds (maximum 300).",
    parameters, output: { schema: { type: "object" }, render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }] },
    async execute(raw, exec) { const args = raw as { tool_call_id: string; wait_timeout?: number }; return query(args.tool_call_id, args.wait_timeout ?? 0, exec.signal); },
  }));
  disposers.push(agent.ctx.tools.register({
    name: "cancel_background_tool", description: "Request cancellation of an owned background tool. Stopping remains visible until actual resource exit.",
    parameters: { ...parameters, properties: { tool_call_id: { type: "string" } } },
    output: { schema: { type: "object" }, render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }] },
    async execute(raw) { const { tool_call_id } = raw as { tool_call_id: string }; const receipt = resolveHandle(tool_call_id); const result = jobs!.kill(receipt.jobId, agent.id, "model requested cancellation"); return { result, state: jobs!.get(receipt.jobId, agent.id) }; },
  }));
  try {
    const recovered = records(agent);
    for (const receipt of receipts(agent)) {
      if (records(agent).some(r => backgroundHandle(r.receipt) === backgroundHandle(receipt))) continue;
      try { jobs.get(receipt.jobId as JobId, agent.id); }
      catch { await recordResult(receipt, { isError: true, content: [{ type: "text", text: "Background execution interrupted: native job is unavailable after recovery." }], error: { message: "Background execution interrupted", info: { name: "BackgroundInterrupted", code: "MOA_BACKGROUND_UNAVAILABLE" } } }); }
    }
    // Newly synthesized interrupted outcomes were already admitted above. The
    // loop may have claimed them before user/message commits; do not send twice.
    for (const record of recovered) await deliver(record);
  } catch (error) { disable(); detachController(); for (const off of disposers) off(); throw error; }
  let disposal: Promise<void> | undefined;
  return () => disposal ??= (async () => {
    disposing = true;
    disable();
    // Draft mode changes run inside native maintenance. With no admitted work
    // there is nothing to join; joining that maintenance would await itself.
    try {
      if (live.size || agent.status === "running") await agent.cancelAndJoin({ kind: "disposed" });
      for (const [key, value] of pending) {
        await recordResult(value.receipt, value.result, value.additionalContexts);
        pending.delete(key);
      }
    } finally {
      for (const stop of watchers) stop();
      for (const off of disposers.splice(0)) off();
      detachController();
    }
  })();
}

function watchActivity(ctx: Context, agent: Agent, activity: ToolActivityStarted, config: Pick<Config, "backgroundStrategy" | "backgroundAfterSeconds">, requestPending: (callSeq: number) => boolean): () => void {
  // Request owns its timeout and interruptible wait, including its Tool Result.
  if (activity.execution.name === "SendMessage" && (activity.execution.arguments as { mode?: unknown } | undefined)?.mode === "request") return () => {};
  const started = Date.now();
  const abort = new AbortController();
  const signal = AbortSignal.any([activity.execution.signal, abort.signal]);
  let threshold = config.backgroundAfterSeconds <= 0;
  let revision = 0, examined = -1;
  let judging = false, transferred = false;
  const eligible = () => agent.inbox.nextStep.filter(m => m.source.kind !== "moa-background-result");
  const inspect = async () => {
    if (judging || transferred || signal.aborted) return;
    // A PTC root can contain the same protocol wait as a native SendMessage.
    if (requestPending(activity.identity.callSeq)) return;
    if (!threshold && !activity.execution.backgroundOnMessage) return;
    if (!threshold && eligible().length === 0) return;
    if (threshold && config.backgroundStrategy === "after-seconds") {
      transferred = (await activity.requestBackground({ kind: "after-seconds" })).kind === "background";
      return;
    }
    judging = true;
    try {
      while (!transferred && !signal.aborted && examined !== revision) {
        examined = revision;
        const unread = eligible();
        if (!unread.length) return;
        const judge = threshold && config.backgroundStrategy === "llm-judge" && !activity.execution.backgroundOnMessage;
        const decision = !judge || await judgeInterrupt(ctx, agent, unread, { kind: "background", description: "A foreground tool is still running.", elapsedSeconds: (Date.now() - started) / 1000, tool: { name: activity.execution.name, arguments: activity.execution.arguments } }, signal);
        const pending = new Set(eligible().map(m => m.id));
        const messageIds = unread.map(m => m.id).filter(id => pending.has(id));
        if (decision && messageIds.length && !signal.aborted && !requestPending(activity.identity.callSeq))
          transferred = (await activity.requestBackground({ kind: judge ? "llm-judge" : "new-message", messageIds })).kind === "background";
      }
    } finally { judging = false; }
  };
  const run = () => { void inspect().catch(error => { if (!signal.aborted) ctx.logger.warn(`MOA background policy: ${String(error)}`); }); };
  const off = agent.ctx.on("agent/inbox/inserted", ({message}) => {
    if (!eligible().some(m => m.id === message.id)) return;
    revision++; run();
  });
  const timer = threshold ? undefined : setTimeout(() => { threshold = true; examined = -1; run(); }, Math.max(0, config.backgroundAfterSeconds * 1000));
  run();
  return () => { clearTimeout(timer); abort.abort(); off(); };
}
