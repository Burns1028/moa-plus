import { TOOL_RUNTIME_SCHEDULER } from "@deepseek-ai/dsh-tools";
import type {} from "@deepseek-ai/dsh-jobs";
import type {} from "@deepseek-ai/dsh-shell";
import type { SessionController } from "@deepseek-ai/dsh-api-session-controller";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { SessionId } from "@deepseek-ai/dsh-session";
import { SubagentError } from "@deepseek-ai/dsh-subagent";
// The only version-sensitive host-message compatibility boundary; public npm subpath.
export {
  queueHostSubagentPrompt,
  steerHostSubagentPrompt,
} from "@deepseek-ai/dsh-subagent/internal";
import type { Context } from "@deepseek-ai/cordis";
import type { Session } from "@deepseek-ai/dsh-session";
import { projection, type Projection } from "./state.ts";
export async function registerProjection(ctx: Context): Promise<void> {
  await ctx.sessionProjections.register(projection);
}
export function projected(ctx: Context, session: Session): Projection {
  const value = ctx.sessionProjections.stateOf(session, "project-mode-results");
  if (!value) throw new Error("project-mode/projection-unavailable");
  return value;
}
/** Stop only this observer's wait; shared work keeps its own lifetime. */
export function waitForTurn<T>(
  work: Promise<T>,
  signal: AbortSignal,
  disposeLate?: (value: T) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let aborted = false;
    const cancel = () => {
      aborted = true;
      signal.removeEventListener("abort", cancel);
      reject(signal.reason ?? new Error("aborted"));
    };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    void work.then(
      (value) => {
        signal.removeEventListener("abort", cancel);
        if (aborted) disposeLate?.(value);
        else resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", cancel);
        reject(error);
      },
    );
  });
}

/** A backend may finish after cancellation; release its observation lease too. */
export function observeForTurn(
  ctx: Context,
  id: SessionId,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const work = ctx.sessionQuery.observeSession(id, { signal });
  return signal
    ? waitForTurn(work, signal, (value) => value[Symbol.dispose]())
    : work;
}

export function abortableChange(
  listeners: Set<() => void>,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const clean = () => {
      listeners.delete(changed);
      signal.removeEventListener("abort", aborted);
    };
    const changed = () => {
      clean();
      resolve();
    };
    const aborted = () => {
      clean();
      reject(signal.reason ?? new Error("aborted"));
    };
    listeners.add(changed);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

/** ToolCallId can repeat across turns; the committed root call is the identity boundary. */
export function toolOperationId(
  exec: import("@deepseek-ai/dsh-tools").ToolRunContext,
): string {
  const agent = exec.agent;
  if (!agent) throw new Error("project-mode/not-coordinator");
  const root = exec.rootCallId ?? exec.callId;
  const event = agent.session
    .snapshotEvents()
    .findLast(
      (event) => event.type === "tool/call" && event.data.callId === root,
    );
  if (!event) throw new Error("project-mode/missing-native-tool-call");
  return `tool:${JSON.stringify([agent.id, event.seq, exec.callId])}`;
}

/** Published rc.3 failures whose native throw sites precede inbox acceptance.
 * Generic failures, cancellation and catalog/flush failures remain uncertain.
 * DUPLICATE_CHILD is intentionally excluded: its reserved identity needs reconciliation.
 */
export function nativeAdmissionRejection(
  error: unknown,
): { code: string; message: string } | undefined {
  if (!(error instanceof SubagentError)) return;
  const codes = new Set([
    "ACTIVATION_LIMIT_REACHED",
    "DRAINING",
    "NO_PROVIDER",
    "UNSUPPORTED_CAPABILITY",
    "UNAUTHORIZED",
    "INPUT_CLOSED",
    "NOT_CONTINUABLE",
    "NOT_RESUMABLE",
    "PERSISTENCE_UNAVAILABLE",
    "CONTINUATION_UNAVAILABLE",
    "PRESET_UNAVAILABLE",
    "MODEL_DOES_NOT_SUPPORT_IMAGES",
    "ACTIVATION_CLOSING",
  ]);
  return codes.has(error.code)
    ? { code: error.code, message: error.message }
    : undefined;
}

/** Public Host resolver. The native service key is sessionController, not its Remote namespace. */
export function ordinarySessionResolver(
  ctx: Context,
): Pick<SessionController, "resolveAgent"> | undefined {
  return ctx.get("sessionController");
}
/** Preserve native ownership/domain failures; this never admits model input. */
export async function resolveOrdinaryAgent(
  ctx: Context,
  sessionId: SessionId,
): Promise<Agent | undefined> {
  const resolver = ordinarySessionResolver(ctx);
  if (!resolver) return ctx.agents.get(sessionId);
  const result = await resolver.resolveAgent(sessionId);
  if ("error" in result) throw result.error;
  return result.agent;
}

/** Refuse a partial rc.3 installation before installing MOA execution policy. */
export function requireNativeBackground(ctx: Context, agent: Agent) {
  const jobs = agent.ctx.get("jobs");
  if (!jobs?.supportsProducerNotices || typeof ctx.tools[TOOL_RUNTIME_SCHEDULER]?.start !== "function" || typeof agent.enableToolBackground !== "function" || typeof agent.cancelAndJoin !== "function" || typeof agent.moaAborting !== "boolean" || typeof agent.moaHasPendingBackground !== "boolean")
    throw new Error("project-mode/native-moa-background-incompatible: patched native tools, loop and jobs provider required");
  const bash = ctx.tools.get("bash", agent);
  if (bash && (!bash.supportsBackgroundProducer || !agent.ctx.get("shell")?.supportsManagedExecution))
    throw new Error("project-mode/native-moa-background-incompatible: patched Bash producer and managed shell provider required");
  return jobs;
}
