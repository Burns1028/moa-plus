import * as NativeTools from "@deepseek-ai/dsh-tools";
import type {} from "@deepseek-ai/dsh-jobs";
import type {} from "@deepseek-ai/dsh-shell";
import type { SessionController } from "@deepseek-ai/dsh-api-session-controller";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { SessionId } from "@deepseek-ai/dsh-session";
import { SubagentError } from "@deepseek-ai/dsh-subagent";
import type { Context, Plugin } from "@deepseek-ai/cordis";
import type { Session } from "@deepseek-ai/dsh-session";
import { projection, type Projection } from "./state.ts";

/** Give a helper its own native executor without changing its parent's mode. */
export async function presentNativeTools(ctx: Context): Promise<void> {
  if (typeof ctx.tools.presentAs === "function") {
    ctx.tools.presentAs("native");
    return;
  }
  if (typeof Reflect.get(ctx.tools, "setExecutor") !== "function")
    throw new Error("project-mode/native-tool-executor-incompatible: missing scoped native tool executor API");
  // New Harness releases own execution in separate provider plugins. Keep
  // this optional module lazy so the rc.3 build/runtime stays supported.
  const nativeExecutorPackage = "@deepseek-ai/dsh-tool-executor-native";
  let moduleUrl: string;
  try { moduleUrl = import.meta.resolve(nativeExecutorPackage); }
  catch (error) {
    if ((error as { code?: string })?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    throw new Error(`project-mode/native-tool-executor-incompatible: missing ${nativeExecutorPackage}`, { cause: error });
  }
  // Loading failures inside the installed provider are not missing capability
  // fallbacks: preserve the actual native error and its dependency details.
  const nativeExecutor: Plugin = await import(moduleUrl);
  await ctx.plugin(nativeExecutor);
}

type HostPromptAdapters = Pick<
  typeof import("@deepseek-ai/dsh-subagent/internal"),
  "queueHostSubagentPrompt" | "steerHostSubagentPrompt"
>;
type HostPromptAdmission = HostPromptAdapters["queueHostSubagentPrompt"];
const hostPromptSubpath = "@deepseek-ai/dsh-subagent/internal";
let hostPromptAdapters: HostPromptAdapters | undefined;
let hostPromptLoading: Promise<HostPromptAdapters> | undefined;

function missingHostPromptAdmission(api: string, cause?: unknown): Error {
  return new Error(
    `project-mode/native-host-prompt-admission-incompatible: missing ${api}`,
    cause === undefined ? undefined : { cause },
  );
}

/** Classify only failure to resolve this adapter, never its own dependencies. */
function missingHostPromptSubpath(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const { code, url } = error as Error & { code?: string; url?: string };
  if (code === "ERR_PACKAGE_PATH_NOT_EXPORTED") {
    const message = error.message.replaceAll("\\", "/");
    return (
      message.includes("Package subpath './internal'") &&
      /\/@deepseek-ai\/dsh-subagent\/package\.json(?:[\s"']|$)/.test(message)
    );
  }
  if (code !== "ERR_MODULE_NOT_FOUND") return false;
  try {
    return url === import.meta.resolve(hostPromptSubpath);
  } catch {
    return false;
  }
}

function loadHostPromptAdapters(): Promise<HostPromptAdapters> {
  return (hostPromptLoading ??= import("@deepseek-ai/dsh-subagent/internal")
    .catch((error: unknown) => {
      if (missingHostPromptSubpath(error))
        throw missingHostPromptAdmission(hostPromptSubpath, error);
      throw error;
    })
    .then((adapters) => (hostPromptAdapters = adapters)));
}

function admitHostPrompt(
  name: keyof HostPromptAdapters,
  args: Parameters<HostPromptAdmission>,
): ReturnType<HostPromptAdmission> {
  const invoke = (adapters: HostPromptAdapters) => {
    const admit = adapters[name];
    if (typeof admit !== "function")
      throw missingHostPromptAdmission(`${hostPromptSubpath}.${name}`);
    return admit(...args);
  };
  // Once loaded, preserve the native callback's return and synchronous failures.
  return hostPromptAdapters
    ? invoke(hostPromptAdapters)
    : loadHostPromptAdapters().then(invoke);
}

/** Lazy Host-only admission; unsupported runtimes fail at the requested call. */
export const queueHostSubagentPrompt: HostPromptAdmission = (...args) =>
  admitHostPrompt("queueHostSubagentPrompt", args);
export const steerHostSubagentPrompt: HostPromptAdapters["steerHostSubagentPrompt"] =
  (...args) => admitHostPrompt("steerHostSubagentPrompt", args);

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

/** Name missing native capabilities before installing MOA execution policy. */
export function requireNativeBackground(ctx: Context, agent: Agent) {
  const jobs = agent.ctx.get("jobs");
  const missing: string[] = [];
  const scheduler = Reflect.get(NativeTools, "TOOL_RUNTIME_SCHEDULER") as
    | typeof NativeTools.TOOL_RUNTIME_SCHEDULER
    | undefined;
  if (!jobs?.supportsProducerNotices) missing.push("jobs.supportsProducerNotices");
  if (typeof scheduler !== "symbol")
    missing.push("@deepseek-ai/dsh-tools.TOOL_RUNTIME_SCHEDULER");
  else if (typeof ctx.tools[scheduler]?.start !== "function")
    missing.push("tools[TOOL_RUNTIME_SCHEDULER].start");
  if (typeof agent.enableToolBackground !== "function")
    missing.push("agent.enableToolBackground");
  if (typeof agent.cancelAndJoin !== "function") missing.push("agent.cancelAndJoin");
  if (typeof agent.moaAborting !== "boolean") missing.push("agent.moaAborting");
  if (typeof agent.moaHasPendingBackground !== "boolean")
    missing.push("agent.moaHasPendingBackground");
  if (missing.length)
    throw new Error(`project-mode/native-moa-background-incompatible: missing ${missing.join(", ")}`);
  const bash = ctx.tools.get("bash", agent);
  if (bash) {
    if (!bash.supportsBackgroundProducer) missing.push("bash.supportsBackgroundProducer");
    if (!agent.ctx.get("shell")?.supportsManagedExecution)
      missing.push("shell.supportsManagedExecution");
    if (missing.length)
      throw new Error(`project-mode/native-moa-background-incompatible: missing ${missing.join(", ")}`);
  }
  // A missing jobs service was included in the rejected capability list above.
  return jobs!;
}
